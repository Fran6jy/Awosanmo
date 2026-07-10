import fs from "node:fs";
import path from "node:path";
import mime from "mime-types";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";
import { thumbnailPath } from "../media/thumbnails.js";

export function listFiles(userId: string, query?: string, folderId?: string | null) {
  // Search is global across every folder — but only within the user's files.
  if (query?.trim()) {
    const like = `%${query}%`;
    return db.prepare(`
      SELECT * FROM files
      WHERE user_id = ? AND (name LIKE ? OR path LIKE ? OR media_kind LIKE ?)
      ORDER BY created_at DESC
      LIMIT 200
    `).all(userId, like, like, like);
  }
  // When a folder is specified, scope to it (null = library root).
  if (folderId !== undefined) {
    if (folderId === null) {
      return db.prepare("SELECT * FROM files WHERE user_id = ? AND folder_id IS NULL ORDER BY created_at DESC LIMIT 200").all(userId);
    }
    return db.prepare("SELECT * FROM files WHERE user_id = ? AND folder_id = ? ORDER BY created_at DESC LIMIT 200").all(userId, folderId);
  }
  return db.prepare("SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").all(userId);
}

export function getFile(id: string) {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) as any;
}

/** Fetch a file only if it belongs to the given user (null otherwise). */
export function getOwnedFile(id: string, userId: string) {
  return db.prepare("SELECT * FROM files WHERE id = ? AND user_id = ?").get(id, userId) as any;
}

export function getDiskPath(file: any) {
  const safeRelative = path.normalize(file.path).replace(/^(\.\.[/\\])+/, "");
  const torrentDir = path.join(config.dataDir, "downloads", file.torrent_id);
  const diskPath = path.resolve(torrentDir, safeRelative);
  if (!isInside(torrentDir, diskPath)) return path.join(torrentDir, path.basename(file.path));
  return diskPath;
}

export function resolveDiskPath(file: any) {
  const direct = getDiskPath(file);
  if (fs.existsSync(direct)) return direct;

  const torrentDir = path.join(config.dataDir, "downloads", file.torrent_id);
  if (!fs.existsSync(torrentDir)) return direct;

  const expectedName = path.basename(file.path);
  const expectedSize = Number(file.size ?? 0);
  const matches: string[] = [];
  for (const candidate of walkFiles(torrentDir)) {
    if (path.basename(candidate) !== expectedName) continue;
    if (expectedSize > 0) {
      try {
        if (fs.statSync(candidate).size !== expectedSize) continue;
      } catch {
        continue;
      }
    }
    matches.push(candidate);
  }

  if (matches.length === 1) {
    const relative = path.relative(torrentDir, matches[0]);
    db.prepare("UPDATE files SET path = ? WHERE id = ?").run(relative, file.id);
    return matches[0];
  }

  return direct;
}

export function renameFile(id: string, name: string, userId: string) {
  const clean = sanitizeName(name);
  const file = getOwnedFile(id, userId);
  if (!file) return null;
  const oldDiskPath = getDiskPath(file);
  const nextRelative = path.join(path.dirname(file.path), clean);
  const nextDiskPath = path.join(config.dataDir, "downloads", file.torrent_id, nextRelative);
  const samePath = path.resolve(oldDiskPath) === path.resolve(nextDiskPath);
  if (!samePath && fs.existsSync(nextDiskPath)) throw new Error("A file with that name already exists");
  const moved = !samePath && fs.existsSync(oldDiskPath);
  if (moved) fs.renameSync(oldDiskPath, nextDiskPath);
  try {
    db.transaction(() => {
      db.prepare("UPDATE files SET name = ?, path = ?, mime = ? WHERE id = ? AND user_id = ?")
        .run(clean, nextRelative, mime.lookup(clean) || file.mime, id, userId);
    })();
  } catch (error) {
    if (moved && fs.existsSync(nextDiskPath) && !fs.existsSync(oldDiskPath)) fs.renameSync(nextDiskPath, oldDiskPath);
    throw error;
  }
  return getFile(id);
}

export function deleteFile(id: string, userId: string) {
  const file = getOwnedFile(id, userId);
  if (!file) return false;
  const diskPath = getDiskPath(file);
  if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  const thumb = thumbnailPath(file.thumbnail_path);
  if (thumb && fs.existsSync(thumb)) fs.unlinkSync(thumb);
  db.prepare("DELETE FROM files WHERE id = ?").run(id);
  return true;
}

function sanitizeName(value: string) {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim();
  if (!clean || clean === "." || clean === "..") throw new Error("Invalid filename");
  return clean.slice(0, 180);
}

function isInside(base: string, target: string) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function* walkFiles(root: string): Generator<string> {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) yield fullPath;
    }
  }
}
