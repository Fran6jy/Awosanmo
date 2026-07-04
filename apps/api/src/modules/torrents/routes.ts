import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { torrentService } from "./torrentService.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const addSchema = z.object({ magnetUri: z.string().startsWith("magnet:") });

export const torrentRoutes = Router();

torrentRoutes.get("/", (_req, res) => res.json(torrentService.list()));
torrentRoutes.post("/", (req, res) => {
  const body = addSchema.parse(req.body);
  res.status(202).json(torrentService.add(body.magnetUri));
});
torrentRoutes.post("/upload", upload.single("torrent"), (_req, res) => {
  res.status(501).json({ error: "Torrent file upload endpoint is wired; bencoded parsing is planned for the next release." });
});
torrentRoutes.get("/:id", (req, res) => {
  const detail = torrentService.getDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: "Torrent not found" });
  res.json(detail);
});
torrentRoutes.get("/:id/files", (req, res) => res.json(torrentService.getFiles(req.params.id)));
torrentRoutes.post("/files/:fileId/probe", (req, res) => {
  if (!torrentService.markFileForProbe(req.params.fileId)) return res.status(404).json({ error: "Streamable file not found" });
  res.sendStatus(204);
});
torrentRoutes.post("/:id/pause", (req, res) => {
  if (!torrentService.pause(req.params.id)) return res.status(404).json({ error: "Active torrent not found" });
  res.sendStatus(204);
});
torrentRoutes.post("/:id/resume", (req, res) => {
  if (!torrentService.resume(req.params.id)) return res.status(404).json({ error: "Torrent not found" });
  res.sendStatus(204);
});
torrentRoutes.post("/:id/reannounce", (req, res) => {
  if (!torrentService.reannounce(req.params.id)) return res.status(404).json({ error: "Active torrent not found" });
  res.sendStatus(204);
});
torrentRoutes.post("/:id/recheck", (req, res) => {
  if (!torrentService.forceRecheck(req.params.id)) return res.status(404).json({ error: "Active torrent not found" });
  res.sendStatus(204);
});
torrentRoutes.delete("/:id", (req, res) => {
  torrentService.remove(req.params.id, req.query.destroy === "true");
  res.sendStatus(204);
});
