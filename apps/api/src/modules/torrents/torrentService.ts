import crypto from "node:crypto";
import path from "node:path";
import mime from "mime-types";
import WebTorrent, { Torrent } from "webtorrent";
import { Server } from "socket.io";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";

const videoExt = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".mpeg", ".mpg"]);

/** Fixed pseudo-torrent that groups directly-uploaded files. */
export const UPLOADS_ID = "local-uploads";

/** Absolute directory where uploaded files are stored (mirrors torrent layout). */
export function uploadsDir(): string {
  return path.join(config.dataDir, "downloads", UPLOADS_ID);
}

/** Classify a filename into a media kind and whether it is stream-playable. */
export function classifyFile(name: string): { kind: string; streamable: number; mimeType: string | null } {
  const ext = path.extname(name).toLowerCase();
  const mimeType = (mime.lookup(name) || null) as string | null;
  const kind = videoExt.has(ext) ? "video" : mimeType?.split("/")[0] ?? "file";
  return { kind, streamable: kind === "video" ? 1 : 0, mimeType };
}

export class TorrentService {
  private readonly client = new WebTorrent({ maxConns: config.torrentMaxConns, torrentPort: config.torrentPort });
  private readonly active = new Map<string, Torrent>();
  private io?: Server;

  attach(io: Server) {
    this.io = io;
    // WebTorrent emits 'error' (e.g. EADDRINUSE on the torrent port). Without a
    // listener Node treats it as unhandled and crashes the whole process, so we
    // log and keep the API alive instead of taking the server down.
    this.client.on("error", (err) => logger.error({ err }, "WebTorrent client error"));
    setInterval(() => this.publishStats(), 1500).unref();
  }

  add(magnetUri: string) {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO torrents (id, name, magnet_uri, status) VALUES (?, ?, ?, ?)").run(
      id,
      "Fetching metadata",
      magnetUri,
      "connecting"
    );

