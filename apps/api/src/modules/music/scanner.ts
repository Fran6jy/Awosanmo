import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";
import { sortKey, toTrackRecord, type CommonTags } from "./normalize.js";

const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wav", ".wma", ".weba"]);
const FOLDER_ART = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "album.jpg"];

export type ScanSummary = { scanned: number; added: number; updated: number; removed: number; unplayable: number; seconds: number };

let running = false;

/** Whether the module is configured at all. */
export function musicEnabled(): boolean {
  return Boolean(config.musicDir);
}

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

/**
 * Persist album art once per distinct image. Content-addressed so a hundred
 * tracks sharing one embedded cover write a single file, and re-scans are free.
 */
function storeArt(data: Uint8Array, mime: string | undefined): string {
  fs.mkdirSync(config.musicArtDir, { recursive: true });
  const ext = mime?.includes("png") ? ".png" : ".jpg";
  const name = crypto.createHash("sha1").update(data).digest("hex") + ext;
  const target = path.join(config.musicArtDir, name);
  if (!fs.existsSync(target)) fs.writeFileSync(target, data);
  return name;
}

/** Folder art beside the file, for tracks with nothing embedded. */
function folderArt(filePath: string): string | null {
  const dir = path.dirname(filePath);
  for (const candidate of FOLDER_ART) {
    const p = path.join(dir, candidate);
    if (fs.existsSync(p)) {
      try { return storeArt(fs.readFileSync(p), candidate.endsWith(".png") ? "image/png" : "image/jpeg"); } catch { return null; }
    }
  }
  return null;
}

