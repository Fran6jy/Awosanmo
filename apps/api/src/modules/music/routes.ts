import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import { z } from "zod";
import { config } from "../../config.js";
import { parseByteRange, STREAM_CHUNK_BYTES } from "../streaming/byteRange.js";
import { lastScan, musicEnabled, scanInProgress, scanLibrary } from "./scanner.js";
import * as music from "./service.js";

export const musicRoutes = Router();

const page = (req: any, max = 200) => ({
  limit: Math.min(max, Math.max(1, Number(req.query.limit ?? 60))),
  offset: Math.max(0, Number(req.query.offset ?? 0)),
});

// ---------- status / scanning ----------

musicRoutes.get("/status", (_req, res) => {
  res.json({ enabled: musicEnabled(), scanning: scanInProgress(), lastScan: lastScan(), ...music.libraryStats() });
});

musicRoutes.post("/scan", (req: any, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  if (!musicEnabled()) return res.status(503).json({ error: "MUSIC_DIR is not configured" });
  if (scanInProgress()) return res.status(409).json({ error: "A scan is already running" });
  scanLibrary().catch(() => undefined);
  res.status(202).json({ started: true });
});

// ---------- streaming token ----------
// The <audio> element cannot send a bearer header, so the player appends a
// token to every stream URL. One token covers the whole library for the
// session rather than one per track, so queueing a hundred songs is free.

export function signMusicToken(userId: string) {
  return jwt.sign({ sub: userId, scope: "music" }, config.jwtSecret, { expiresIn: config.downloadTokenTtlSeconds });
}

export function requireMusicToken(req: any, res: any, next: any) {
  const token = req.query.mt;
  if (typeof token !== "string" || !token) return res.status(401).json({ error: "Missing music token" });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    if (payload.scope !== "music" || typeof payload.sub !== "string") return res.status(403).json({ error: "Invalid music token" });
    req.user = { id: payload.sub, sub: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: "Invalid music token" });
  }
}

musicRoutes.post("/token", (req: any, res) => {
  res.json({ musicToken: signMusicToken(req.user.id), expiresIn: config.downloadTokenTtlSeconds });
});

// ---------- browse ----------

musicRoutes.get("/home", (req: any, res) => res.json(music.home(req.user.id)));

musicRoutes.get("/search", (req: any, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 1) return res.json({ tracks: [], albums: [], artists: [] });
  res.json(music.search(req.user.id, q.slice(0, 80)));
});

musicRoutes.get("/tracks", (req: any, res) => {
  const sort = ["title", "added", "artist"].includes(req.query.sort) ? req.query.sort : "title";
  res.json(music.listTracks(req.user.id, { ...page(req), sort }));
});
musicRoutes.get("/tracks/:id", (req: any, res) => {
  const track = music.getTrack(req.user.id, req.params.id);
  if (!track) return res.status(404).json({ error: "Track not found" });
  res.json(track);
});

musicRoutes.get("/albums", (req: any, res) => {
  const sort = ["title", "added", "artist", "year"].includes(req.query.sort) ? req.query.sort : "title";
  res.json(music.listAlbums({ ...page(req), sort }));
});
musicRoutes.get("/albums/:id", (req: any, res) => {
  const album = music.getAlbum(req.user.id, req.params.id);
  if (!album) return res.status(404).json({ error: "Album not found" });
  res.json(album);
});

musicRoutes.get("/artists", (req: any, res) => res.json(music.listArtists(page(req, 500))));
musicRoutes.get("/artists/:id", (req: any, res) => {
  const artist = music.getArtist(req.user.id, req.params.id);
  if (!artist) return res.status(404).json({ error: "Artist not found" });
  res.json(artist);
});

musicRoutes.get("/genres", (_req, res) => res.json(music.listGenres()));
musicRoutes.get("/genres/:name", (req: any, res) => res.json(music.getGenre(req.user.id, req.params.name, page(req))));

// ---------- plays & likes ----------

musicRoutes.post("/plays", (req: any, res) => {
  const body = z.object({ trackId: z.string().uuid() }).parse(req.body);
  if (!music.recordPlay(req.user.id, body.trackId)) return res.status(404).json({ error: "Track not found" });
  res.sendStatus(204);
});

musicRoutes.get("/likes", (req: any, res) => res.json(music.likedTracks(req.user.id, page(req, 500))));
musicRoutes.put("/likes/:id", (req: any, res) => {
  if (!music.setLiked(req.user.id, req.params.id, true)) return res.status(404).json({ error: "Track not found" });
  res.sendStatus(204);
});
musicRoutes.delete("/likes/:id", (req: any, res) => {
  if (!music.setLiked(req.user.id, req.params.id, false)) return res.status(404).json({ error: "Track not found" });
  res.sendStatus(204);
});

// ---------- playlists ----------

const nameSchema = z.object({ name: z.string().trim().min(1).max(100) });

