import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { db } from "../../db/schema.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { resolveDiskPath } from "../files/fileService.js";

// Seekable on-the-fly HLS.
//
// The playlist is a *complete VOD manifest* synthesized from the file's duration,
// so the player sees the full timeline immediately and can seek anywhere. Segments
// are produced by a single ffmpeg per file; when the player requests a segment the
// encoder hasn't reached (a forward seek, or a resume after the idle reaper killed
// the session), we restart ffmpeg exactly at that segment (`-ss`). Forced keyframes
// every SEG_SECONDS keep segment boundaries identical across restarts, and
// -output_ts_offset keeps timestamps aligned with the playlist position.
const SEG_SECONDS = 4;

type Session = {
  dir: string;
  proc: ChildProcess;
  startSeg: number;
  exited: boolean;
  lastAccess: number;
};
const sessions = new Map<string, Session>();
const HLS_ROOT = path.join(config.dataDir, "hls");
const IDLE_MS = 90_000;

const dirFor = (fileId: string) => path.join(HLS_ROOT, crypto.createHash("sha1").update(fileId).digest("hex").slice(0, 16));

function killSession(fileId: string) {
  const s = sessions.get(fileId);
  if (!s) return;
  try { if (!s.proc.killed) s.proc.kill("SIGKILL"); } catch { /* ignore */ }
  try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  sessions.delete(fileId);
}

function startSession(fileId: string, diskPath: string, startSeg: number): Session {
  killSession(fileId);
  const dir = dirFor(fileId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const proc = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    // Read at ~real-time so the encoder never pegs both vCPUs racing to the end;
    // it stays a few segments ahead of playback and the idle reaper can stop it.
    "-re",
    "-ss", String(startSeg * SEG_SECONDS),
    "-i", diskPath,
    "-map", "0:v:0", "-map", "0:a:0?", "-sn",
    "-vf", `scale=-2:${config.transcodeHeight}`,
    "-c:v", "libx264", "-preset", config.transcodePreset, "-tune", "zerolatency", "-crf", String(config.transcodeCrf), "-pix_fmt", "yuv420p",
    // Keyframe exactly every SEG_SECONDS so segment N has identical timing no
    // matter which -ss restart produced it.
    "-force_key_frames", `expr:gte(t,n_forced*${SEG_SECONDS})`,
    "-sc_threshold", "0",
    "-c:a", "aac", "-ac", "2", "-b:a", "128k",
    "-f", "hls",
    "-hls_time", String(SEG_SECONDS),
    "-hls_list_size", "0",
    "-hls_flags", "independent_segments",
    "-start_number", String(startSeg),
    "-output_ts_offset", String(startSeg * SEG_SECONDS),
    "-hls_segment_filename", path.join(dir, "seg%04d.ts"),
    path.join(dir, "live.m3u8"),
  ], { windowsHide: true });
  proc.stderr?.on("data", () => undefined);
  const session: Session = { dir, proc, startSeg, exited: false, lastAccess: Date.now() };
  proc.on("close", (code) => {
    session.exited = true;
    if (code && code !== 255) logger.warn({ code, fileId }, "HLS transcode exited");
  });
  proc.on("error", (err) => {
    session.exited = true;
    logger.warn({ err, fileId }, "HLS transcode failed to start");
  });
  sessions.set(fileId, session);
  return session;
}

// Reap idle sessions: stop ffmpeg and delete the segment directory. A later
// segment request simply restarts the encoder at that segment.
setInterval(() => {
  const now = Date.now();
  for (const [fileId, s] of sessions) {
    if (now - s.lastAccess > IDLE_MS) killSession(fileId);
  }
}, 30_000).unref();

function ownsOr404(req: any, res: Response) {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id) as any;
  if (!file) { res.status(404).json({ error: "File not found" }); return null; }
  if (req.user?.sub && file.user_id && file.user_id !== req.user.sub) { res.status(404).json({ error: "File not found" }); return null; }
  return file;
}

function ffprobeDuration(diskPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", diskPath], { windowsHide: true });
    let out = "";
    proc.stdout?.on("data", (chunk) => { out += chunk; });
    proc.on("close", () => {
      const value = Number.parseFloat(out.trim());
      resolve(Number.isFinite(value) && value > 0 ? value : null);
    });
    proc.on("error", () => resolve(null));
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } }, 15_000).unref();
  });
}

