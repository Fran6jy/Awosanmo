import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/schema.js";
import { torrentService } from "../torrents/torrentService.js";

const addSchema = z.object({
  magnetUri: z.string().startsWith("magnet:"),
  name: z.string().max(300).optional(),
  size: z.number().int().nonnegative().optional(),
  source: z.string().max(200).optional(),
});

/** Pull a human-readable name out of a magnet's dn= parameter. */
function nameFromMagnet(magnet: string): string {
  const match = /[?&]dn=([^&]+)/.exec(magnet);
  if (match?.[1]) {
    try { return decodeURIComponent(match[1].replace(/\+/g, " ")).slice(0, 300); } catch { /* ignore */ }
  }
  return "Saved magnet";
}

export const wishlistRoutes = Router();

wishlistRoutes.get("/", (req: any, res) => {
  res.json(db.prepare("SELECT * FROM wishlist WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id));
});

wishlistRoutes.post("/", (req: any, res) => {
  const body = addSchema.parse(req.body);
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO wishlist (id, user_id, name, magnet_uri, size, source) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    req.user.id,
    body.name?.trim() || nameFromMagnet(body.magnetUri),
    body.magnetUri,
    body.size ?? 0,
    body.source ?? null,
  );
  res.status(201).json(db.prepare("SELECT * FROM wishlist WHERE id = ?").get(id));
});

wishlistRoutes.delete("/:id", (req: any, res) => {
  const result = db.prepare("DELETE FROM wishlist WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id) as { changes: number };
  if (!result.changes) return res.status(404).json({ error: "Wishlist item not found" });
  res.sendStatus(204);
});

// Move a wishlist item into active downloads and remove it from the wishlist.
wishlistRoutes.post("/:id/download", (req: any, res) => {
  const item = db.prepare("SELECT * FROM wishlist WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id) as any;
  if (!item) return res.status(404).json({ error: "Wishlist item not found" });
  const added = torrentService.add(item.magnet_uri);
  db.prepare("DELETE FROM wishlist WHERE id = ?").run(item.id);
  res.status(202).json(added);
});
