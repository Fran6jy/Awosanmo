import fs from "node:fs";
import mime from "mime-types";
import { db } from "../../db/schema.js";
import { torrentService } from "../torrents/torrentService.js";
import { resolveDiskPath } from "../files/fileService.js";
import { STREAM_CHUNK_BYTES, parseByteRange } from "./byteRange.js";

export { parseByteRange } from "./byteRange.js";

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

  // A HEAD probe must be answered from the stat alone. Express routes HEAD to this
  // GET handler, and piping the stream would read the entire file off disk while
  // Node discards every byte -- on a 50 GB file that never returns in time, so
  // download managers give up on learning the size and fall back to a single
  // connection instead of splitting the transfer across parallel ones.
  if (req.method === "HEAD") {
    res.setHeader("Content-Length", stat.size);
    return res.end();
  }

  if (!range) {
    res.setHeader("Content-Length", stat.size);
    return fs.createReadStream(diskPath).pipe(res);
  }

  // Video seeks pull a bounded window rather than the rest of the file.
  const parsed = parseByteRange(range, stat.size, STREAM_CHUNK_BYTES);
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
