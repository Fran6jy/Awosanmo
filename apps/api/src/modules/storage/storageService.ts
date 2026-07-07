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
  const quota = db.prepare("SELECT quota_bytes FROM users WHERE id = ?").get(userId) as any;
  const used = Number(usage?.used ?? 0);
  const quotaBytes = Number(quota?.quota_bytes ?? config.defaultQuotaBytes);
  return {
    used,
    quota: quotaBytes,
    available: quotaBytes === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, quotaBytes - used),
    unlimited: quotaBytes === 0
  };
}

export function assertQuota(userId: string, incomingBytes: number) {
  const stats = getUserStorageStats(userId);
  if (!stats.unlimited && stats.used + incomingBytes > stats.quota) {
    const remaining = Math.max(0, stats.quota - stats.used);
    const error = new Error(`Storage quota exceeded. ${remaining} bytes remaining.`);
    (error as any).status = 413;
    throw error;
  }
}