const upsertArtist = db.prepare(`
  INSERT INTO music_artists (id, name, sort_name) VALUES (?, ?, ?)
  ON CONFLICT(sort_name) DO UPDATE SET name = excluded.name
  RETURNING id
`);
const upsertAlbum = db.prepare(`
  INSERT INTO music_albums (id, artist_id, title, sort_title, year, art_path) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(artist_id, sort_title) DO UPDATE SET
    year = COALESCE(music_albums.year, excluded.year),
    art_path = COALESCE(music_albums.art_path, excluded.art_path)
  RETURNING id
`);
const findTrack = db.prepare("SELECT id, size, mtime FROM music_tracks WHERE path = ?");
const insertTrack = db.prepare(`
  INSERT INTO music_tracks (id, album_id, artist_id, title, track_no, disc_no, duration, genre, year, path, size, mtime, mime, bitrate, playable, art_path)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateTrack = db.prepare(`
  UPDATE music_tracks SET album_id = ?, artist_id = ?, title = ?, track_no = ?, disc_no = ?, duration = ?, genre = ?, year = ?,
    size = ?, mtime = ?, mime = ?, bitrate = ?, playable = ?, art_path = ?
  WHERE id = ?
`);

async function indexFile(filePath: string, rootDir: string): Promise<"added" | "updated" | "unchanged"> {
  const stat = fs.statSync(filePath);
  const existing = findTrack.get(filePath) as { id: string; size: number; mtime: number } | undefined;
  const mtime = Math.floor(stat.mtimeMs);
  if (existing && existing.size === stat.size && existing.mtime === mtime) return "unchanged";

  let tags: CommonTags = {};
  let duration: number | null = null;
  let bitrate: number | null = null;
  let mime: string | null = null;
  let art: string | null = null;
  try {
    // Skip cover art decoding cost when the file has none; parseFile is streaming.
    const meta = await parseFile(filePath, { duration: true, skipCovers: false });
    tags = meta.common as CommonTags;
    duration = meta.format.duration ?? null;
    bitrate = meta.format.bitrate ? Math.round(meta.format.bitrate) : null;
    mime = meta.format.container ? `audio/${meta.format.container.toLowerCase()}` : null;
    const picture = meta.common.picture?.[0];
    if (picture?.data?.length) art = storeArt(picture.data, picture.format);
  } catch (error) {
    // A corrupt tag block is not a reason to hide the song; index it from its filename.
    logger.warn({ error, filePath }, "Could not read audio tags");
  }
  if (!art) art = folderArt(filePath);

  const rec = toTrackRecord(tags, filePath, rootDir);
  const albumArtistRow = upsertArtist.get(crypto.randomUUID(), rec.albumArtist, sortKey(rec.albumArtist)) as { id: string };
  const trackArtistRow = rec.artist === rec.albumArtist
    ? albumArtistRow
    : (upsertArtist.get(crypto.randomUUID(), rec.artist, sortKey(rec.artist)) as { id: string });
  const albumRow = upsertAlbum.get(crypto.randomUUID(), albumArtistRow.id, rec.album, sortKey(rec.album), rec.year, art) as { id: string };

  if (existing) {
    updateTrack.run(albumRow.id, trackArtistRow.id, rec.title, rec.trackNo, rec.discNo, duration, rec.genre, rec.year,
      stat.size, mtime, mime, bitrate, rec.playable ? 1 : 0, art, existing.id);
    return "updated";
  }
  insertTrack.run(crypto.randomUUID(), albumRow.id, trackArtistRow.id, rec.title, rec.trackNo, rec.discNo, duration, rec.genre, rec.year,
    filePath, stat.size, mtime, mime, bitrate, rec.playable ? 1 : 0, art);
  return "added";
}

/** Drop rows whose files are gone, then any artist/album left with no tracks. */
function prune(seen: Set<string>): number {
  const rows = db.prepare("SELECT id, path FROM music_tracks").all() as { id: string; path: string }[];
  const gone = rows.filter((r) => !seen.has(r.path));
  const del = db.prepare("DELETE FROM music_tracks WHERE id = ?");
  for (const r of gone) del.run(r.id);
  db.exec(`
    DELETE FROM music_albums WHERE id NOT IN (SELECT DISTINCT album_id FROM music_tracks);
    DELETE FROM music_artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM music_tracks)
      AND id NOT IN (SELECT DISTINCT artist_id FROM music_albums);
  `);
  return gone.length;
}

/**
 * Walk the library and bring the index in line with it. Incremental: a file
 * whose size and mtime are unchanged is skipped without being opened, so a
 * routine rescan of thousands of tracks costs a directory walk and little else.
 */
export async function scanLibrary(): Promise<ScanSummary> {
  if (!musicEnabled()) throw new Error("MUSIC_DIR is not configured");
  if (running) throw new Error("A scan is already running");
  running = true;
  const started = Date.now();
  const summary: ScanSummary = { scanned: 0, added: 0, updated: 0, removed: 0, unplayable: 0, seconds: 0 };
  const seen = new Set<string>();
  try {
    const root = path.resolve(config.musicDir);
    for (const filePath of walk(root)) {
      seen.add(filePath);
      summary.scanned += 1;
      try {
        const result = await indexFile(filePath, root);
        if (result === "added") summary.added += 1;
        else if (result === "updated") summary.updated += 1;
      } catch (error) {
        logger.warn({ error, filePath }, "Could not index audio file");
      }
    }
    summary.removed = prune(seen);
    summary.unplayable = (db.prepare("SELECT COUNT(*) AS n FROM music_tracks WHERE playable = 0").get() as any).n;
    summary.seconds = Math.round((Date.now() - started) / 1000);
    db.prepare("INSERT INTO music_scan_state (key, value) VALUES ('last_scan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ at: new Date().toISOString(), ...summary }));
    logger.info(summary, "Music library scan complete");
    return summary;
  } finally {
    running = false;
  }
}

export function scanInProgress(): boolean {
  return running;
}

export function lastScan(): (ScanSummary & { at: string }) | null {
  const row = db.prepare("SELECT value FROM music_scan_state WHERE key = 'last_scan'").get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
}

/** Scan on boot and then on the configured interval. */
export function startMusicScanner() {
  if (!musicEnabled()) {
    logger.info("Music module disabled (MUSIC_DIR not set)");
    return;
  }
  const run = () => scanLibrary().catch((error) => logger.error({ error }, "Music scan failed"));
  setTimeout(run, 5_000).unref();
  if (config.musicScanIntervalMinutes > 0) {
    setInterval(run, config.musicScanIntervalMinutes * 60_000).unref();
  }
}
