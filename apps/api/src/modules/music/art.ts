import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";

/**
 * Persist album art once per distinct image. Content-addressed so a hundred
 * tracks sharing one embedded cover write a single file, and re-scans are free.
 */
export function storeArt(data: Uint8Array, mime: string | undefined): string {
  fs.mkdirSync(config.musicArtDir, { recursive: true });
  const ext = mime?.includes("png") ? ".png" : mime?.includes("webp") ? ".webp" : ".jpg";
  const name = crypto.createHash("sha1").update(data).digest("hex") + ext;
  const target = path.join(config.musicArtDir, name);
  if (!fs.existsSync(target)) fs.writeFileSync(target, data);
  return name;
}
