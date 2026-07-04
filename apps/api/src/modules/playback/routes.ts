import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/schema.js";
import { listFiles } from "../files/fileService.js";

const positionSchema = z.object({ positionSeconds: z.number().min(0) });
const subtitleExt = new Set([".srt", ".vtt", ".ass", ".ssa"]);

export const playbackRoutes = Router();

playbackRoutes.get("/:fileId", (req: any, res) => {
  const position = db.prepare(`
    SELECT position_seconds, updated_at
    FROM playback_positions
    WHERE user_id = ? AND file_id = ?
  `).get(req.user.id, req.params.fileId) as any;
  res.json({
    positionSeconds: position?.position_seconds ?? 0,
    updatedAt: position?.updated_at ?? null,
    subtitles: findSubtitles(req.params.fileId)
  });
});

playbackRoutes.put("/:fileId", (req: any, res) => {
  const body = positionSchema.parse(req.body);
  db.prepare(`
    INSERT INTO playback_positions (user_id, file_id, position_seconds, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, file_id)
    DO UPDATE SET position_seconds = excluded.position_seconds, updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, req.params.fileId, body.positionSeconds);
  res.sendStatus(204);
});

function findSubtitles(fileId: string) {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId) as any;
  if (!file) return [];
  const baseDir = path.dirname(file.path);
  return (listFiles() as any[])
    .filter((candidate) => candidate.torrent_id === file.torrent_id)
    .filter((candidate) => path.dirname(candidate.path) === baseDir)
    .filter((candidate) => subtitleExt.has(path.extname(candidate.name).toLowerCase()))
    .map((candidate) => ({ id: candidate.id, name: candidate.name, path: candidate.path }));
}
