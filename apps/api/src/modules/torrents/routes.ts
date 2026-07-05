import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { torrentService } from "./torrentService.js";
import { db } from "../../db/schema.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const addSchema = z.object({ magnetUri: z.string().startsWith("magnet:") });

export const torrentRoutes = Router();

torrentRoutes.get("/", (req: any, res) => res.json(torrentService.list(req.user.id)));
torrentRoutes.post("/", (req: any, res) => {
  const body = addSchema.parse(req.body);
  res.status(202).json(torrentService.add(body.magnetUri, req.user.id));
});
torrentRoutes.post("/upload", upload.single("torrent"), (req: any, res) => {
  const file = req.file;
  if (!file?.buffer?.length) return res.status(400).json({ error: "No .torrent file provided" });
  res.status(202).json(torrentService.addTorrentFile(file.buffer, req.user.id));
});
torrentRoutes.get("/:id", (req: any, res) => {
  const detail = torrentService.getDetail(req.params.id, req.user.id);
  if (!detail) return res.status(404).json({ error: "Torrent not found" });
  res.json(detail);
});
torrentRoutes.get("/:id/files", (req: any, res) => {
  // Only expose a torrent's files if the caller owns it.
  const owned = db.prepare("SELECT id FROM torrents WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!owned) return res.status(404).json({ error: "Torrent not found" });
  res.json(torrentService.getFiles(req.params.id));
});
torrentRoutes.post("/files/:fileId/probe", (req: any, res) => {
  if (!torrentService.markFileForProbe(req.params.fileId, req.user.id)) return res.status(404).json({ error: "Streamable file not found" });
  res.sendStatus(204);
});
torrentRoutes.post("/:id/pause", (req: any, res) => {
  if (!torrentService.pause(req.params.id, req.user.id)) return res.status(404).json({ error: "Active torrent not found" });
  res.sendStatus(204);
});
torrentRoutes.post("/:id/resume", (req: any, res) => {
  if (!torrentService.resume(req.params.id, req.user.id)) return res.status(404).json({ error: "Torrent not found" });
  res.sendStatus(204);
});
torrentRoutes.post("/:id/reannounce", (req: any, res) => {
  if (!torrentService.reannounce(req.params.id, req.user.id)) return res.status(404).json({ error: "Active torrent not found" });
  res.sendStatus(204);
});
torrentRoutes.post("/:id/recheck", (req: any, res) => {
  if (!torrentService.forceRecheck(req.params.id, req.user.id)) return res.status(404).json({ error: "Active torrent not found" });
  res.sendStatus(204);
});
torrentRoutes.delete("/:id", (req: any, res) => {
  if (!torrentService.remove(req.params.id, req.user.id, req.query.destroy === "true")) return res.status(404).json({ error: "Torrent not found" });
  res.sendStatus(204);
});
