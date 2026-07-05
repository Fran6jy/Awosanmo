import fs from "node:fs";
import path from "node:path";
import { getDiskPath, getFile } from "./fileService.js";

const subtitleExt = new Set([".srt", ".vtt"]);

export function subtitleFile(req: any, res: any) {
  const file = getFile(req.params.id);
  if (!file) return res.status(404).json({ error: "Subtitle not found" });
  if (req.user?.sub && file.user_id && file.user_id !== req.user.sub) return res.status(404).json({ error: "Subtitle not found" });
  const ext = path.extname(file.name).toLowerCase();
  if (!subtitleExt.has(ext)) return res.status(415).json({ error: "Unsupported subtitle format" });
  const diskPath = getDiskPath(file);
  if (!fs.existsSync(diskPath)) return res.status(404).json({ error: "Subtitle is not available" });
  res.setHeader("Content-Type", ext === ".vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=300");
  fs.createReadStream(diskPath, { highWaterMark: 32 * 1024 }).pipe(res);
}
