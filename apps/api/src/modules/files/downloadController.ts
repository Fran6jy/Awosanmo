import fs from "node:fs";
import mime from "mime-types";
import { getFile, resolveDiskPath } from "./fileService.js";

export function downloadFile(req: any, res: any) {
  const file = getFile(req.params.id);
  if (!file) return res.status(404).json({ error: "File not found" });
  if (req.user?.sub && file.user_id && file.user_id !== req.user.sub) return res.status(404).json({ error: "File not found" });
  const diskPath = resolveDiskPath(file);
  if (!fs.existsSync(diskPath)) return res.status(425).json({ error: "File is not available yet" });
  const stat = fs.statSync(diskPath);
  res.setHeader("Content-Type", file.mime ?? mime.lookup(file.name) ?? "application/octet-stream");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
  fs.createReadStream(diskPath, { highWaterMark: 64 * 1024 }).pipe(res);
}
