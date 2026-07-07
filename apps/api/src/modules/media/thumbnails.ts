import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";

const execFileAsync = promisify(execFile);

export async function generateThumbnail(fileId: string, diskPath: string) {
  const dir = path.join(config.dataDir, "thumbnails");
  fs.mkdirSync(dir, { recursive: true });
  const output = path.join(dir, `${fileId}.jpg`);
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-ss", "00:00:03",
      "-i", diskPath,
      "-frames:v", "1",
      "-vf", "scale=480:-2",
      "-q:v", "4",
      output
    ], { timeout: 30_000, windowsHide: true });
    db.prepare("UPDATE files SET thumbnail_path = ? WHERE id = ?").run(path.relative(config.dataDir, output), fileId);
  } catch (error) {
    logger.warn({ error, fileId }, "Thumbnail generation failed");
  }
}

export function thumbnailPath(relative: string | null | undefined) {
  if (!relative) return null;
  const resolved = path.resolve(config.dataDir, relative);
  const root = path.resolve(config.dataDir);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}