/** Segment N is safe to serve once ffmpeg has finalized it (listed in its own
 *  playlist) or the encoder finished the whole file. */
function segmentReady(session: Session, seg: number): boolean {
  const name = `seg${String(seg).padStart(4, "0")}.ts`;
  const file = path.join(session.dir, name);
  if (!fs.existsSync(file)) return false;
  if (session.exited) return true;
  try {
    const listed = fs.readFileSync(path.join(session.dir, "live.m3u8"), "utf8");
    return listed.includes(name);
  } catch {
    return false;
  }
}

/** Highest segment ffmpeg has finalized so far (or startSeg - 1). */
function encodeHead(session: Session): number {
  try {
    const listed = fs.readFileSync(path.join(session.dir, "live.m3u8"), "utf8");
    const matches = [...listed.matchAll(/seg(\d+)\.ts/g)];
    return matches.length ? Number(matches[matches.length - 1][1]) : session.startSeg - 1;
  } catch {
    return session.startSeg - 1;
  }
}

export async function hlsPlaylist(req: any, res: Response) {
  const file = ownsOr404(req, res);
  if (!file) return;
  const diskPath = resolveDiskPath(file);
  if (!fs.existsSync(diskPath)) return res.status(425).json({ error: "File pieces are not available yet" });

  let duration: number | null = typeof file.duration === "number" && file.duration > 0 ? file.duration : null;
  if (!duration) {
    duration = await ffprobeDuration(diskPath);
    if (duration) db.prepare("UPDATE files SET duration = ? WHERE id = ?").run(duration, file.id);
  }
  if (!duration) return res.status(500).json({ error: "Could not determine video duration" });

  // Full VOD manifest up-front: the player gets the whole timeline and free seeking.
  const st = encodeURIComponent(String((req.query as any).st ?? ""));
  const segments = Math.ceil(duration / SEG_SECONDS);
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${SEG_SECONDS}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (let i = 0; i < segments; i += 1) {
    const len = i === segments - 1 ? duration - i * SEG_SECONDS : SEG_SECONDS;
    lines.push(`#EXTINF:${len.toFixed(3)},`, `seg${String(i).padStart(4, "0")}.ts?st=${st}`);
  }
  lines.push("#EXT-X-ENDLIST");
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.setHeader("Cache-Control", "no-store");
  res.send(lines.join("\n"));
}

export async function hlsSegment(req: any, res: Response) {
  const name = path.basename(req.params.seg ?? "");
  const match = /^seg(\d{4})\.ts$/.exec(name);
  if (!match) return res.status(400).end();
  const seg = Number(match[1]);
  const file = ownsOr404(req, res);
  if (!file) return;
  const diskPath = resolveDiskPath(file);
  if (!fs.existsSync(diskPath)) return res.status(425).end();

  let session = sessions.get(file.id);
  // Restart the encoder when the request is outside what this session covers:
  // before its start (backward seek), or far past its encode head (forward seek
  // or a resume after reaping). A small forward window avoids restarting for
  // the player's normal read-ahead.
  const needsRestart =
    !session ||
    (session.exited && !segmentReady(session, seg)) ||
    seg < session.startSeg ||
    seg > encodeHead(session) + 6;
  if (needsRestart) {
    if (!sessions.has(file.id) && sessions.size >= config.maxTranscodes) {
      return res.status(429).json({ error: "Another video is transcoding. Try again in a moment." });
    }
    session = startSession(file.id, diskPath, seg);
  }
  session!.lastAccess = Date.now();

  const started = Date.now();
  const trySend = () => {
    if (res.writableEnded) return;
    const current = sessions.get(file.id);
    if (!current) return res.status(409).end();
    current.lastAccess = Date.now();
    if (segmentReady(current, seg)) {
      res.setHeader("Content-Type", "video/mp2t");
      res.setHeader("Cache-Control", "no-store");
      fs.createReadStream(path.join(current.dir, name)).pipe(res);
      return;
    }
    if (current.exited) return res.status(404).end();
    if (Date.now() - started > 30_000) return res.status(504).end();
    setTimeout(trySend, 250);
  };
  trySend();
}
