import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import { z } from "zod";
import { createRequire } from "node:module";
import type { Server } from "socket.io";
import { config } from "../../config.js";
import { parseByteRange, STREAM_CHUNK_BYTES } from "../streaming/byteRange.js";
import { lastScan, musicEnabled, scanInProgress, scanLibrary } from "./scanner.js";
import * as music from "./service.js";
import * as shares from "./shares.js";
import { enrichInProgress, enrichLibrary, enrichProgress, enrichStats, lastEnrich, resetEnrichment } from "./enrich.js";
import { analyseLibrary, analysisInProgress, analysisProgress, analysisStats } from "./analysis.js";
import * as mixes from "./mixes.js";
import { lyricsFor } from "./lyrics.js";
import * as stats from "./stats.js";

export const musicRoutes = Router();

const page = (req: any, max = 200) => ({
  limit: Math.min(max, Math.max(1, Number(req.query.limit ?? 60))),
  offset: Math.max(0, Number(req.query.offset ?? 0)),
});

// ---------- status / scanning ----------

musicRoutes.get("/status", (_req, res) => {
  res.json({
    enabled: musicEnabled(), scanning: scanInProgress(), lastScan: lastScan(), ...music.libraryStats(),
    repair: { running: enrichInProgress(), progress: enrichProgress(), last: lastEnrich(), ...enrichStats() },
    analysis: { running: analysisInProgress(), progress: analysisProgress(), ...analysisStats() },
  });
});

/** Audio analysis on demand (admin); normally it follows a scan by itself. */
musicRoutes.post("/analyse", (req: any, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  if (analysisInProgress()) return res.status(409).json({ error: "Analysis is already running" });
  analyseLibrary().catch(() => undefined);
  res.status(202).json({ started: true });
});

