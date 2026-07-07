import fs from "node:fs";
import { db } from "../../db/schema.js";
import { resolveDiskPath } from "./fileService.js";
import { thumbnailPath } from "../media/thumbnails.js";

export function thumbnailFile(req: any, res: any) {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id) as any;
  if (!file) return res.status(404).json({ error: "File not found" });
  if (req.user?.sub && file.user_id && file.user_id !== req.user.sub) return res.status(404).json({ error: "File not found" });

  const generated = thumbnailPath(file.thumbnail_path);
  if (generated && fs.existsSync(generated)) {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    return fs.createReadStream(generated).pipe(res);
  }

  if (file.media_kind === "image") {
    const diskPath = resolveDiskPath(file);
    if (fs.existsSync(diskPath)) {
      res.setHeader("Content-Type", file.mime ?? "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      return fs.createReadStream(diskPath).pipe(res);
    }
  }

  res.status(404).json({ error: "Thumbnail not available" });
}
