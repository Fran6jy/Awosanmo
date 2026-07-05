import crypto from "node:crypto";
import { db } from "../../db/schema.js";

export type Folder = { id: string; name: string; parent_id: string | null; created_at: string };

function sanitize(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim();
  if (!clean) throw new Error("Invalid folder name");
  return clean.slice(0, 120);
}

export function listFolders(parentId: string | null | undefined, userId: string): Folder[] {
  if (parentId === undefined) {
    return db.prepare("SELECT * FROM folders WHERE user_id = ? ORDER BY name").all(userId) as Folder[];
  }
  if (parentId === null) {
    return db.prepare("SELECT * FROM folders WHERE user_id = ? AND parent_id IS NULL ORDER BY name").all(userId) as Folder[];
  }
  return db.prepare("SELECT * FROM folders WHERE user_id = ? AND parent_id = ? ORDER BY name").all(userId, parentId) as Folder[];
}

/** Fetch a folder only if the user owns it. */
export function getFolder(id: string, userId: string): Folder | undefined {
  return db.prepare("SELECT * FROM folders WHERE id = ? AND user_id = ?").get(id, userId) as Folder | undefined;
}

/** Build the breadcrumb trail from root to the given folder. */
export function folderPath(id: string, userId: string): Folder[] {
  const trail: Folder[] = [];
  let current = getFolder(id, userId);
  while (current) {
    trail.unshift(current);
    current = current.parent_id ? getFolder(current.parent_id, userId) : undefined;
  }
  return trail;
}

export function createFolder(name: string, parentId: string | null, userId: string): Folder {
  if (parentId && !getFolder(parentId, userId)) throw new Error("Parent folder not found");
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO folders (id, user_id, name, parent_id) VALUES (?, ?, ?, ?)").run(id, userId, sanitize(name), parentId);
  return getFolder(id, userId)!;
}

export function renameFolder(id: string, name: string, userId: string): Folder | null {
  if (!getFolder(id, userId)) return null;
  db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(sanitize(name), id);
  return getFolder(id, userId)!;
}

/** Delete a folder; its files return to the library root and subfolders cascade. */
export function deleteFolder(id: string, userId: string): boolean {
  if (!getFolder(id, userId)) return false;
  // Collect the whole subtree so contained files can be detached first.
  const ids: string[] = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    ids.push(current);
    for (const child of db.prepare("SELECT id FROM folders WHERE parent_id = ?").all(current) as { id: string }[]) {
      stack.push(child.id);
    }
  }
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE files SET folder_id = NULL WHERE folder_id IN (${placeholders})`).run(...ids);
  db.prepare("DELETE FROM folders WHERE id = ?").run(id); // ON DELETE CASCADE removes subfolders
  return true;
}

/** Move a user's files into one of their folders (or to root when folderId is null). */
export function moveFiles(fileIds: string[], folderId: string | null, userId: string): number {
  if (folderId !== null && !getFolder(folderId, userId)) throw new Error("Target folder not found");
  // Only move files the user owns.
  const update = db.prepare("UPDATE files SET folder_id = ? WHERE id = ? AND user_id = ?");
  let moved = 0;
  for (const fileId of fileIds) {
    if ((update.run(folderId, fileId, userId) as { changes: number }).changes > 0) moved += 1;
  }
  return moved;
}
