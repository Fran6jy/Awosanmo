import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { config } from "../../config.js";
import { torrentService, uploadsDirFor } from "../torrents/torrentService.js";

function sanitizeName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/^\.+/, "").trim();
  return (clean || "upload").slice(0, 180);
}

/** Avoid clobbering an existing file: "movie.mp4" -> "movie (1).mp4". */
function dedupe(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

// Stream uploads directly to disk; never buffer the whole file in memory.
const storage = multer.diskStorage({
  destination: (req: any, _file: unknown, cb: (e: Error | null, dir: string) => void) => {
    const dir = uploadsDirFor(req.user.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req: any, file: { originalname: string }, cb: (e: Error | null, name: string) => void) => {
    cb(null, dedupe(uploadsDirFor(req.user.id), sanitizeName(file.originalname)));
  },
});

const upload = multer({ storage, limits: { fileSize: config.maxUploadBytes } });

export const uploadRoutes = Router();

uploadRoutes.post("/", upload.single("file"), (req: any, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file provided" });
  const record = torrentService.registerUpload({
    relativeName: file.filename,
    displayName: file.filename,
    size: file.size,
  }, req.user.id);
  res.status(201).json(record);
});