    this.start(id, magnetUri, "downloading");
    return { id };
  }

  restore() {
    const rows = db.prepare("SELECT id, magnet_uri, status FROM torrents WHERE status != ? ORDER BY created_at").all("completed") as any[];
    for (const row of rows) {
      if (row.status === "paused") continue;
      this.start(row.id, row.magnet_uri, "resuming");
    }
    logger.info({ count: rows.length }, "Torrent restore scan complete");
  }

  list() {
    return db.prepare("SELECT * FROM torrents ORDER BY created_at DESC").all();
  }

  getDetail(id: string) {
    const row = db.prepare("SELECT * FROM torrents WHERE id = ?").get(id) as any;
    if (!row) return null;
    const torrent = this.find(id) as any;
    const files = this.getFiles(id);
    const peers = this.getPeers(torrent);
    const trackers = this.getTrackers(torrent);
    const pieces = this.getPieceSummary(torrent);
    const speed = torrent ? torrent.downloadSpeed : row.download_speed;
    const remainingBytes = Math.max(0, row.size - row.downloaded);
    const etaSeconds = torrent?.timeRemaining ? Math.ceil(torrent.timeRemaining / 1000) : speed > 0 ? Math.ceil(remainingBytes / speed) : null;
    return {
      ...row,
      files,
      runtime: {
        active: Boolean(torrent),
        peers: torrent?.numPeers ?? peers.length,
        ratio: torrent?.ratio ?? (row.downloaded > 0 ? row.uploaded / row.downloaded : 0),
        etaSeconds,
        health: this.getHealth(row, peers.length),
        pieces,
        trackers,
        peerList: peers
      }
    };
  }

  getFiles(torrentId?: string) {
    if (torrentId) return db.prepare("SELECT * FROM files WHERE torrent_id = ? ORDER BY path").all(torrentId);
    return db.prepare("SELECT * FROM files ORDER BY created_at DESC").all();
  }

  /** Ensure the pseudo-torrent that groups direct uploads exists. */
  private ensureUploadsBucket() {
    const existing = db.prepare("SELECT id FROM torrents WHERE id = ?").get(UPLOADS_ID);
    if (!existing) {
      db.prepare(`INSERT INTO torrents (id, name, magnet_uri, status, progress) VALUES (?, ?, ?, ?, ?)`)
        .run(UPLOADS_ID, "Uploads", "local://uploads", "completed", 1);
    }
  }

  /**
   * Register a file that was uploaded directly (not via a torrent). The bytes are
   * already streamed to disk by the route; here we only record metadata and
   * notify clients. `relativeName` is the on-disk filename inside uploadsDir().
   */
  registerUpload(meta: { relativeName: string; displayName: string; size: number }) {
    this.ensureUploadsBucket();
    const { kind, streamable, mimeType } = classifyFile(meta.displayName);
    const fileId = crypto.randomUUID();
    db.prepare(`INSERT INTO files (id, torrent_id, name, path, size, mime, media_kind, streamable)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(fileId, UPLOADS_ID, meta.displayName, meta.relativeName, meta.size, mimeType, kind, streamable);

    const total = db.prepare("SELECT COALESCE(SUM(size),0) AS s FROM files WHERE torrent_id = ?").get(UPLOADS_ID) as any;
    db.prepare("UPDATE torrents SET size = ?, downloaded = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(total.s, total.s, UPLOADS_ID);

    this.io?.emit("notification", { type: "success", title: "Upload complete", body: meta.displayName });
    this.publishStats();
    return { id: fileId, streamable: Boolean(streamable), media_kind: kind };
  }

  pause(id: string) {
    const torrent = this.find(id);
    if (!torrent) return false;
    torrent.pause();
    db.prepare("UPDATE torrents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("paused", id);
    this.io?.emit("torrent:paused", { id });
    return true;
  }

  resume(id: string) {
    const row = db.prepare("SELECT magnet_uri FROM torrents WHERE id = ?").get(id) as any;
    if (!row) return false;
    const torrent = this.find(id) ?? this.start(id, row.magnet_uri, "downloading");
    torrent.resume();
    db.prepare("UPDATE torrents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("downloading", id);
    this.io?.emit("torrent:resumed", { id });
    return true;
  }

  remove(id: string, destroyStore = false) {
    const torrent = this.find(id);
    if (torrent) this.client.remove(torrent.infoHash, { destroyStore });
    this.active.delete(id);
    db.prepare("DELETE FROM torrents WHERE id = ?").run(id);
    this.io?.emit("torrent:removed", { id });
    return true;
  }

  reannounce(id: string) {
    const torrent = this.find(id) as any;
    torrent?.announce?.();
    return Boolean(torrent);
  }

  forceRecheck(id: string) {
    const torrent = this.find(id) as any;
    torrent?.verify?.();
    db.prepare("UPDATE torrents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("checking", id);
    return Boolean(torrent);
  }

  prioritizeFile(fileId: string) {
    const file = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId) as any;
    const torrent = file ? this.find(file.torrent_id) : undefined;
    const target = torrent?.files.find((candidate: { path: string }) => candidate.path === file.path);
    target?.select();
    return { ok: Boolean(target) };
  }

  markFileForProbe(fileId: string) {
    const result = db.prepare(`
      UPDATE files
      SET probe_status = 'pending', probe_error = NULL
      WHERE id = ? AND streamable = 1
    `).run(fileId) as any;
    return result.changes > 0;
  }

  private bindTorrent(id: string, torrent: Torrent) {
    this.active.set(id, torrent);
    torrent.on("metadata", () => {
      db.prepare("UPDATE torrents SET info_hash = ?, name = ?, size = ?, status = ? WHERE id = ?").run(
        torrent.infoHash,
        torrent.name,
        torrent.length,
        "downloading",
        id
      );
      const insert = db.prepare(`INSERT OR IGNORE INTO files
        (id, torrent_id, name, path, size, mime, media_kind, streamable)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const file of torrent.files) {
        const ext = path.extname(file.name).toLowerCase();
        const kind = videoExt.has(ext) ? "video" : mime.lookup(file.name)?.toString().split("/")[0] ?? "file";
        insert.run(crypto.randomUUID(), id, file.name, file.path, file.length, mime.lookup(file.name) || null, kind, kind === "video" ? 1 : 0);
        if (kind === "video") file.select();
      }
      this.io?.emit("torrent:metadata", { id, name: torrent.name });
    });

    torrent.on("download", () => this.update(id, torrent));
    torrent.on("upload", () => this.update(id, torrent));
    torrent.on("done", () => {
      this.update(id, torrent, "completed");
      this.io?.emit("notification", { type: "success", title: "Torrent completed", body: torrent.name });
    });
    torrent.on("error", (error: Error) => {
      logger.error({ error, id }, "Torrent error");
      db.prepare("UPDATE torrents SET status = ? WHERE id = ?").run("error", id);
    });
  }

  private start(id: string, magnetUri: string, status: string) {
    db.prepare("UPDATE torrents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
    const torrent = this.client.add(magnetUri, {
      path: path.join(config.dataDir, "downloads", id)
    });
    this.bindTorrent(id, torrent);
    return torrent;
  }

  private update(id: string, torrent: Torrent, status = "downloading") {
    db.prepare(`UPDATE torrents SET progress = ?, download_speed = ?, upload_speed = ?,
      downloaded = ?, uploaded = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      torrent.progress,
      torrent.downloadSpeed,
      torrent.uploadSpeed,
      torrent.downloaded,
      torrent.uploaded,
      status,
      id
    );
  }

  private publishStats() {
    const rows = this.list();
    this.io?.emit("torrents:update", rows);
  }

  private find(id: string) {
    return this.active.get(id);
  }

  private getHealth(row: any, peerCount: number) {
    if (row.status === "completed") return "complete";
    if (row.status === "error") return "error";
    if (peerCount >= 8) return "strong";
    if (peerCount >= 2) return "fair";
    if (row.status === "connecting" || row.status === "resuming") return "connecting";
    return "weak";
  }

  private getPeers(torrent: any) {
    const wires = Array.isArray(torrent?.wires) ? torrent.wires : [];
    return wires.slice(0, 80).map((wire: any) => ({
      address: wire.remoteAddress ?? "unknown",
      port: wire.remotePort ?? null,
      downloaded: wire.downloaded ?? 0,
      uploaded: wire.uploaded ?? 0,
      downloadSpeed: wire.downloadSpeed?.() ?? 0,
      uploadSpeed: wire.uploadSpeed?.() ?? 0,
      choked: Boolean(wire.peerChoking),
      interested: Boolean(wire.peerInterested)
    }));
  }

  private getTrackers(torrent: any) {
    const announce = torrent?.announce ?? torrent?.announceList ?? [];
    const flat = Array.isArray(announce) ? announce.flat(2) : [];
    return [...new Set(flat)].slice(0, 40).map((url) => ({ url, status: "announced" }));
  }

  private getPieceSummary(torrent: any) {
    const pieces = torrent?.pieces;
    const total = Array.isArray(pieces) ? pieces.length : 0;
    if (!total) return { total: 0, complete: 0, map: [] };
    const map = pieces.slice(0, 240).map((piece: any) => Boolean(piece?.verified || piece?.complete || piece === true));
    return {
      total,
      complete: pieces.filter((piece: any) => Boolean(piece?.verified || piece?.complete || piece === true)).length,
      map
    };
  }
}

export const torrentService = new TorrentService();
