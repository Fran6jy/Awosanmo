import os from "node:os";
import { Router } from "express";
import { db } from "../../db/schema.js";
import { config } from "../../config.js";
import { getStorageStats } from "../storage/storageService.js";

export const adminRoutes = Router();

adminRoutes.get("/status", (req: any, res) => {
  const userId = req.user.id;
  const memory = process.memoryUsage();
  const storage = getStorageStats();
  // Content stats are scoped to the requesting user (siloed accounts).
  const torrents = db.prepare("SELECT status, COUNT(*) count FROM torrents WHERE user_id = ? GROUP BY status").all(userId);
  const files = db.prepare("SELECT media_kind, COUNT(*) count, COALESCE(SUM(size), 0) size FROM files WHERE user_id = ? GROUP BY media_kind").all(userId);
  const probes = db.prepare("SELECT probe_status, COUNT(*) count FROM files WHERE user_id = ? GROUP BY probe_status").all(userId);
  const recent = db.prepare(`
    SELECT * FROM (
      SELECT 'torrent' type, name title, status detail, updated_at timestamp FROM torrents WHERE user_id = ?
      UNION ALL
      SELECT 'file' type, name title, COALESCE(probe_status, media_kind) detail, created_at timestamp FROM files WHERE user_id = ?
    ) ORDER BY timestamp DESC LIMIT 20
  `).all(userId, userId);
  res.json({
    app: {
      uptime: process.uptime(),
      node: process.version,
      env: process.env.NODE_ENV ?? "development",
      dataDir: config.dataDir,
      torrentPort: config.torrentPort
    },
    host: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      loadavg: os.loadavg(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem()
    },
    process: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external
    },
    storage,
    torrents,
    files,
    probes,
    recent
  });
});
