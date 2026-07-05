import { Router } from "express";
import { db } from "../../db/schema.js";

export const searchRoutes = Router();

searchRoutes.get("/", (req: any, res) => {
  const userId = req.user.id;
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const like = `%${query}%`;
  const files = query
    ? db.prepare(`
      SELECT id, name, path, media_kind, streamable, size
      FROM files
      WHERE user_id = ? AND (name LIKE ? OR path LIKE ? OR media_kind LIKE ? OR codec_video LIKE ? OR codec_audio LIKE ?)
      ORDER BY created_at DESC
      LIMIT 20
    `).all(userId, like, like, like, like, like) as any[]
    : [];
  const torrents = query
    ? db.prepare(`
      SELECT id, name, status, progress, size
      FROM torrents
      WHERE user_id = ? AND (name LIKE ? OR status LIKE ? OR info_hash LIKE ?)
      ORDER BY updated_at DESC
      LIMIT 20
    `).all(userId, like, like, like) as any[]
    : [];

  res.json([
    ...torrents.map((torrent) => ({
      id: torrent.id,
      type: "torrent",
      title: torrent.name,
      subtitle: `${torrent.status} · ${Math.round(torrent.progress * 100)}%`,
      href: `/torrents/${torrent.id}`
    })),
    ...files.map((file) => ({
      id: file.id,
      type: file.streamable ? "video" : "file",
      title: file.name,
      subtitle: file.path,
      href: file.streamable ? `/watch/${file.id}` : `/files`
    })),
    ...staticActions(query)
  ].slice(0, 30));
});

function staticActions(query: string) {
  const actions = [
    { id: "dashboard", type: "action", title: "Open dashboard", subtitle: "Storage and torrent overview", href: "/" },
    { id: "files", type: "action", title: "Open files", subtitle: "Search, rename, download, delete", href: "/files" },
    { id: "system", type: "action", title: "Open system", subtitle: "Server status and activity", href: "/system" }
  ];
  if (!query) return actions;
  const normalized = query.toLowerCase();
  return actions.filter((action) => `${action.title} ${action.subtitle}`.toLowerCase().includes(normalized));
}
