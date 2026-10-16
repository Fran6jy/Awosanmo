import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";

const wallpaperDir = path.resolve(config.dataDir, "wallpapers");
fs.mkdirSync(wallpaperDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req: unknown, _file: unknown, callback: (error: Error | null, destination: string) => void) => callback(null, wallpaperDir),
  filename: (req: any, _file: unknown, callback: (error: Error | null, filename: string) => void) => callback(null, `${req.user.id}-${crypto.randomUUID()}.upload`),
});
const upload = multer({ storage, limits: { fileSize: config.maxWallpaperBytes } });

type ImageFormat = { extension: ".jpg" | ".png" | ".webp"; mime: string };

export function detectWallpaperFormat(filePath: string): ImageFormat | null {
  const handle = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    fs.readSync(handle, header, 0, header.length, 0);
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return { extension: ".jpg", mime: "image/jpeg" };
    if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: ".png", mime: "image/png" };
    if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return { extension: ".webp", mime: "image/webp" };
    return null;
  } finally {
    fs.closeSync(handle);
  }
}

function ownedWallpaperPath(userId: string): string | null {
  const row = db.prepare("SELECT wallpaper_path FROM users WHERE id = ?").get(userId) as { wallpaper_path?: string | null } | undefined;
  if (!row?.wallpaper_path) return null;
  const resolved = path.resolve(row.wallpaper_path);
  return resolved.startsWith(`${wallpaperDir}${path.sep}`) ? resolved : null;
}

export const wallpaperRoutes = Router();

wallpaperRoutes.get("/", (req: any, res) => {
  const filePath = ownedWallpaperPath(req.user.id);
  if (!filePath || !fs.existsSync(filePath)) return res.sendStatus(204);
  const format = detectWallpaperFormat(filePath);
  if (!format) return res.sendStatus(204);
  res.setHeader("Cache-Control", "private, no-store");
  res.type(format.mime);
  return res.sendFile(filePath);
});

wallpaperRoutes.put("/", (req: any, res) => {
  upload.single("wallpaper")(req, res, (error: any) => {
    if (error) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "Wallpaper exceeds the 20 MB limit" : "Wallpaper upload failed" });
    }
    const incoming = req.file as { path: string } | undefined;
    if (!incoming) return res.status(400).json({ error: "No wallpaper provided" });
    const format = detectWallpaperFormat(incoming.path);
    if (!format) {
      fs.rmSync(incoming.path, { force: true });
      return res.status(415).json({ error: "Choose a valid JPG, PNG, or WebP image" });
    }

    const previous = ownedWallpaperPath(req.user.id);
    const finalPath = path.join(wallpaperDir, `${req.user.id}${format.extension}`);
    try {
      fs.renameSync(incoming.path, finalPath);
      db.prepare("UPDATE users SET wallpaper_path = ? WHERE id = ?").run(finalPath, req.user.id);
      if (previous && previous !== finalPath) fs.rmSync(previous, { force: true });
      return res.status(201).json({ ok: true });
    } catch {
      fs.rmSync(incoming.path, { force: true });
      return res.status(500).json({ error: "Wallpaper could not be saved" });
    }
  });
});

wallpaperRoutes.delete("/", (req: any, res) => {
  const previous = ownedWallpaperPath(req.user.id);
  db.prepare("UPDATE users SET wallpaper_path = NULL WHERE id = ?").run(req.user.id);
  if (previous) fs.rmSync(previous, { force: true });
  res.sendStatus(204);
});
