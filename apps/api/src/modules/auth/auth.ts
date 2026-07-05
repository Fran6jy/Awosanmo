import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db } from "../../db/schema.js";
import { config } from "../../config.js";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL ?? "admin@awosanmo.local";
  const password = process.env.ADMIN_PASSWORD ?? "change-me-now";
  let admin = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
  if (!admin) {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(
      id,
      email,
      bcrypt.hashSync(password, 12)
    );
    admin = { id };
  }
  // Backfill pre-multi-user rows so existing content stays owned by the admin.
  for (const table of ["torrents", "files", "folders"]) {
    db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(admin.id);
  }
}

const registerSchema = loginSchema;

/** Open self sign-up. Returns a session, or null if the email is taken. */
export async function register(email: string, password: string) {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return null;
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'user')").run(
    id,
    email,
    bcrypt.hashSync(password, 12),
  );
  return { token: signToken({ id, email, role: "user" }), refreshToken: issueRefreshToken(id) };
}

export { registerSchema };

type SessionUser = { id: string; email: string; role: string };

/** Short-lived access token. `typ: access` lets us reject refresh tokens here. */
export function signToken(user: SessionUser) {
  return jwt.sign({ ...user, typ: "access" }, config.jwtSecret, { expiresIn: config.accessTokenTtl } as jwt.SignOptions);
}

/** Long-lived refresh token, whitelisted in the DB so it can be revoked. */
export function issueRefreshToken(userId: string): string {
  const jti = crypto.randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO refresh_tokens (jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    jti,
    userId,
    now + config.refreshTokenTtlMs,
    now,
  );
  return jwt.sign({ sub: userId, jti, typ: "refresh" }, config.jwtSecret, { expiresIn: config.refreshTokenTtl } as jwt.SignOptions);
}

/** Verify a refresh token against the whitelist; returns the user or null. */
export function rotateRefresh(refreshToken: string): { token: string; refreshToken: string } | null {
  let payload: any;
  try {
    payload = jwt.verify(refreshToken, config.jwtSecret);
  } catch {
    return null;
  }
  if (payload.typ !== "refresh" || !payload.jti) return null;
  const row = db.prepare("SELECT * FROM refresh_tokens WHERE jti = ?").get(payload.jti) as any;
  if (!row || row.expires_at < Date.now()) return null;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id) as any;
  if (!user) return null;
  // Rotate: invalidate the used token, mint a fresh pair.
  db.prepare("DELETE FROM refresh_tokens WHERE jti = ?").run(payload.jti);
  return {
    token: signToken({ id: user.id, email: user.email, role: user.role }),
    refreshToken: issueRefreshToken(user.id),
  };
}

export function revokeRefresh(refreshToken: string): void {
  try {
    const payload = jwt.verify(refreshToken, config.jwtSecret) as any;
    if (payload.jti) db.prepare("DELETE FROM refresh_tokens WHERE jti = ?").run(payload.jti);
  } catch {
    /* already invalid — nothing to revoke */
  }
}

export function signStreamToken(userId: string, fileId: string) {
  return jwt.sign({ sub: userId, fileId, scope: "stream" }, config.jwtSecret, {
    expiresIn: config.streamTokenTtlSeconds
  });
}

export function signDownloadToken(userId: string, fileId: string) {
  return jwt.sign({ sub: userId, fileId, scope: "download" }, config.jwtSecret, {
    expiresIn: config.streamTokenTtlSeconds
  });
}

export function signSubtitleToken(userId: string, fileId: string) {
  return jwt.sign({ sub: userId, fileId, scope: "subtitle" }, config.jwtSecret, {
    expiresIn: config.streamTokenTtlSeconds
  });
}

export function requireAuth(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    // A refresh token must never be accepted as an access token.
    if (payload.typ === "refresh") return res.status(401).json({ error: "Invalid token" });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireStreamAuth(req: any, res: any, next: any) {
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  const token = bearer ?? req.query.st;
  if (!token) return res.status(401).json({ error: "Missing stream token" });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    if (payload.scope === "stream" && payload.fileId !== req.params.id) {
      return res.status(403).json({ error: "Stream token does not match this file" });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid stream token" });
  }
}

export function requireDownloadAuth(req: any, res: any, next: any) {
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  const token = bearer ?? req.query.dt;
  if (!token) return res.status(401).json({ error: "Missing download token" });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    if (payload.scope === "download" && payload.fileId !== req.params.id) {
      return res.status(403).json({ error: "Download token does not match this file" });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid download token" });
  }
}

export function requireSubtitleAuth(req: any, res: any, next: any) {
  const token = req.query.tt;
  if (!token) return res.status(401).json({ error: "Missing subtitle token" });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    if (payload.scope !== "subtitle" || payload.fileId !== req.params.id) {
      return res.status(403).json({ error: "Subtitle token does not match this file" });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid subtitle token" });
  }
}

export async function login(email: string, password: string) {
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
  const session = { id: user.id, email: user.email, role: user.role };
  return { token: signToken(session), refreshToken: issueRefreshToken(user.id) };
}
