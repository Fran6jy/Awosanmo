import crypto from "node:crypto";
import path from "node:path";
import mime from "mime-types";
import WebTorrent, { Torrent } from "webtorrent";
import { Server } from "socket.io";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";

const videoExt = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".mpeg", ".mpg"]);
const audioExt = new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".weba"]);
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Each user gets their own uploads pseudo-torrent so direct uploads stay siloed. */
export function uploadsIdFor(userId: string): string {
  return `local-uploads-${userId}`;
}

/** Absolute directory where a user's uploaded files are stored. */
export function uploadsDirFor(userId: string): string {
  return path.join(config.dataDir, "downloads", uploadsIdFor(userId));
}

/** Classify a filename into a media kind and whether it is stream-playable. */
export function classifyFile(name: string): { kind: string; streamable: number; mimeType: string | null } {
  const ext = path.extname(name).toLowerCase();
  const mimeType = (mime.lookup(name) || null) as string | null;
  const kind = videoExt.has(ext) ? "video" : audioExt.has(ext) ? "audio" : mimeType?.split("/")[0] ?? "file";
  return { kind, streamable: kind === "video" || kind === "audio" ? 1 : 0, mimeType };
}

function extractInfoHash(magnetUri: string): string | null {
  const match = magnetUri.match(/(?:^|[?&])xt=urn:btih:([^&]+)/i);
  if (!match) return null;
  const raw = decodeURIComponent(match[1]).trim();
  if (/^[a-f0-9]{40}$/i.test(raw)) return raw.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(raw)) return base32ToHex(raw);
  return null;
}

function base32ToHex(value: string): string | null {
  let bits = "";
  for (const char of value.toUpperCase().replace(/=+$/, "")) {
    const index = base32Alphabet.indexOf(char);
    if (index === -1) return null;
    bits += index.toString(2).padStart(5, "0");
  }
  let hex = "";
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.length >= 40 ? hex.slice(0, 40).toLowerCase() : null;
}

export class TorrentService {
  private readonly client = new WebTorrent({ maxConns: config.torrentMaxConns, torrentPort: config.torrentPort });
  private readonly active = new Map<string, Torrent>();
  private io?: Server;

  attach(io: Server) {
    this.io = io;
    this.client.on("error", (err) => logger.error({ err }, "WebTorrent client error"));
    setInterval(() => this.publishStats(), 1500).unref();
  }

  /** True if the torrent row is owned by the given user. */
  private owns(id: string, userId: string): boolean {
    const row = db.prepare("SELECT user_id FROM torrents WHERE id = ?").get(id) as any;
    return !!row && row.user_id === userId;
  }

  private ownerOf(id: string): string | null {
    const row = db.prepare("SELECT user_id FROM torrents WHERE id = ?").get(id) as any;
    return row?.user_id ?? null;
  }

  add(magnetUri: string, userId: string) {
    const infoHash = extractInfoHash(magnetUri);
    const byHash = infoHash
      ? db.prepare("SELECT id, status FROM torrents WHERE user_id = ? AND info_hash = ?").get(userId, infoHash) as any
      : null;
    const existing = byHash ?? db.prepare("SELECT id, status FROM torrents WHERE user_id = ? AND magnet_uri = ?").get(userId, magnetUri) as any;
    if (existing) {
      if (!this.find(existing.id) && !["completed", "paused"].includes(existing.status)) this.start(existing.id, magnetUri, "resuming");
      this.publishStats();
      return { id: existing.id, reused: true };
    }
    const globalHashOwner = infoHash
      ? db.prepare("SELECT user_id FROM torrents WHERE info_hash = ?").get(infoHash) as any
      : null;
    const storableInfoHash = globalHashOwner ? null : infoHash;

    const id = crypto.randomUUID();
    db.prepare("INSERT INTO torrents (id, user_id, info_hash, name, magnet_uri, status) VALUES (?, ?, ?, ?, ?, ?)").run(
      id, userId, storableInfoHash, "Fetching metadata", magnetUri, "connecting",
    );
    this.start(id, magnetUri, "downloading");
    this.publishStats();
    return { id, reused: false };
  }

