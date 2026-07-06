import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { db } from "../../db/schema.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { resolveDiskPath } from "../files/fileService.js";

// One live ffmpeg -> HLS session per file. HLS (segmented .ts + growing playlist)
// is far more reliable than a live fragmented-MP4 pipe for browser playback of an
// on-the-fly transcode — it buffers, recovers, and seeks within the produced range.
type Session = { dir: string; proc: ChildProcess; lastAccess: number };
const sessions = new Map<string, Session>();
const HLS_ROOT = path.join(config.dataDir, "hls");
const IDLE_MS = 90_000;

const dirFor = (fileId: string) => path.join(HLS_ROOT, crypto.createHash("sha1").update(fileId).digest("hex").slice(0, 16));

function ensureSession(fileId: string, diskPath: string): Session {
  const existing = sessions.get(fileId);
  if (existing && !existing.proc.killed) {
    existing.lastAccess = Date.now();
    return existing;
  }
  const dir = dirFor(fileId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const proc = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", diskPath,
    "-map", "0:v:0", "-map", "0:a:0?", "-sn",
    "-vf", `scale=-2:${config.transcodeHeight}`,
    "-c:v", "libx264", "-preset", config.transcodePreset, "-tune", "zerolatency", "-crf", String(config.transcodeCrf), "-pix_fmt", "yuv420p",
    "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
    "-c:a", "aac", "-ac", "2", "-b:a", "128k",
    "-f", "hls",
    "-hls_time", "4",
    "-hls_list_size", "0",
    "-hls_flags", "independent_segments",
    "-hls_playlist_type", "event",
    "-hls_segment_filename", path.join(dir, "seg%04d.ts"),
    path.join(dir, "index.m3u8"),
  ], { windowsHide: true });
  proc.stderr?.on("data", () => undefined);
  proc.on("close", (code) => { if (code && code !== 255) logger.warn({ code, fileId }, "HLS transcode exited"); });
  proc.on("error", (err) => logger.warn({ err, fileId }, "HLS transcode failed to start"));
  const session: Session = { dir, proc, lastAccess: Date.now() };
  sessions.set(fileId, session);
  return session;
}

// Reap idle sessions: stop ffmpeg and delete the segment directory.
setInterval(() => {
  const now = Date.now();
  for (const [fileId, s] of sessions) {
    if (now - s.lastAccess > IDLE_MS) {
      try { if (!s.proc.killed) s.proc.kill("SIGKILL"); } catch { /* ignore */ }
      try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch { /* ignore */ }
      sessions.delete(fileId);
    }
  }
}, 30_000).unref();

function ownsOr404(req: any, res: Response) {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id) as any;
  if (!file) { res.status(404).json({ error: "File not found" }); return null; }
  if (req.user?.sub && file.user_id && file.user_id !== req.user.sub) { res.status(404).json({ error: "File not found" }); return null; }
  return file;
}

export function hlsPlaylist(req: any, res: Response) {
  const file = ownsOr404(req, res);
  if (!file) return;
  const diskPath = resolveDiskPath(file);
  if (!fs.existsSync(diskPath)) return res.status(425).json({ error: "File pieces are not available yet" });
  if (!sessions.has(req.params.id) && sessions.size >= config.maxTranscodes) {
    return res.status(429).json({ error: "Another video is transcoding. Try again in a moment." });
  }
  const session = ensureSession(req.params.id, diskPath);
  const playlist = path.join(session.dir, "index.m3u8");
  const st = encodeURIComponent(String((req.query as any).st ?? ""));
  const started = Date.now();
  const trySend = () => {
    if (res.writableEnded) return;
    if (fs.existsSync(playlist)) {
      let body = fs.readFileSync(playlist, "utf8");
      // Carry the stream token onto each segment request so hls.js stays authed.
      body = body.replace(/^(seg\d+\.ts)\s*$/gm, `$1?st=${st}`);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store");
      return res.send(body);
    }
    if (Date.now() - started > 25000) return res.status(504).json({ error: "Transcode did not start in time" });
    setTimeout(trySend, 250);
  };
  trySend();
}

export function hlsSegment(req: any, res: Response) {
  const seg = path.basename(req.params.seg ?? "");
  if (!/^seg\d+\.ts$/.test(seg)) return res.status(400).end();
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).end();
  session.lastAccess = Date.now();
  const file = path.join(session.dir, seg);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader("Content-Type", "video/mp2t");
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(file).pipe(res);
}