/** Metadata repair on demand (admin). `?all=1` forgets earlier decisions and redoes the whole library. */
musicRoutes.post("/repair", (req: any, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  if (enrichInProgress()) return res.status(409).json({ error: "Repair is already running" });
  if (req.query.all === "1") resetEnrichment();
  enrichLibrary().catch(() => undefined);
  res.status(202).json({ started: true });
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

musicRoutes.get("/home", (req: any, res) => res.json({
  ...music.home(req.user.id), mixes: mixes.listMixes(req.user.id), moods: mixes.listMoods(),
  forgotten: stats.forgottenFavourites(req.user.id, 12), onThisDay: stats.onThisDay(req.user.id, 12),
}));

// ---------- moods & mixes ----------

musicRoutes.get("/moods", (_req, res) => res.json(mixes.listMoods()));
musicRoutes.get("/moods/:id", (req: any, res) => {
  const r = mixes.moodTracks(req.user.id, req.params.id);
  if (!r) return res.status(404).json({ error: "Mood not found" });
  res.json(r);
});
musicRoutes.get("/mixes", (req: any, res) => res.json(mixes.listMixes(req.user.id)));
// Deal a fresh hand now, or take a skipped song out of a mix or mood for a fortnight.
musicRoutes.post("/mixes/:id/refresh", (req: any, res) => { mixes.refreshMix(req.user.id, req.params.id); res.sendStatus(204); });
musicRoutes.post("/mixes/:id/skip", (req: any, res) => {
  const body = z.object({ trackId: z.string().uuid() }).parse(req.body);
  mixes.skipInMix(req.user.id, req.params.id, body.trackId);
  res.sendStatus(204);
});
musicRoutes.get("/mixes/:id", (req: any, res) => {
  const r = mixes.mixTracks(req.user.id, req.params.id);
  if (!r) return res.status(404).json({ error: "Mix not found" });
  res.json(r);
});

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

// ---------- settings, wrapped, radio ----------

musicRoutes.get("/settings", (req: any, res) => res.json(stats.getSettings(req.user.id)));
musicRoutes.put("/settings", (req: any, res) => {
  const body = z.record(z.string().max(40), z.any()).parse(req.body ?? {});
  if (JSON.stringify(body).length > 8_000) return res.status(413).json({ error: "Settings too large" });
  res.json(stats.updateSettings(req.user.id, body));
});

musicRoutes.get("/wrapped", (req: any, res) => {
  const offset = Math.max(0, Math.min(520, Number(req.query.week ?? 0) || 0));
  res.json(stats.wrapped(req.user.id, offset));
});
musicRoutes.get("/forgotten", (req: any, res) => res.json(stats.forgottenFavourites(req.user.id)));
musicRoutes.get("/on-this-day", (req: any, res) => res.json(stats.onThisDay(req.user.id)));

musicRoutes.get("/tracks/:id/similar", (req: any, res) => {
  const tracks = stats.similarTracks(req.user.id, req.params.id);
  if (!tracks.length && !music.getTrack(req.user.id, req.params.id)) return res.status(404).json({ error: "Track not found" });
  res.json(tracks);
});

musicRoutes.get("/tracks/:id/lyrics", async (req: any, res) => {
  const r = await lyricsFor(req.params.id);
  if (!r) return res.status(404).json({ error: "Track not found" });
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.json(r);
});

/** Delete a song for good: index row and the file on disk. Admin only — it is the library owner's data. */
musicRoutes.delete("/tracks/:id", (req: any, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  const gone = music.deleteTrack(req.params.id);
  if (!gone) return res.status(404).json({ error: "Track not found" });
  try {
    fs.rmSync(gone.path, { force: true });
    // Remember what was deleted on purpose, so a later library sync from the
    // owner's computer knows not to put it straight back.
    const rel = path.relative(path.resolve(config.musicDir), gone.path).split(path.sep).join("/");
    if (!rel.startsWith("..")) fs.appendFileSync(path.join(config.dataDir, "deleted-songs.txt"), rel + "\n");
    // Leave no empty folders behind, but never climb out of the library.
    const root = path.resolve(config.musicDir);
    for (let dir = path.dirname(gone.path); dir.startsWith(root) && dir !== root; dir = path.dirname(dir)) {
      if (fs.readdirSync(dir).length) break;
      fs.rmdirSync(dir);
    }
  } catch (err) {
    req.log?.warn({ err, path: gone.path }, "Track row removed but the file could not be deleted");
  }
  res.sendStatus(204);
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

// ---------- playback session: one active device, mirrored to every other ----------

let io: Server | null = null;
/** Called once at boot so playback changes can be pushed to the user's other devices. */
export function attachMusicRealtime(server: Server) { io = server; }
function broadcastPlayback(userId: string) {
  io?.to(`u:${userId}`).emit("music:playback", music.getPlayback(userId));
}

const playbackSchema = z.object({
  deviceId: z.string().min(1).max(64),
  deviceName: z.string().min(1).max(80),
  trackId: z.string().uuid().nullable(),
  queueIds: z.array(z.string().uuid()).max(2000),
  cursor: z.number().int().min(-1),
  shuffle: z.boolean(),
  repeat: z.enum(["off", "all", "one"]),
  position: z.number().min(0),
  playing: z.boolean(),
  context: z.object({ kind: z.string().max(20), name: z.string().max(200), id: z.string().max(120).optional() }).nullable(),
});

musicRoutes.get("/playback", (req: any, res) => res.json(music.getPlayback(req.user.id)));
musicRoutes.put("/playback", (req: any, res) => {
  const body = playbackSchema.parse(req.body);
  const view = music.setPlayback(req.user.id, body);
  broadcastPlayback(req.user.id);
  res.json(view);
});
musicRoutes.delete("/playback", (req: any, res) => {
  const deviceId = String(req.query.deviceId ?? "");
  if (music.clearPlayback(req.user.id, deviceId)) broadcastPlayback(req.user.id);
  res.sendStatus(204);
});
musicRoutes.post("/tracks/batch", (req: any, res) => {
  const body = z.object({ ids: z.array(z.string().uuid()).max(2000) }).parse(req.body);
  res.json(music.tracksByIds(req.user.id, body.ids));
});

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

// ---------- share links (owner side) ----------

const shareSchema = z.object({
  kind: z.enum(["track", "album", "playlist"]),
  id: z.string().min(1).max(64),
  expiresInDays: z.number().int().positive().max(3650).nullable().optional(),
  allowDownload: z.boolean().optional(),
});

musicRoutes.get("/shares", (req: any, res) => res.json(shares.listShares(req.user.id)));
musicRoutes.post("/shares", (req: any, res) => {
  const body = shareSchema.parse(req.body);
  const share = shares.createShare(req.user.id, body.kind, body.id, { expiresInDays: body.expiresInDays ?? null, allowDownload: body.allowDownload });
  if (!share) return res.status(404).json({ error: "Nothing to share" });
  res.status(201).json(share);
});
musicRoutes.delete("/shares/:id", (req: any, res) => {
  if (!shares.revokeShare(req.user.id, req.params.id)) return res.status(404).json({ error: "Share not found" });
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

/** Stream one file with byte-range support; shared by the private and the public (share link) routes. */
function sendAudio(req: any, res: any, trackId: string, opts: { download?: string } = {}) {
  const track = music.getTrackFile(trackId);
  if (!track) return res.status(404).json({ error: "Track not found" });
  if (!track.playable) return res.status(415).json({ error: "This format cannot be played in a browser" });
  if (!fs.existsSync(track.path)) return res.status(404).json({ error: "Audio file is missing from disk" });
  const stat = fs.statSync(track.path);
  const mime = track.mime && track.mime !== "audio/mpeg" ? track.mime : path.extname(track.path).toLowerCase() === ".mp3" ? "audio/mpeg" : (track.mime ?? "application/octet-stream");
  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (opts.download) res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(opts.download + path.extname(track.path))}`);
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
}

musicMediaRoutes.get("/stream/:id", requireMusicToken, (req: any, res) => sendAudio(req, res, req.params.id));

// ---------- share links (public side): no login, the slug is the credential ----------

const SLUG = /^[A-Za-z0-9]{6,16}$/;
const fileNameFor = (t: { artist: string; title: string }) => `${t.artist} - ${t.title}`.replace(/[\/:*?"<>|]+/g, "_").slice(0, 150);

musicMediaRoutes.get("/s/:slug", (req: any, res) => {
  if (!SLUG.test(req.params.slug)) return res.status(404).json({ error: "Not found" });
  const content = shares.openShare(req.params.slug);
  if (!content) return res.status(404).json({ error: "This link is no longer available" });
  res.setHeader("Cache-Control", "no-store");
  res.json(content);
});

musicMediaRoutes.get("/s/:slug/stream/:id", (req: any, res) => {
  if (!SLUG.test(req.params.slug) || !shares.shareGrants(req.params.slug, req.params.id)) return res.status(404).json({ error: "Not found" });
  sendAudio(req, res, req.params.id);
});

musicMediaRoutes.get("/s/:slug/download/:id", (req: any, res) => {
  if (!SLUG.test(req.params.slug) || !shares.shareGrants(req.params.slug, req.params.id, { download: true })) return res.status(404).json({ error: "Not found" });
  const track = music.getTrack("", req.params.id);
  if (!track) return res.status(404).json({ error: "Not found" });
  sendAudio(req, res, req.params.id, { download: fileNameFor(track) });
});

// archiver is CommonJS; load it via createRequire so the ESM loader is happy.
const archiver = createRequire(import.meta.url)("archiver") as (format: string, options?: any) => any;

musicMediaRoutes.get("/s/:slug/zip", (req: any, res) => {
  if (!SLUG.test(req.params.slug)) return res.status(404).json({ error: "Not found" });
  const set = shares.shareDownloadSet(req.params.slug);
  if (!set || !set.tracks.length) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(set.title.replace(/[\/:*?"<>|]+/g, "_").slice(0, 150) + ".zip")}`);
  const zip = archiver("zip", { store: true }); // audio is already compressed; storing is fast and streams immediately
  zip.on("error", () => res.destroy());
  req.on("close", () => zip.abort());
  zip.pipe(res);
  set.tracks.forEach((t, i) => {
    const file = music.getTrackFile(t.id);
    if (file && fs.existsSync(file.path)) zip.file(file.path, { name: `${String(i + 1).padStart(2, "0")} ${fileNameFor(t)}${path.extname(file.path)}` });
  });
  void zip.finalize();
});
