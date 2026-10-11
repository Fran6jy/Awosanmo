import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../../db/schema.js";

export function webdavStatus(userId: string) {
  const credential = db.prepare("SELECT enabled, created_at, last_used_at FROM webdav_credentials WHERE user_id = ?").get(userId) as any;
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as any;
  return {
    enabled: Boolean(credential?.enabled),
    username: user?.email ?? "",
    createdAt: credential?.created_at ?? null,
    lastUsedAt: credential?.last_used_at ?? null,
  };
}

export function issueWebdavPassword(userId: string) {
  const password = crypto.randomBytes(24).toString("base64url");
  db.prepare(`INSERT INTO webdav_credentials (user_id, password_hash, enabled, created_at, last_used_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP, NULL)
    ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, enabled = 1,
      created_at = CURRENT_TIMESTAMP, last_used_at = NULL`).run(userId, bcrypt.hashSync(password, 12));
  return { ...webdavStatus(userId), password };
}

export function revokeWebdav(userId: string) {
  db.prepare("DELETE FROM webdav_credentials WHERE user_id = ?").run(userId);
}

export async function authenticateWebdav(email: string, password: string) {
  const row = db.prepare(`SELECT users.id, users.email, webdav_credentials.password_hash
    FROM users JOIN webdav_credentials ON webdav_credentials.user_id = users.id
    WHERE lower(users.email) = lower(?) AND webdav_credentials.enabled = 1`).get(email) as any;
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return null;
  db.prepare("UPDATE webdav_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(row.id);
  return { id: row.id, email: row.email };
}
