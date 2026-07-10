import fs from "node:fs";
import mime from "mime-types";
import { db } from "../../db/schema.js";
import { torrentService } from "../torrents/torrentService.js";
import { resolveDiskPath } from "../files/fileService.js";

export function streamFile(req: any, res: any) {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id) as any;
  if (!file) return res.status(404).json({ error: "File not found" });
  if (req.user?.sub && file.user_id && file.user_id !== req.user.sub) return res.status(404).json({ error: "File not found" });

  torrentService.prioritizeFile(file.id);
  const diskPath = resolveDiskPath(file);
  if (!fs.existsSync(diskPath)) return res.status(425).json({ error: "File pieces are not available yet" });

  const stat = fs.statSync(diskPath);
  const range = req.headers.range;
  const contentType = file.mime ?? mime.lookup(file.name) ?? "application/octet-stream";
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!range) {
    res.setHeader("Content-Length", stat.size);
    return fs.createReadStream(diskPath).pipe(res);
  }

  const parsed = parseByteRange(range, stat.size);
  if (!parsed) {
    res.setHeader("Content-Range", `bytes */${stat.size}`);
    return res.sendStatus(416);
  }
  const { start, end } = parsed;
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  res.setHeader("Content-Length", end - start + 1);
  fs.createReadStream(diskPath, { start, end, highWaterMark: 64 * 1024 }).pipe(res);
}

export function parseByteRange(range: string, size: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0 || !/^bytes=\d+-\d*$/.test(range)) return null;
  const [startRaw, endRaw] = range.slice(6).split("-");
  const start = Number(startRaw);
  const requestedEnd = endRaw ? Number(endRaw) : Math.min(size - 1, start + 4 * 1024 * 1024 - 1);
  const end = Math.min(requestedEnd, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || end < start) return null;
  return { start, end };
}
