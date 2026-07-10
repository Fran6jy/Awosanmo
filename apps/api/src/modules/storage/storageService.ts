import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";

export function getStorageStats() {
  const root = config.dataDir;
  let used = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      if (entry.isFile()) used += fs.statSync(fullPath).size;
    }
  }

  const disk = fs.statfsSync(root);
  return {
    used,
    available: disk.bavail * disk.bsize,
    total: disk.blocks * disk.bsize,
    dataDir: root
  };
}

export function getUserStorageStats(userId: string) {
  const usage = db.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE user_id = ?").get(userId) as any;
  const reservations = db.prepare("SELECT COALESCE(SUM(bytes), 0) AS reserved FROM quota_reservations WHERE user_id = ? AND expires_at >= ?").get(userId, Date.now()) as any;
  const quota = db.prepare("SELECT quota_bytes FROM users WHERE id = ?").get(userId) as any;
  const used = Number(usage?.used ?? 0);
  const reserved = Number(reservations?.reserved ?? 0);
  const quotaBytes = Number(quota?.quota_bytes ?? config.defaultQuotaBytes);
  return {
    used,
    quota: quotaBytes,
    reserved,
    available: quotaBytes === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, quotaBytes - used - reserved),
    unlimited: quotaBytes === 0
  };
}

export function assertQuota(userId: string, incomingBytes: number) {
  const stats = getUserStorageStats(userId);
  if (!stats.unlimited && stats.used + stats.reserved + incomingBytes > stats.quota) {
    const remaining = Math.max(0, stats.quota - stats.used - stats.reserved);
    const error = new Error(`Storage quota exceeded. ${remaining} bytes remaining.`);
    (error as any).status = 413;
    throw error;
  }
}

const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Atomically reserve quota before bytes are committed to the files table. */
export const reserveQuota = db.transaction((userId: string, reservationId: string, bytes: number) => {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid quota reservation");
  const now = Date.now();
  db.prepare("DELETE FROM quota_reservations WHERE expires_at < ?").run(now);
  const usage = db.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE user_id = ?").get(userId) as any;
  const reserved = db.prepare("SELECT COALESCE(SUM(bytes), 0) AS reserved FROM quota_reservations WHERE user_id = ? AND id != ?").get(userId, reservationId) as any;
  const quota = db.prepare("SELECT quota_bytes FROM users WHERE id = ?").get(userId) as any;
  const quotaBytes = Number(quota?.quota_bytes ?? config.defaultQuotaBytes);
  const committed = Number(usage?.used ?? 0);
  const held = Number(reserved?.reserved ?? 0);
  if (quotaBytes !== 0 && committed + held + bytes > quotaBytes) {
    const remaining = Math.max(0, quotaBytes - committed - held);
    throw quotaError(remaining);
  }
  db.prepare(`INSERT INTO quota_reservations (id, user_id, bytes, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET bytes = excluded.bytes, expires_at = excluded.expires_at
    WHERE quota_reservations.user_id = excluded.user_id`).run(reservationId, userId, bytes, now + RESERVATION_TTL_MS);
});

export function releaseQuota(reservationId: string, userId: string) {
  db.prepare("DELETE FROM quota_reservations WHERE id = ? AND user_id = ?").run(reservationId, userId);
}

/** Commit the database record and consume its reservation in one transaction. */
export function commitQuotaReservation<T>(reservationId: string, userId: string, commit: () => T): T {
  return db.transaction(() => {
    const reservation = db.prepare("SELECT id FROM quota_reservations WHERE id = ? AND user_id = ?").get(reservationId, userId);
    if (!reservation) throw new Error("Quota reservation expired");
    const result = commit();
    releaseQuota(reservationId, userId);
    return result;
  })();
}

/** Check quota and register known-size content atomically. */
export function withQuotaAllocation<T>(userId: string, incomingBytes: number, commit: () => T): T {
  return db.transaction(() => {
    assertQuota(userId, incomingBytes);
    return commit();
  })();
}

function quotaError(remaining: number) {
  const error = new Error(`Storage quota exceeded. ${remaining} bytes remaining.`);
  (error as any).status = 413;
  return error;
}
