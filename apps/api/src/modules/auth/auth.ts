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
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!existing) {
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
      crypto.randomUUID(),
      email,
      bcrypt.hashSync(password, 12)
    );
  }
}

export function signToken(user: { id: string; email: string; role: string }) {
  return jwt.sign(user, config.jwtSecret, { expiresIn: config.authTokenTtl } as jwt.SignOptions);
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
    req.user = jwt.verify(token, config.jwtSecret);
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
  return signToken({ id: user.id, email: user.email, role: user.role });
}