  /** Add a torrent from an uploaded .torrent file buffer. */
  addTorrentFile(buffer: Buffer, userId: string) {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO torrents (id, user_id, name, magnet_uri, status) VALUES (?, ?, ?, ?, ?)").run(
      id, userId, "Fetching metadata", `torrentfile://${id}`, "downloading",
    );
    const torrent = this.client.add(buffer as unknown as string, {
      path: path.join(config.dataDir, "downloads", id),
    });
    this.bindTorrent(id, torrent);
    torrent.on("ready", () => {
      const magnet = (torrent as any).magnetURI;
      if (magnet) db.prepare("UPDATE torrents SET magnet_uri = ? WHERE id = ?").run(magnet, id);
    });
    return { id };
  }

  restore() {
    db.prepare(`
      UPDATE torrents
      SET status = 'completed', progress = 1, download_speed = 0, updated_at = CURRENT_TIMESTAMP
      WHERE progress >= 0.999 AND status NOT IN ('completed', 'paused', 'error')
    `).run();
    const rows = db.prepare("SELECT id, magnet_uri, status FROM torrents WHERE status != ? ORDER BY created_at").all("completed") as any[];
    for (const row of rows) {
      if (row.status === "paused") continue;
      if (String(row.magnet_uri).startsWith("local://")) continue; // uploads bucket, nothing to resume
      this.start(row.id, row.magnet_uri, "resuming");
    }
    logger.info({ count: rows.length }, "Torrent restore scan complete");
  }

  /** All torrents owned by a user. */
  list(userId: string) {
    return db.prepare("SELECT * FROM torrents WHERE user_id = ? ORDER BY created_at DESC").all(userId);
  }

  getDetail(id: string, userId: string) {
    const row = db.prepare("SELECT * FROM torrents WHERE id = ? AND user_id = ?").get(id, userId) as any;
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
        peerList: peers,
      },
    };
  }

  getFiles(torrentId?: string) {
    if (torrentId) return db.prepare("SELECT * FROM files WHERE torrent_id = ? ORDER BY path").all(torrentId);
    return db.prepare("SELECT * FROM files ORDER BY created_at DESC").all();
  }

  /** Ensure a user's uploads pseudo-torrent exists. */
  private ensureUploadsBucket(userId: string) {
    const bucketId = uploadsIdFor(userId);
    const existing = db.prepare("SELECT id FROM torrents WHERE id = ?").get(bucketId);
    if (!existing) {
      db.prepare("INSERT INTO torrents (id, user_id, name, magnet_uri, status, progress) VALUES (?, ?, ?, ?, ?, ?)")
        .run(bucketId, userId, "Uploads", "local://uploads", "completed", 1);
    }
    return bucketId;
  }

  registerUpload(meta: { relativeName: string; displayName: string; size: number }, userId: string) {
    const bucketId = this.ensureUploadsBucket(userId);
    const { kind, streamable, mimeType } = classifyFile(meta.displayName);
    const fileId = crypto.randomUUID();
    const probeStatus = streamable ? "pending" : "ready";
    db.prepare(`INSERT INTO files (id, torrent_id, user_id, name, path, size, mime, media_kind, streamable, probe_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(fileId, bucketId, userId, meta.displayName, meta.relativeName, meta.size, mimeType, kind, streamable, probeStatus);

    const total = db.prepare("SELECT COALESCE(SUM(size),0) AS s FROM files WHERE torrent_id = ?").get(bucketId) as any;
    db.prepare("UPDATE torrents SET size = ?, downloaded = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(total.s, total.s, bucketId);

    this.notifyUser(userId, "notification", { type: "success", title: "Upload complete", body: meta.displayName });
    this.publishStats();
    return { id: fileId, streamable: Boolean(streamable), media_kind: kind };
  }

  pause(id: string, userId: string) {
    if (!this.owns(id, userId)) return false;
    const torrent = this.find(id);
    if (!torrent) return false;
    torrent.pause();
    db.prepare("UPDATE torrents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("paused", id);
    this.notifyUser(userId, "torrent:paused", { id });
    return true;
  }

  resume(id: string, userId: string) {
    const row = db.prepare("SELECT magnet_uri FROM torrents WHERE id = ? AND user_id = ?").get(id, userId) as any;
    if (!row) return false;
    const torrent = this.find(id) ?? this.start(id, row.magnet_uri, "downloading");
    torrent.resume();
    db.prepare("UPDATE torrents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("downloading", id);
    this.notifyUser(userId, "torrent:resumed", { id });
    return true;
  }

  remove(id: string, userId: string, destroyStore = false) {
    if (!this.owns(id, userId)) return false;
    const torrent = this.find(id);
    if (torrent) this.client.remove(torrent.infoHash, { destroyStore });
    this.active.delete(id);
    db.prepare("DELETE FROM torrents WHERE id = ?").run(id);
    this.notifyUser(userId, "torrent:removed", { id });
    return true;
  }

  reannounce(id: string, userId: string) {
    if (!this.owns(id, userId)) return false;
    const torrent = this.find(id) as any;
    torrent?.announce?.();
    return Boolean(torrent);
  }

  forceRecheck(id: string, userId: string) {
    if (!this.owns(id, userId)) return false;
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

  markFileForProbe(fileId: string, userId: string) {
    const result = db.prepare(`
      UPDATE files SET probe_status = 'pending', probe_error = NULL
      WHERE id = ? AND streamable = 1 AND user_id = ?
    `).run(fileId, userId) as any;
    return result.changes > 0;
  }

  private bindTorrent(id: string, torrent: Torrent) {
    this.active.set(id, torrent);
    torrent.on("metadata", () => {
      const ownerId = this.ownerOf(id);
      try {
        db.prepare("UPDATE torrents SET info_hash = ?, name = ?, size = ?, status = ? WHERE id = ?").run(
          torrent.infoHash, torrent.name, torrent.length, "downloading", id,
        );
      } catch (error: any) {
        if (error?.code !== "SQLITE_CONSTRAINT_UNIQUE") throw error;
        db.prepare("UPDATE torrents SET name = ?, size = ?, status = ? WHERE id = ?").run(
          torrent.name, torrent.length, "downloading", id,
        );
      }
      const insert = db.prepare(`INSERT OR IGNORE INTO files
        (id, torrent_id, user_id, name, path, size, mime, media_kind, streamable, probe_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const file of torrent.files) {
        const { kind, streamable, mimeType } = classifyFile(file.name);
        insert.run(crypto.randomUUID(), id, ownerId, file.name, file.path, file.length, mimeType, kind, streamable, streamable ? "pending" : "ready");
        if (kind === "video") file.select();
      }
      if (ownerId) this.notifyUser(ownerId, "torrent:metadata", { id, name: torrent.name });
    });

    torrent.on("download", () => this.update(id, torrent));
    torrent.on("upload", () => this.update(id, torrent));
    torrent.on("done", () => {
      this.completeTorrent(id, torrent);
    });
    torrent.on("error", (error: Error) => {
      logger.error({ error, id }, "Torrent error");
      db.prepare("UPDATE torrents SET status = ? WHERE id = ?").run("error", id);
    });
  }

  private start(id: string, magnetUri: string, status: string) {
    db.prepare("UPDATE torrents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
    const torrent = this.client.add(magnetUri, { path: path.join(config.dataDir, "downloads", id) });
    this.bindTorrent(id, torrent);
    return torrent;
  }

  private update(id: string, torrent: Torrent, status = "downloading") {
    if (status !== "completed" && torrent.progress >= 0.999) {
      this.completeTorrent(id, torrent);
      return;
    }
    db.prepare(`UPDATE torrents SET progress = ?, download_speed = ?, upload_speed = ?,
      downloaded = ?, uploaded = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      torrent.progress, torrent.downloadSpeed, torrent.uploadSpeed, torrent.downloaded, torrent.uploaded, status, id,
    );
  }

  private completeTorrent(id: string, torrent: Torrent) {
    const alreadyCompleted = db.prepare("SELECT status FROM torrents WHERE id = ?").get(id) as any;
    db.prepare(`UPDATE torrents SET progress = ?, download_speed = 0, upload_speed = 0,
      downloaded = ?, uploaded = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      1, torrent.downloaded, torrent.uploaded, "completed", id,
    );
    const ownerId = this.ownerOf(id);
    if (ownerId && alreadyCompleted?.status !== "completed") {
      this.notifyUser(ownerId, "notification", { type: "success", title: "Torrent completed", body: torrent.name });
    }
    this.stopSeeding(id, torrent);
    this.publishStats();
  }

  private stopSeeding(id: string, torrent: Torrent) {
    this.active.delete(id);
    try {
      this.client.remove(torrent.infoHash, { destroyStore: false });
    } catch (error) {
      logger.warn({ error, id }, "Could not stop completed torrent");
    }
  }

  /** Emit an event only to the sockets belonging to one user. */
  private notifyUser(userId: string, event: string, payload: unknown) {
    this.io?.to(`u:${userId}`).emit(event, payload);
  }

  /** Push each connected socket only its own user's torrent list. */
  private publishStats() {
    if (!this.io) return;
    for (const [, socket] of this.io.sockets.sockets) {
      const uid = (socket.data as any)?.userId;
      if (uid) socket.emit("torrents:update", this.list(uid));
    }
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
      interested: Boolean(wire.peerInterested),
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
      map,
    };
  }
}

export const torrentService = new TorrentService();
