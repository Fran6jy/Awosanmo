import fs from "node:fs";
import path from "node:path";
import mime from "mime-types";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";

export function listFiles(query?: string, folderId?: string | null) {
  // Search is global across every folder.
  if (query?.trim()) {
    const like = `%${query}%`;
    return db.prepare(`
      SELECT * FROM files
      WHERE name LIKE ? OR path LIKE ? OR media_kind LIKE ?
      ORDER BY created_at DESC
      LIMIT 200
    `).all(like, like, like);
  }
  // When a folder is specified, scope to it (null = library root).
  if (folderId !== undefined) {
    if (folderId === null) {
      return db.prepare("SELECT * FROM files WHERE folder_id IS NULL ORDER BY created_at DESC LIMIT 200").all();
    }
    return db.prepare("SELECT * FROM files WHERE folder_id = ? ORDER BY created_at DESC LIMIT 200").all(folderId);
  }
  return db.prepare("SELECT * FROM files ORDER BY created_at DESC LIMIT 200").all();
}

export function getFile(id: string) {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) as any;
}

export function getDiskPath(file: any) {
  const safeRelative = path.normalize(file.path).replace(/^(\.\.[/\\])+/, "");
  return path.join(config.dataDir, "downloads", file.torrent_id, safeRelative);
}

export function renameFile(id: string, name: string) {
  const clean = sanitizeName(name);
  const file = getFile(id);
  if (!file) return null;
  const oldDiskPath = getDiskPath(file);
  const nextRelative = path.join(path.dirname(file.path), clean);
  const nextDiskPath = path.join(config.dataDir, "downloads", file.torrent_id, nextRelative);
  if (fs.existsSync(oldDiskPath)) fs.renameSync(oldDiskPath, nextDiskPath);
  db.prepare("UPDATE files SET name = ?, path = ?, mime = ? WHERE id = ?").run(clean, nextRelative, mime.lookup(clean) || file.mime, id);
  return getFile(id);
}

export function deleteFile(id: string) {
  const file = getFile(id);
  if (!file) return false;
  const diskPath = getDiskPath(file);
  if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  db.prepare("DELETE FROM files WHERE id = ?").run(id);
  return true;
}

function sanitizeName(value: string) {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim();
  if (!clean || clean === "." || clean === "..") throw new Error("Invalid filename");
  return clean.slice(0, 180);
}
