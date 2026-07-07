import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import dns from "node:dns/promises";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../../config.js";
import { torrentService, uploadsDirFor } from "../torrents/torrentService.js";
import { assertQuota } from "../storage/storageService.js";

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
const urlSchema = z.object({ url: z.string().url() });

uploadRoutes.post("/", upload.single("file"), (req: any, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file provided" });
  try {
    assertQuota(req.user.id, file.size);
  } catch (error: any) {
    fs.rmSync(file.path, { force: true });
    return res.status(error.status ?? 413).json({ error: error.message ?? "Storage quota exceeded" });
  }
  const record = torrentService.registerUpload({
    relativeName: file.filename,
    displayName: file.filename,
    size: file.size,
  }, req.user.id);
  res.status(201).json(record);
});

uploadRoutes.post("/url", async (req: any, res) => {
  const { url } = urlSchema.parse(req.body);
  let diskPath: string | null = null;
  try {
    await assertPublicUrl(url);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) return res.status(400).json({ error: `URL fetch failed (${response.status})` });
    await assertPublicUrl(response.url);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > config.maxRemoteBytes) return res.status(413).json({ error: "Remote file is too large" });
    if (length > 0) assertQuota(req.user.id, length);

    const dir = uploadsDirFor(req.user.id);
    fs.mkdirSync(dir, { recursive: true });
    const name = dedupe(dir, sanitizeName(filenameFromResponse(response, url)));
    diskPath = path.join(dir, name);
    let written = 0;
    const limiter = new TransformByteLimit(config.maxRemoteBytes, (chunkBytes) => {
      written += chunkBytes;
      if (length === 0) assertQuota(req.user.id, written);
    });
    await pipeline(Readable.fromWeb(response.body as any), limiter, fs.createWriteStream(diskPath));
    assertQuota(req.user.id, written);
    const record = torrentService.registerUpload({ relativeName: name, displayName: name, size: written }, req.user.id);
    res.status(201).json(record);
  } catch (error: any) {
    if (diskPath) fs.rmSync(diskPath, { force: true });
    res.status(error.status ?? 400).json({ error: error.message ?? "Could not add URL" });
  }
});

class TransformByteLimit extends Transform {
  private total = 0;
  constructor(private readonly limit: number, private readonly onChunk: (bytes: number) => void) { super(); }
  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    this.total += chunk.length;
    if (this.total > this.limit) return callback(Object.assign(new Error("Remote file is too large"), { status: 413 }));
    try {
      this.onChunk(chunk.length);
    } catch (error: any) {
      return callback(error);
    }
    callback(null, chunk);
  }
}

function filenameFromResponse(response: Response, url: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (match) return decodeURIComponent(match[1].replace(/"$/, ""));
  return path.basename(new URL(url).pathname) || "download";
}

async function assertPublicUrl(value: string) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) throw Object.assign(new Error("Only HTTP/HTTPS URLs are allowed"), { status: 400 });
  const records = await dns.lookup(parsed.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw Object.assign(new Error("Private or local URLs are not allowed"), { status: 400 });
  }
}

function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}
