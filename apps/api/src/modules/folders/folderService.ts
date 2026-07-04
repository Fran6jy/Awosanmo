import crypto from "node:crypto";
import { db } from "../../db/schema.js";

export type Folder = { id: string; name: string; parent_id: string | null; created_at: string };

function sanitize(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim();
  if (!clean) throw new Error("Invalid folder name");
  return clean.slice(0, 120);
}

export function listFolders(parentId: string | null | undefined): Folder[] {
  if (parentId === undefined) {
    return db.prepare("SELECT * FROM folders ORDER BY name").all() as Folder[];
  }
  if (parentId === null) {
    return db.prepare("SELECT * FROM folders WHERE parent_id IS NULL ORDER BY name").all() as Folder[];
  }
  return db.prepare("SELECT * FROM folders WHERE parent_id = ? ORDER BY name").all(parentId) as Folder[];
}

export function getFolder(id: string): Folder | undefined {
  return db.prepare("SELECT * FROM folders WHERE id = ?").get(id) as Folder | undefined;
}

/** Build the breadcrumb trail from root to the given folder. */
export function folderPath(id: string): Folder[] {
  const trail: Folder[] = [];
  let current = getFolder(id);
  while (current) {
    trail.unshift(current);
    current = current.parent_id ? getFolder(current.parent_id) : undefined;
  }
  return trail;
}

export function createFolder(name: string, parentId: string | null): Folder {
  if (parentId && !getFolder(parentId)) throw new Error("Parent folder not found");
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)").run(id, sanitize(name), parentId);
  return getFolder(id)!;
}

export function renameFolder(id: string, name: string): Folder | null {
  if (!getFolder(id)) return null;
  db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(sanitize(name), id);
  return getFolder(id)!;
}

/** Delete a folder; its files return to the library root and subfolders cascade. */
export function deleteFolder(id: string): boolean {
  if (!getFolder(id)) return false;
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

/** Move a set of files into a folder (or to root when folderId is null). */
export function moveFiles(fileIds: string[], folderId: string | null): number {
  if (folderId !== null && !getFolder(folderId)) throw new Error("Target folder not found");
  const update = db.prepare("UPDATE files SET folder_id = ? WHERE id = ?");
  let moved = 0;
  for (const fileId of fileIds) {
    if ((update.run(folderId, fileId) as { changes: number }).changes > 0) moved += 1;
  }
  return moved;
}
