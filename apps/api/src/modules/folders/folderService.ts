import crypto from "node:crypto";
import { db } from "../../db/schema.js";
import { copyFiles } from "../files/fileService.js";

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

/** Reuse or create each folder in a relative upload path. */
export function ensureFolderPath(names: string[], parentId: string | null, userId: string): Folder | null {
  if (parentId && !getFolder(parentId, userId)) throw new Error("Parent folder not found");
  let parent = parentId;
  let current: Folder | null = parent ? getFolder(parent, userId)! : null;
  for (const rawName of names) {
    const name = sanitize(rawName);
    const existing = parent === null
      ? db.prepare("SELECT * FROM folders WHERE user_id = ? AND parent_id IS NULL AND name = ? ORDER BY created_at LIMIT 1").get(userId, name) as Folder | undefined
      : db.prepare("SELECT * FROM folders WHERE user_id = ? AND parent_id = ? AND name = ? ORDER BY created_at LIMIT 1").get(userId, parent, name) as Folder | undefined;
    current = existing ?? createFolder(name, parent, userId);
    parent = current.id;
  }
  return current;
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

export function moveFolder(id: string, parentId: string | null, userId: string): Folder | null {
  const folder = getFolder(id, userId);
  if (!folder) return null;
  if (parentId === id) throw new Error("A folder cannot contain itself");
  if (parentId) {
    if (!getFolder(parentId, userId)) throw new Error("Target folder not found");
    let cursor: string | null = parentId;
    while (cursor) {
      if (cursor === id) throw new Error("A folder cannot be moved into its own subfolder");
      cursor = getFolder(cursor, userId)?.parent_id ?? null;
    }
  }
  db.prepare("UPDATE folders SET parent_id = ? WHERE id = ? AND user_id = ?").run(parentId, id, userId);
  return getFolder(id, userId)!;
}

/** Duplicate a complete folder tree, including its files, into another folder. */
export function copyFolder(id: string, parentId: string | null, userId: string): Folder | null {
  const source = getFolder(id, userId);
  if (!source) return null;
  if (parentId && !getFolder(parentId, userId)) throw new Error("Target folder not found");

  // Do not let a copy grow recursively inside the tree being copied.
  let cursor = parentId;
  while (cursor) {
    if (cursor === id) throw new Error("A folder cannot be copied into itself or its subfolder");
    cursor = getFolder(cursor, userId)?.parent_id ?? null;
  }

  const siblingNames = new Set(listFolders(parentId, userId).map((folder) => folder.name.toLowerCase()));
  let name = `${source.name} copy`;
  let suffix = 2;
  while (siblingNames.has(name.toLowerCase())) name = `${source.name} copy ${suffix++}`;

  const duplicate = (folder: Folder, targetParent: string | null, rootName?: string): Folder => {
    const next = createFolder(rootName ?? folder.name, targetParent, userId);
    const fileIds = (db.prepare("SELECT id FROM files WHERE folder_id = ? AND user_id = ? AND selected = 1").all(folder.id, userId) as { id: string }[]).map((file) => file.id);
    if (fileIds.length) copyFiles(fileIds, next.id, userId, { preserveName: true });
    for (const child of listFolders(folder.id, userId)) duplicate(child, next.id);
    return next;
  };

  return duplicate(source, parentId, name);
}
