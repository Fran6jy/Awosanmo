import fs from "node:fs";
import mime from "mime-types";
import { getFile, resolveDiskPath } from "./fileService.js";
import { parseByteRange } from "../streaming/byteRange.js";

export function downloadFile(req: any, res: any) {
  const file = getFile(req.params.id);
  if (!file) return res.status(404).json({ error: "File not found" });
  if (req.user?.sub && file.user_id && file.user_id !== req.user.sub) return res.status(404).json({ error: "File not found" });
  const diskPath = resolveDiskPath(file);
  if (!fs.existsSync(diskPath)) return res.status(425).json({ error: "File is not available yet" });
  const stat = fs.statSync(diskPath);
  const range = req.headers.range;
  res.setHeader("Content-Type", file.mime ?? mime.lookup(file.name) ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

  if (!range) {
    res.setHeader("Content-Length", stat.size);
    return fs.createReadStream(diskPath, { highWaterMark: 64 * 1024 }).pipe(res);
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
  return fs.createReadStream(diskPath, { start, end, highWaterMark: 64 * 1024 }).pipe(res);
}
