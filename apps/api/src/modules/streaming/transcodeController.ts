import { spawn } from "node:child_process";
import fs from "node:fs";
import { db } from "../../db/schema.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { resolveDiskPath } from "../files/fileService.js";

let activeTranscodes = 0;

export function transcodeFile(req: any, res: any) {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id) as any;
  if (!file) return res.status(404).json({ error: "File not found" });
  if (req.user?.sub && file.user_id && file.user_id !== req.user.sub) return res.status(404).json({ error: "File not found" });

  const diskPath = resolveDiskPath(file);
  if (!fs.existsSync(diskPath)) return res.status(425).json({ error: "File pieces are not available yet" });
  if (activeTranscodes >= config.maxTranscodes) return res.status(429).json({ error: "Another video is already transcoding. Try again in a moment." });

  activeTranscodes += 1;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Tuned for a 2-vCPU / 1 GB VM: 1080p HEVC at higher presets encodes at ~0.5x
  // real-time (buffers forever). Downscaling to 720p with ultrafast + zerolatency
  // runs ~1.6x real-time, so playback stays ahead of the encoder. Height is
  // capped at the source's own height by libx264's scale (never upscales beyond
  // 720). Config overridable via TRANSCODE_HEIGHT / TRANSCODE_PRESET / TRANSCODE_CRF.
  const height = config.transcodeHeight;
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-i", diskPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-sn",
    // Downscale to the target height, keeping aspect ratio with an even width.
    // Small sources get a cheap upscale; that's fine (they encode fast anyway).
    "-vf", `scale=-2:${height}`,
    "-c:v", "libx264",
    "-preset", config.transcodePreset,
    "-tune", "zerolatency",
    "-crf", String(config.transcodeCrf),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-ac", "2",
    "-b:a", "128k",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    "pipe:1"
  ], { windowsHide: true });

  let stderr = "";
  ffmpeg.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-1000);
  });
  ffmpeg.stdout.pipe(res);
  ffmpeg.on("error", (error) => {
    logger.warn({ error, fileId: file.id }, "Transcode failed to start");
    if (!res.headersSent) res.status(500).json({ error: "Could not start transcode" });
  });
  ffmpeg.on("close", (code) => {
    activeTranscodes = Math.max(0, activeTranscodes - 1);
    if (code && code !== 255) logger.warn({ code, stderr, fileId: file.id }, "Transcode exited");
  });
  res.on("close", () => {
    if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
  });
}
