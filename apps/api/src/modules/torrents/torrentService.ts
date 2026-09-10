import crypto from "node:crypto";
import path from "node:path";
import mime from "mime-types";
import WebTorrent, { Torrent } from "webtorrent";
import { Server } from "socket.io";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";
import { withQuotaAllocation } from "../storage/storageService.js";

const videoExt = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".mpeg", ".mpg"]);
const audioExt = new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".weba"]);
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** Lifecycle states that raw transfer activity must never advance on its own. */
const HELD_STATUSES = new Set(["paused", "awaiting_selection", "fetching_metadata"]);

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

/** Translate a configured byte/sec cap into WebTorrent's throttle argument.
 *
 *  The config follows the usual convention where 0 means "no limit", but
 *  WebTorrent reads -1 as unlimited and treats 0 literally -- throttling to
 *  zero bytes a second. Passing the config value straight through would stall
 *  transfers completely, so the two conventions have to be bridged here. */
export function throttleRate(configured: number): number {
  return Number.isFinite(configured) && configured > 0 ? configured : -1;
}

export class TorrentService {
  private readonly client = new WebTorrent({
    maxConns: config.torrentMaxConns,
    torrentPort: config.torrentPort,
    downloadLimit: throttleRate(config.maxDownloadRate),
    uploadLimit: throttleRate(config.maxUploadRate),
  });
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
      if (!this.find(existing.id) && !["completed", "paused", "error"].includes(existing.status)) {
        this.start(existing.id, magnetUri, existing.status === "awaiting_selection" ? "awaiting_selection" : "resuming");
      }
      this.publishStats();
      return { id: existing.id, reused: true, selectionRequired: existing.status === "awaiting_selection" || existing.status === "fetching_metadata" };
    }
    const globalHashOwner = infoHash
      ? db.prepare("SELECT user_id FROM torrents WHERE info_hash = ?").get(infoHash) as any
      : null;
    const storableInfoHash = globalHashOwner ? null : infoHash;

    const id = crypto.randomUUID();
    db.prepare("INSERT INTO torrents (id, user_id, info_hash, name, magnet_uri, status) VALUES (?, ?, ?, ?, ?, ?)").run(
      id, userId, storableInfoHash, "Fetching metadata", magnetUri, "fetching_metadata",
    );
    this.start(id, magnetUri, "fetching_metadata");
    this.publishStats();
    return { id, reused: false, selectionRequired: true };
  }

  /** Add a torrent from an uploaded .torrent file buffer. */
  addTorrentFile(buffer: Buffer, userId: string) {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO torrents (id, user_id, name, magnet_uri, status) VALUES (?, ?, ?, ?, ?)").run(
      id, userId, "Fetching metadata", `torrentfile://${id}`, "fetching_metadata",
    );
    const torrent = this.client.add(buffer as unknown as string, {
      path: path.join(config.dataDir, "downloads", id),
      deselect: true,
    });
    this.bindTorrent(id, torrent);
    torrent.on("ready", () => {
      const magnet = (torrent as any).magnetURI;
      if (magnet) db.prepare("UPDATE torrents SET magnet_uri = ? WHERE id = ?").run(magnet, id);
    });
    return { id, selectionRequired: true };
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
      this.start(row.id, row.magnet_uri, row.status === "awaiting_selection" ? "awaiting_selection" : "resuming");
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
    const row = db.prepare("SELECT status FROM torrents WHERE id = ?").get(id) as any;
    if (row?.status === "awaiting_selection" || row?.status === "fetching_metadata") return false;
    const torrent = this.find(id);
    torrent?.pause();
    db.prepare("UPDATE torrents SET status = ?, download_speed = 0, upload_speed = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("paused", id);
    this.notifyUser(userId, "torrent:paused", { id });
    this.publishStats();
    return true;
  }

  resume(id: string, userId: string) {
    const row = db.prepare("SELECT magnet_uri, status FROM torrents WHERE id = ? AND user_id = ?").get(id, userId) as any;
    if (!row) return false;
    if (row.status === "awaiting_selection" || row.status === "fetching_metadata") return false;
    const torrent = this.find(id) ?? this.start(id, row.magnet_uri, "downloading");
    torrent.resume();
    db.prepare("UPDATE torrents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("downloading", id);
    this.notifyUser(userId, "torrent:resumed", { id });
    this.publishStats();
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
    return reannounceTorrent(torrent);
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

  selectFiles(id: string, userId: string, fileIds: string[]) {
    const row = db.prepare("SELECT status, magnet_uri FROM torrents WHERE id = ? AND user_id = ?").get(id, userId) as any;
    if (!row) return null;
    const uniqueIds = [...new Set(fileIds)];
    const files = db.prepare("SELECT id, path, size, selected FROM files WHERE torrent_id = ? AND user_id = ?").all(id, userId) as any[];
    const chosen = files.filter((file) => uniqueIds.includes(file.id));
    if (chosen.length !== uniqueIds.length) {
      const error = new Error("One or more selected files do not belong to this torrent");
      (error as any).status = 400;
      throw error;
    }
    const selectedBytes = chosen.reduce((sum, file) => sum + Number(file.size), 0);
    if (!Number.isSafeInteger(selectedBytes) || selectedBytes <= 0) throw new Error("Select at least one non-empty file");
    if (row.status !== "awaiting_selection") {
      const persisted = files.filter((file) => file.selected === 1).map((file) => file.id).sort();
      const requested = [...uniqueIds].sort();
      if (["downloading", "completed"].includes(row.status) && persisted.length === requested.length && persisted.every((id, index) => id === requested[index])) {
        return { id, selectedFiles: chosen.length, selectedBytes };
      }
      const error = new Error("File selection is only available before downloading starts");
      (error as any).status = 409;
      throw error;
    }

    withQuotaAllocation(userId, selectedBytes, () => {
      db.prepare("UPDATE files SET selected = 0 WHERE torrent_id = ? AND user_id = ?").run(id, userId);
      const mark = db.prepare("UPDATE files SET selected = 1 WHERE id = ? AND torrent_id = ? AND user_id = ?");
      for (const file of chosen) mark.run(file.id, id, userId);
      db.prepare("UPDATE torrents SET size = ?, status = 'downloading', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(selectedBytes, id);
    });

    try {
      // Re-add the torrent when it is not live (e.g. the picker was left open
      // across a restart); otherwise the row says "downloading" but no session
      // exists and the transfer would sit at 0% forever. A freshly started
      // torrent applies the saved selection from its own metadata handler.
      const torrent = this.find(id) ?? this.start(id, row.magnet_uri, "downloading");
      if (torrent.files.length) {
        const paths = new Set(chosen.map((file) => file.path));
        // Two passes, never interleaved: neighbouring files share the pieces at
        // their boundaries, so deselecting an unwanted file after selecting a
        // wanted one strips that shared piece back off the wanted file, and the
        // download then stalls a hair short of complete and never finishes.
        for (const file of torrent.files) file.deselect();
        for (const file of torrent.files) if (paths.has(file.path)) file.select();
        torrent.resume();
      }
    } catch (error) {
      // The database selection is authoritative and will be restored after a
      // restart. Do not report a failed request after it was already committed.
      logger.warn({ error, id }, "Could not apply torrent selection to active session");
    }
    this.notifyUser(userId, "torrent:selection", { id });
    this.publishStats();
    return { id, selectedFiles: chosen.length, selectedBytes };
  }

  markFileForProbe(fileId: string, userId: string) {
    const result = db.prepare(`
      UPDATE files SET probe_status = 'pending', probe_error = NULL
      WHERE id = ? AND streamable = 1 AND selected = 1 AND user_id = ?
    `).run(fileId, userId) as any;
    return result.changes > 0;
  }

  private bindTorrent(id: string, torrent: Torrent) {
    this.active.set(id, torrent);
    torrent.on("metadata", () => {
      const ownerId = this.ownerOf(id);
      try {
        // WebTorrent selects every file by default. Stop payload transfer while
        // metadata is presented to the user, then restore a saved selection.
        for (const file of torrent.files) file.deselect();
        const alreadyRegistered = (db.prepare("SELECT COUNT(*) AS n FROM files WHERE torrent_id = ?").get(id) as any).n > 0;
        const persistMetadata = () => {
          const current = db.prepare("SELECT status FROM torrents WHERE id = ?").get(id) as any;
          const waiting = !alreadyRegistered || current?.status === "fetching_metadata" || current?.status === "awaiting_selection";
          const nextStatus = current?.status === "paused" ? "paused" : waiting ? "awaiting_selection" : "downloading";
          try {
            db.prepare("UPDATE torrents SET info_hash = ?, name = ?, size = ?, status = ? WHERE id = ?").run(
              torrent.infoHash, torrent.name, torrent.length, nextStatus, id,
            );
          } catch (error: any) {
            if (error?.code !== "SQLITE_CONSTRAINT_UNIQUE") throw error;
            db.prepare("UPDATE torrents SET name = ?, size = ?, status = ? WHERE id = ?").run(
              torrent.name, torrent.length, nextStatus, id,
            );
          }
          // Deduplicated by the unique (torrent_id, path) index — "metadata" is
          // re-emitted whenever the torrent is re-added, e.g. on every restart.
          const insert = db.prepare(`INSERT OR IGNORE INTO files
            (id, torrent_id, user_id, name, path, size, mime, media_kind, streamable, probe_status, selected)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`);
          for (const file of torrent.files) {
            const { kind, streamable, mimeType } = classifyFile(file.name);
            insert.run(crypto.randomUUID(), id, ownerId, file.name, file.path, file.length, mimeType, kind, streamable, streamable ? "pending" : "ready");
          }
          const selectedPaths = db.prepare("SELECT path FROM files WHERE torrent_id = ? AND selected = 1").all(id) as any[];
          if (!waiting) {
            const selected = new Set(selectedPaths.map((file) => file.path));
            for (const file of torrent.files) if (selected.has(file.path)) file.select();
          }
        };
        persistMetadata();
      } catch (error: any) {
        db.prepare("UPDATE torrents SET status = ?, size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("error", torrent.length, id);
        if (ownerId) this.notifyUser(ownerId, "notification", { type: "error", title: "Could not add torrent", body: error.message ?? torrent.name });
        this.stopSeeding(id, torrent);
        this.publishStats();
        return;
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
    // deselect: true stops WebTorrent from selecting the whole torrent on
    // metadata. Selection is always explicit here, so nothing is fetched until
    // the user chooses -- otherwise the payload starts arriving in the window
    // before the metadata handler can deselect it.
    const torrent = this.client.add(magnetUri, { path: path.join(config.dataDir, "downloads", id), deselect: true });
    this.bindTorrent(id, torrent);
    return torrent;
  }

  private update(id: string, torrent: Torrent, status = "downloading") {
    const current = db.prepare("SELECT status FROM torrents WHERE id = ?").get(id) as any;
    const transfer = this.getSelectedTransfer(id, torrent);
    // Record the counters but keep the status. A torrent still waiting on the
    // user's file choice happily uploads to peers, and the "upload" event would
    // otherwise rewrite the row as "downloading" -- which makes the pending
    // selection look like a download that already began, so submitting the
    // picker is refused with a 409 and it springs straight back open.
    if (current?.status && HELD_STATUSES.has(current.status)) {
      const paused = current.status === "paused";
      db.prepare(`UPDATE torrents SET progress = ?, download_speed = ?, upload_speed = ?,
        downloaded = ?, uploaded = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        transfer.progress, paused ? 0 : torrent.downloadSpeed, paused ? 0 : torrent.uploadSpeed,
        transfer.downloaded, torrent.uploaded, id,
      );
      return;
    }
    if (status !== "completed" && transfer.selectedBytes > 0 && transfer.progress >= 0.999) {
      this.completeTorrent(id, torrent);
      return;
    }
    db.prepare(`UPDATE torrents SET progress = ?, download_speed = ?, upload_speed = ?,
      downloaded = ?, uploaded = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      transfer.progress, torrent.downloadSpeed, torrent.uploadSpeed, transfer.downloaded, torrent.uploaded, status, id,
    );
  }

  private completeTorrent(id: string, torrent: Torrent) {
    const alreadyCompleted = db.prepare("SELECT status, size FROM torrents WHERE id = ?").get(id) as any;
    // "done" fires when every file is present, which must not retire a torrent
    // the user has not chosen files for yet -- that would strand its files
    // unselected and therefore invisible in the library.
    if (alreadyCompleted?.status === "awaiting_selection" || alreadyCompleted?.status === "fetching_metadata") return;
    db.prepare(`UPDATE torrents SET progress = ?, download_speed = 0, upload_speed = 0,
      downloaded = ?, uploaded = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      1, Number(alreadyCompleted?.size ?? torrent.downloaded), torrent.uploaded, "completed", id,
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

  private getSelectedTransfer(id: string, torrent: Torrent) {
    const rows = db.prepare("SELECT path, size FROM files WHERE torrent_id = ? AND selected = 1").all(id) as any[];
    const selected = new Map(rows.map((row) => [row.path, Number(row.size)]));
    let selectedBytes = 0;
    let downloaded = 0;
    for (const file of torrent.files) {
      const size = selected.get(file.path);
      if (size === undefined) continue;
      selectedBytes += size;
      downloaded += Math.min(size, Number(file.downloaded ?? 0));
    }
    return {
      selectedBytes,
      downloaded,
      progress: selectedBytes > 0 ? Math.min(1, downloaded / selectedBytes) : 0,
    };
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

/** WebTorrent exposes announce URLs on `torrent.announce`; the callable lives on discovery.tracker. */
export function reannounceTorrent(torrent: any): boolean {
  const tracker = torrent?.discovery?.tracker;
  if (typeof tracker?.announce === "function") {
    tracker.announce();
    return true;
  }
  if (typeof torrent?.announce === "function") {
    torrent.announce();
    return true;
  }
  return false;
}

export const torrentService = new TorrentService();