musicRoutes.get("/playlists", (req: any, res) => res.json(music.listPlaylists(req.user.id)));
musicRoutes.post("/playlists", (req: any, res) => {
  const { name } = nameSchema.parse(req.body);
  res.status(201).json(music.createPlaylist(req.user.id, name));
});
musicRoutes.get("/playlists/:id", (req: any, res) => {
  const playlist = music.getPlaylist(req.user.id, req.params.id);
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });
  res.json(playlist);
});
musicRoutes.put("/playlists/:id", (req: any, res) => {
  const { name } = nameSchema.parse(req.body);
  if (!music.renamePlaylist(req.user.id, req.params.id, name)) return res.status(404).json({ error: "Playlist not found" });
  res.sendStatus(204);
});
// Custom playlist covers: small images, stored content-addressed beside album
// art so the same /art/:name route serves them with long-lived caching.
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: any, file: { mimetype: string }, cb: (err: null, accept: boolean) => void) =>
    cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
musicRoutes.post("/playlists/:id/cover", coverUpload.single("cover"), (req: any, res) => {
  if (!req.file?.buffer?.length) return res.status(400).json({ error: "Upload a JPEG, PNG or WebP image under 5 MB" });
  const ext = req.file.mimetype === "image/png" ? ".png" : req.file.mimetype === "image/webp" ? ".webp" : ".jpg";
  const name = crypto.createHash("sha1").update(req.file.buffer).digest("hex") + ext;
  fs.mkdirSync(config.musicArtDir, { recursive: true });
  const target = path.join(config.musicArtDir, name);
  if (!fs.existsSync(target)) fs.writeFileSync(target, req.file.buffer);
  if (!music.setPlaylistCover(req.user.id, req.params.id, name)) return res.status(404).json({ error: "Playlist not found" });
  res.json({ art: name });
});
musicRoutes.delete("/playlists/:id/cover", (req: any, res) => {
  if (!music.setPlaylistCover(req.user.id, req.params.id, null)) return res.status(404).json({ error: "Playlist not found" });
  res.sendStatus(204);
});

musicRoutes.delete("/playlists/:id", (req: any, res) => {
  if (!music.deletePlaylist(req.user.id, req.params.id)) return res.status(404).json({ error: "Playlist not found" });
  res.sendStatus(204);
});
musicRoutes.post("/playlists/:id/tracks", (req: any, res) => {
  const body = z.object({ trackId: z.string().uuid() }).parse(req.body);
  if (!music.addToPlaylist(req.user.id, req.params.id, body.trackId)) return res.status(404).json({ error: "Playlist or track not found" });
  res.sendStatus(204);
});
musicRoutes.delete("/playlists/:id/tracks/:position", (req: any, res) => {
  const position = Number(req.params.position);
  if (!Number.isInteger(position) || position < 0) return res.status(400).json({ error: "Bad position" });
  if (!music.removeFromPlaylist(req.user.id, req.params.id, position)) return res.status(404).json({ error: "Playlist entry not found" });
  res.sendStatus(204);
});

// ---------- media: art + audio (token-authenticated, mounted without requireAuth) ----------

export const musicMediaRoutes = Router();

/** Album art is content-addressed and cacheable for a long time. */
musicMediaRoutes.get("/art/:name", (req: any, res) => {
  const name = path.basename(String(req.params.name));
  if (!/^[a-f0-9]{40}\.(jpg|png|webp)$/.test(name)) return res.status(400).end();
  const file = path.join(config.musicArtDir, name);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(file);
});

musicMediaRoutes.get("/stream/:id", requireMusicToken, (req: any, res) => {
  const track = music.getTrackFile(req.params.id);
  if (!track) return res.status(404).json({ error: "Track not found" });
  if (!track.playable) return res.status(415).json({ error: "This format cannot be played in a browser" });
  if (!fs.existsSync(track.path)) return res.status(404).json({ error: "Audio file is missing from disk" });
  const stat = fs.statSync(track.path);
  const mime = track.mime && track.mime !== "audio/mpeg" ? track.mime : path.extname(track.path).toLowerCase() === ".mp3" ? "audio/mpeg" : (track.mime ?? "application/octet-stream");
  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (req.method === "HEAD") { res.setHeader("Content-Length", stat.size); return res.end(); }

  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", stat.size);
    return fs.createReadStream(track.path).pipe(res);
  }
  // Songs are small; a generous window means one or two requests per track
  // while still letting the browser seek with a bounded read.
  const parsed = parseByteRange(range, stat.size, STREAM_CHUNK_BYTES * 4);
  if (!parsed) { res.setHeader("Content-Range", `bytes */${stat.size}`); return res.sendStatus(416); }
  res.status(206);
  res.setHeader("Content-Range", `bytes ${parsed.start}-${parsed.end}/${stat.size}`);
  res.setHeader("Content-Length", parsed.end - parsed.start + 1);
  fs.createReadStream(track.path, { start: parsed.start, end: parsed.end }).pipe(res);
});
