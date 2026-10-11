import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";

const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

function removeEmptyParents(filePath: string, root: string) {
  let current = path.dirname(filePath);
  while (current.startsWith(`${root}${path.sep}`)) {
    try { fs.rmdirSync(current); } catch { break; }
    current = path.dirname(current);
  }
}

/** Remove payloads that cannot appear in the library, without touching active torrents. */
export function reconcileDownloadStorage(now = Date.now()) {
  const root = path.resolve(config.dataDir, "downloads");
  fs.mkdirSync(root, { recursive: true });
  let removedBytes = 0;
  let removedFiles = 0;
  let removedDirectories = 0;

  const completed = db.prepare(`SELECT id FROM torrents
    WHERE status = 'completed' AND magnet_uri NOT LIKE 'local://%'`).all() as { id: string }[];
  const deleteRow = db.prepare("DELETE FROM files WHERE id = ?");
  for (const { id } of completed) {
    const torrentRoot = path.join(root, id);
    const skipped = db.prepare("SELECT id, path FROM files WHERE torrent_id = ? AND selected = 0").all(id) as { id: string; path: string }[];
    for (const file of skipped) {
      const target = path.resolve(torrentRoot, file.path);
      if (target !== torrentRoot && target.startsWith(`${torrentRoot}${path.sep}`)) {
        try {
          const size = fs.statSync(target).size;
          fs.rmSync(target, { force: true });
          removedBytes += size;
          removedFiles += 1;
          removeEmptyParents(target, torrentRoot);
        } catch (error: any) {
          if (error?.code !== "ENOENT") logger.warn({ error, target }, "Could not remove unselected payload");
        }
      }
      deleteRow.run(file.id);
    }

    const selected = db.prepare("SELECT COUNT(*) AS count FROM files WHERE torrent_id = ? AND selected = 1").get(id) as { count: number };
    if (selected.count === 0) {
      try {
        if (fs.existsSync(torrentRoot)) {
          removedBytes += directorySize(torrentRoot);
          fs.rmSync(torrentRoot, { recursive: true, force: true });
          removedDirectories += 1;
        }
        db.prepare("DELETE FROM torrents WHERE id = ?").run(id);
      } catch (error) {
        logger.warn({ error, id }, "Could not remove empty completed torrent");
      }
    }
  }

  const owned = new Set((db.prepare("SELECT id FROM torrents").all() as { id: string }[]).map((row) => row.id));
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || owned.has(entry.name)) continue;
    const target = path.join(root, entry.name);
    try {
      if (now - fs.statSync(target).mtimeMs < ORPHAN_GRACE_MS) continue;
      removedBytes += directorySize(target);
      fs.rmSync(target, { recursive: true, force: true });
      removedDirectories += 1;
    } catch (error) {
      logger.warn({ error, target }, "Could not remove orphan download directory");
    }
  }

  if (removedFiles || removedDirectories) {
    logger.info({ removedBytes, removedFiles, removedDirectories }, "Reconciled stale download storage");
  }
  return { removedBytes, removedFiles, removedDirectories };
}

function directorySize(root: string) {
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) total += directorySize(target);
    else if (entry.isFile()) total += fs.statSync(target).size;
  }
  return total;
}
