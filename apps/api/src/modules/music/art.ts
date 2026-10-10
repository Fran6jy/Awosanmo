import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";

// Known advertising images embedded by download sites. Content hashes let us
// reject the image even when its tag description and surrounding metadata are
// blank or otherwise legitimate.
const BLOCKED_ART_HASHES = new Set([
  "51c11874e412ef68e0473170209f46062566ac22",
]);

export function isBlockedArtPath(value: string | null | undefined): boolean {
  if (!value) return false;
  return BLOCKED_ART_HASHES.has(path.parse(value).name.toLowerCase());
}

/**
 * Persist album art once per distinct image. Content-addressed so a hundred
 * tracks sharing one embedded cover write a single file, and re-scans are free.
 */
export function storeArt(data: Uint8Array, mime: string | undefined): string | null {
  const ext = mime?.includes("png") ? ".png" : mime?.includes("webp") ? ".webp" : ".jpg";
  const hash = crypto.createHash("sha1").update(data).digest("hex");
  const name = hash + ext;
  if (BLOCKED_ART_HASHES.has(hash)) {
    try { fs.unlinkSync(path.join(config.musicArtDir, name)); } catch {}
    return null;
  }
  fs.mkdirSync(config.musicArtDir, { recursive: true });
  const target = path.join(config.musicArtDir, name);
  if (!fs.existsSync(target)) fs.writeFileSync(target, data);
  return name;
}
