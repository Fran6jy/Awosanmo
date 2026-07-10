import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../../config.js";
import { torrentService, uploadsDirFor } from "../torrents/torrentService.js";
import { commitQuotaReservation, releaseQuota, reserveQuota } from "../storage/storageService.js";

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
  const reservationId = crypto.randomUUID();
  try {
    reserveQuota(req.user.id, reservationId, file.size);
    const record = commitQuotaReservation(reservationId, req.user.id, () => torrentService.registerUpload({
      relativeName: file.filename,
      displayName: file.filename,
      size: file.size,
    }, req.user.id));
    return res.status(201).json(record);
  } catch (error: any) {
    releaseQuota(reservationId, req.user.id);
    fs.rmSync(file.path, { force: true });
    return res.status(error.status ?? 413).json({ error: error.message ?? "Storage quota exceeded" });
  }
});

uploadRoutes.post("/url", async (req: any, res) => {
  const { url } = urlSchema.parse(req.body);
  let diskPath: string | null = null;
  let dispatcher: Agent | null = null;
  const reservationId = crypto.randomUUID();
  try {
    const fetched = await fetchPublicUrl(url);
    const response = fetched.response;
    dispatcher = fetched.dispatcher;
    if (!response.ok || !response.body) return res.status(400).json({ error: `URL fetch failed (${response.status})` });
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > config.maxRemoteBytes) return res.status(413).json({ error: "Remote file is too large" });
    if (length > 0) reserveQuota(req.user.id, reservationId, length);

    const dir = uploadsDirFor(req.user.id);
    fs.mkdirSync(dir, { recursive: true });
    const name = dedupe(dir, sanitizeName(filenameFromResponse(response, url)));
    diskPath = path.join(dir, name);
    let written = 0;
    const limiter = new TransformByteLimit(config.maxRemoteBytes, (chunkBytes) => {
      written += chunkBytes;
      if (length === 0) reserveQuota(req.user.id, reservationId, written);
    });
    await pipeline(Readable.fromWeb(response.body as any), limiter, fs.createWriteStream(diskPath));
    reserveQuota(req.user.id, reservationId, written);
    const record = commitQuotaReservation(reservationId, req.user.id, () =>
      torrentService.registerUpload({ relativeName: name, displayName: name, size: written }, req.user.id));
    res.status(201).json(record);
  } catch (error: any) {
    releaseQuota(reservationId, req.user.id);
    if (diskPath) fs.rmSync(diskPath, { force: true });
    res.status(error.status ?? 400).json({ error: error.message ?? "Could not add URL" });
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => undefined);
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

const MAX_REDIRECTS = 5;

async function fetchPublicUrl(value: string): Promise<{ response: Response; dispatcher: Agent }> {
  let current = new URL(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const target = await resolvePublicTarget(current);
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      },
    });
    try {
      const response = await fetch(current, { redirect: "manual", dispatcher } as RequestInit & { dispatcher: Agent });
      if (![301, 302, 303, 307, 308].includes(response.status)) return { response, dispatcher };
      const location = response.headers.get("location");
      await response.body?.cancel();
      await dispatcher.close();
      if (!location) throw Object.assign(new Error("Redirect is missing a location"), { status: 400 });
      if (redirects === MAX_REDIRECTS) throw Object.assign(new Error("Too many redirects"), { status: 400 });
      current = new URL(location, current);
    } catch (error) {
      await dispatcher.close().catch(() => undefined);
      throw error;
    }
  }
  throw Object.assign(new Error("Too many redirects"), { status: 400 });
}

async function resolvePublicTarget(parsed: URL) {
  if (!["http:", "https:"].includes(parsed.protocol)) throw Object.assign(new Error("Only HTTP/HTTPS URLs are allowed"), { status: 400 });
  const records = await dns.lookup(parsed.hostname, { all: true });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw Object.assign(new Error("Private or local URLs are not allowed"), { status: 400 });
  }
  return records[0];
}

export function isPublicAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
