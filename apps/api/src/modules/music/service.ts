import crypto from "node:crypto";
import { db } from "../../db/schema.js";

/** Shape every track is returned in, joined with what the player needs to show it. */
export type TrackView = {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  duration: number | null;
  genre: string | null;
  year: number | null;
  art: string | null;
  playable: boolean;
  liked?: boolean;
};

export const TRACK_SELECT = `
  SELECT t.id, t.title, t.track_no, t.disc_no, t.duration, t.genre, t.year, t.playable,
         COALESCE(t.art_path, al.art_path) AS art,
         a.name AS artist, a.id AS artist_id,
         al.title AS album, al.id AS album_id,
         aa.name AS album_artist
  FROM music_tracks t
  JOIN music_artists a ON a.id = t.artist_id
  JOIN music_albums al ON al.id = t.album_id
  JOIN music_artists aa ON aa.id = al.artist_id
`;

export function toView(row: any, liked?: Set<string>): TrackView {
  return {
    id: row.id, title: row.title, artist: row.artist, artistId: row.artist_id,
    album: row.album, albumId: row.album_id, albumArtist: row.album_artist,
    trackNo: row.track_no, discNo: row.disc_no, duration: row.duration, genre: row.genre, year: row.year,
    art: row.art, playable: Boolean(row.playable),
    ...(liked ? { liked: liked.has(row.id) } : {}),
  };
}

function likedSet(userId: string, ids: string[]): Set<string> {
  if (!ids.length) return new Set();
  const marks = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT track_id FROM music_likes WHERE user_id = ? AND track_id IN (${marks})`).all(userId, ...ids) as any[];
  return new Set(rows.map((r) => r.track_id));
}

function withLikes(userId: string, rows: any[]): TrackView[] {
  const liked = likedSet(userId, rows.map((r) => r.id));
  return rows.map((r) => toView(r, liked));
}

// ---------- library counts / status ----------

export function libraryStats() {
  const one = (sql: string) => (db.prepare(sql).get() as any).n as number;
  return {
    tracks: one("SELECT COUNT(*) AS n FROM music_tracks"),
    albums: one("SELECT COUNT(*) AS n FROM music_albums"),
    artists: one("SELECT COUNT(*) AS n FROM music_artists"),
    durationSeconds: (db.prepare("SELECT COALESCE(SUM(duration),0) AS n FROM music_tracks").get() as any).n as number,
  };
}

// ---------- tracks ----------

export function getTrack(userId: string, id: string): TrackView | null {
  const row = db.prepare(`${TRACK_SELECT} WHERE t.id = ?`).get(id);
  return row ? withLikes(userId, [row])[0] : null;
}

/** Raw path/size for streaming; kept off the public view shape on purpose. */
export function getTrackFile(id: string): { path: string; size: number; mime: string | null; playable: number } | null {
  return db.prepare("SELECT path, size, mime, playable FROM music_tracks WHERE id = ?").get(id) as any ?? null;
}

/**
 * Remove a track from the index. Playlist entries, plays and likes go with it
 * (foreign keys cascade) and an album or artist left with nothing is dropped,
 * exactly as the scanner does when a file disappears. Returns the file path so
 * the caller can delete it from disk; null if the track did not exist.
 */
export function deleteTrack(id: string): { path: string } | null {
  const row = db.prepare("SELECT path FROM music_tracks WHERE id = ?").get(id) as { path: string } | undefined;
  if (!row) return null;
  db.transaction(() => {
    db.prepare("DELETE FROM music_tracks WHERE id = ?").run(id);
    db.exec(`
      DELETE FROM music_albums WHERE id NOT IN (SELECT DISTINCT album_id FROM music_tracks);
      DELETE FROM music_artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM music_tracks)
        AND id NOT IN (SELECT DISTINCT artist_id FROM music_albums);
    `);
  })();
  invalidateHome();
  return { path: row.path };
}

export function listTracks(userId: string, opts: { limit: number; offset: number; sort?: "title" | "added" | "artist" }) {
  const order = opts.sort === "added" ? "t.created_at DESC" : opts.sort === "artist" ? "a.name COLLATE NOCASE, al.title COLLATE NOCASE, t.disc_no, t.track_no" : "t.title COLLATE NOCASE";
  const rows = db.prepare(`${TRACK_SELECT} ORDER BY ${order} LIMIT ? OFFSET ?`).all(opts.limit, opts.offset);
  return withLikes(userId, rows);
}

// ---------- albums ----------

export type AlbumView = { id: string; title: string; artist: string; artistId: string; year: number | null; art: string | null; trackCount: number; duration: number };

const ALBUM_SELECT = `
  SELECT al.id, al.title, al.year, al.art_path AS art, a.name AS artist, a.id AS artist_id,
         COUNT(t.id) AS track_count, COALESCE(SUM(t.duration),0) AS duration,
         MAX(t.created_at) AS added_at
  FROM music_albums al
  JOIN music_artists a ON a.id = al.artist_id
  LEFT JOIN music_tracks t ON t.album_id = al.id
`;

function toAlbum(r: any): AlbumView {
  return { id: r.id, title: r.title, artist: r.artist, artistId: r.artist_id, year: r.year, art: r.art, trackCount: r.track_count, duration: r.duration };
}

export function listAlbums(opts: { limit: number; offset: number; sort?: "title" | "added" | "artist" | "year" }) {
  const order = opts.sort === "added" ? "added_at DESC" : opts.sort === "artist" ? "a.name COLLATE NOCASE, al.year, al.title COLLATE NOCASE" : opts.sort === "year" ? "al.year DESC, al.title COLLATE NOCASE" : "al.title COLLATE NOCASE";
  const rows = db.prepare(`${ALBUM_SELECT} GROUP BY al.id ORDER BY ${order} LIMIT ? OFFSET ?`).all(opts.limit, opts.offset);
  return rows.map(toAlbum);
}

export function getAlbum(userId: string, id: string) {
  const row = db.prepare(`${ALBUM_SELECT} WHERE al.id = ? GROUP BY al.id`).get(id);
  if (!row) return null;
  const tracks = withLikes(userId, db.prepare(`${TRACK_SELECT} WHERE t.album_id = ? ORDER BY t.disc_no, t.track_no, t.title COLLATE NOCASE`).all(id));
  return { ...toAlbum(row), tracks };
}

// ---------- artists ----------

export type ArtistView = { id: string; name: string; albumCount: number; trackCount: number; art: string | null; image: string | null };

const ARTIST_SELECT = `
  SELECT a.id, a.name, a.image_path AS image,
         (SELECT COUNT(*) FROM music_albums al WHERE al.artist_id = a.id) AS album_count,
         (SELECT COUNT(*) FROM music_tracks t WHERE t.artist_id = a.id) AS track_count,
         (SELECT COALESCE(t.art_path, al.art_path) FROM music_tracks t JOIN music_albums al ON al.id = t.album_id
            WHERE t.artist_id = a.id AND COALESCE(t.art_path, al.art_path) IS NOT NULL LIMIT 1) AS art
  FROM music_artists a
`;

export function listArtists(opts: { limit: number; offset: number }) {
  const rows = db.prepare(`${ARTIST_SELECT} WHERE track_count > 0 ORDER BY a.sort_name LIMIT ? OFFSET ?`).all(opts.limit, opts.offset) as any[];
  return rows.map((r) => ({ id: r.id, name: r.name, albumCount: r.album_count, trackCount: r.track_count, art: r.art, image: r.image ?? null }) as ArtistView);
}

export function getArtist(userId: string, id: string) {
  const row = db.prepare(`${ARTIST_SELECT} WHERE a.id = ?`).get(id) as any;
  if (!row) return null;
  const albums = (db.prepare(`${ALBUM_SELECT} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year DESC, al.title COLLATE NOCASE`).all(id)).map(toAlbum);
  // "Popular": what this user actually plays from the artist, falling back to album order.
  const top = withLikes(userId, db.prepare(`
    ${TRACK_SELECT}
    LEFT JOIN (SELECT track_id, COUNT(*) AS plays FROM music_plays WHERE user_id = ? GROUP BY track_id) p ON p.track_id = t.id
    WHERE t.artist_id = ?
    ORDER BY COALESCE(p.plays, 0) DESC, al.year DESC, t.track_no
    LIMIT 10
  `).all(userId, id));
  return { id: row.id, name: row.name, albumCount: row.album_count, trackCount: row.track_count, art: row.art, albums, topTracks: top };
}

// ---------- genres ----------

/** Fixed colours for the shelves the normaliser produces; anything else gets a hue from its name. */
const GENRE_COLORS: Record<string, [string, string]> = {
  "Pop": ["#C2416B", "#4A1428"], "Hip-Hop & R&B": ["#5B3FA8", "#1E1340"], "Country": ["#B8741F", "#4A2E0C"], "Electronic": ["#1F7A8C", "#0B2C33"],
  "Afro & Latin": ["#C9642B", "#4D2410"], "Christian & Gospel": ["#B08A2E", "#453410"], "Rock": ["#9A2A2A", "#3A0F0F"], "Soundtrack & Classical": ["#4E5A78", "#1B2030"],
  "Christmas": ["#2E7A48", "#0F2E1B"], "Blues & Jazz": ["#3A4FA6", "#141D40"],
};
export function genreColors(name: string): [string, string] {
  if (GENRE_COLORS[name]) return GENRE_COLORS[name];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [`hsl(${h % 360} 45% 32%)`, `hsl(${h % 360} 40% 14%)`];
}

export function listGenres() {
  return (db.prepare(`
    SELECT t.genre AS name, COUNT(*) AS track_count,
           -- The cover of the album with the most songs in this genre: a representative picture, not a random one.
           (SELECT al2.art_path FROM music_tracks t2 JOIN music_albums al2 ON al2.id = t2.album_id
              WHERE t2.genre = t.genre AND al2.art_path IS NOT NULL GROUP BY al2.id ORDER BY COUNT(*) DESC LIMIT 1) AS art
    FROM music_tracks t WHERE t.genre IS NOT NULL
    GROUP BY t.genre ORDER BY track_count DESC
  `).all() as any[]).map((r) => ({ name: r.name, trackCount: r.track_count, art: r.art, colors: genreColors(r.name) }));
}

export function getGenre(userId: string, name: string, opts: { limit: number; offset: number }) {
  const albums = (db.prepare(`${ALBUM_SELECT} WHERE al.id IN (SELECT DISTINCT album_id FROM music_tracks WHERE genre = ?) GROUP BY al.id ORDER BY al.title COLLATE NOCASE LIMIT 60`).all(name)).map(toAlbum);
  const tracks = withLikes(userId, db.prepare(`${TRACK_SELECT} WHERE t.genre = ? ORDER BY a.name COLLATE NOCASE, t.title COLLATE NOCASE LIMIT ? OFFSET ?`).all(name, opts.limit, opts.offset));
  const total = (db.prepare("SELECT COUNT(*) AS n FROM music_tracks WHERE genre = ?").get(name) as any).n;
  return { name, total, albums, tracks };
}

// ---------- search ----------

export function search(userId: string, q: string) {
  const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const tracks = withLikes(userId, db.prepare(`${TRACK_SELECT} WHERE t.title LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR al.title LIKE ? ESCAPE '\\' ORDER BY (t.title LIKE ? ESCAPE '\\') DESC, t.title COLLATE NOCASE LIMIT 30`).all(like, like, like, `${q}%`));
  const albums = (db.prepare(`${ALBUM_SELECT} WHERE al.title LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' GROUP BY al.id ORDER BY al.title COLLATE NOCASE LIMIT 12`).all(like, like)).map(toAlbum);
  const artists = (db.prepare(`${ARTIST_SELECT} WHERE a.name LIKE ? ESCAPE '\\' ORDER BY a.sort_name LIMIT 12`).all(like) as any[]).map((r) => ({ id: r.id, name: r.name, albumCount: r.album_count, trackCount: r.track_count, art: r.art, image: r.image ?? null }));
  return { tracks, albums, artists };
}

// ---------- home ----------

function buildHome(userId: string) {
  const recent = withLikes(userId, db.prepare(`
    ${TRACK_SELECT}
    JOIN (SELECT track_id, MAX(played_at) AS last, MAX(id) AS last_id FROM music_plays WHERE user_id = ? GROUP BY track_id ORDER BY last DESC, last_id DESC LIMIT 12) p ON p.track_id = t.id
    ORDER BY p.last DESC, p.last_id DESC
  `).all(userId));
  const onRepeat = withLikes(userId, db.prepare(`
    ${TRACK_SELECT}
    JOIN (SELECT track_id, COUNT(*) AS plays FROM music_plays WHERE user_id = ? AND played_at > ? GROUP BY track_id ORDER BY plays DESC LIMIT 12) p ON p.track_id = t.id
    ORDER BY p.plays DESC
  `).all(userId, Date.now() - 30 * 86_400_000));
  const recentAlbums = listAlbums({ limit: 12, offset: 0, sort: "added" });
  const genres = listGenres().slice(0, 8);
  // A fresh shuffle each visit gives the home page something to say before there is any history.
  const discover = withLikes(userId, db.prepare(`${TRACK_SELECT} WHERE t.id IN (SELECT id FROM music_tracks WHERE playable = 1 ORDER BY random() LIMIT 12)`).all());
  return { recent, onRepeat, recentAlbums, genres, discover };
}

// The home page is hit on every visit and its shelves change slowly, so serve
// it from a short per-user cache. Plays and likes invalidate it so the page
// reflects what you just did; the scanner invalidates all of it.
const homeCache = new Map<string, { at: number; data: ReturnType<typeof buildHome> }>();
const HOME_TTL_MS = 60_000;

export function home(userId: string) {
  const hit = homeCache.get(userId);
  if (hit && Date.now() - hit.at < HOME_TTL_MS) return hit.data;
  const data = buildHome(userId);
  homeCache.set(userId, { at: Date.now(), data });
  return data;
}

export function invalidateHome(userId?: string) {
  if (userId) homeCache.delete(userId); else homeCache.clear();
}

// ---------- plays & likes ----------

export function recordPlay(userId: string, trackId: string) {
  const exists = db.prepare("SELECT 1 FROM music_tracks WHERE id = ?").get(trackId);
  if (!exists) return false;
  db.prepare("INSERT INTO music_plays (user_id, track_id, played_at) VALUES (?, ?, ?)").run(userId, trackId, Date.now());
  invalidateHome(userId);
  return true;
}

export function setLiked(userId: string, trackId: string, liked: boolean) {
  const exists = db.prepare("SELECT 1 FROM music_tracks WHERE id = ?").get(trackId);
  if (!exists) return false;
  if (liked) db.prepare("INSERT OR IGNORE INTO music_likes (user_id, track_id, liked_at) VALUES (?, ?, ?)").run(userId, trackId, Date.now());
  else db.prepare("DELETE FROM music_likes WHERE user_id = ? AND track_id = ?").run(userId, trackId);
  invalidateHome(userId);
  return true;
}

export function likedTracks(userId: string, opts: { limit: number; offset: number }) {
  const rows = db.prepare(`${TRACK_SELECT} JOIN music_likes l ON l.track_id = t.id AND l.user_id = ? ORDER BY l.liked_at DESC LIMIT ? OFFSET ?`).all(userId, opts.limit, opts.offset);
  const total = (db.prepare("SELECT COUNT(*) AS n FROM music_likes WHERE user_id = ?").get(userId) as any).n;
  return { total, tracks: rows.map((r) => toView(r, new Set(rows.map((x: any) => x.id)))) };
}

// ---------- playlists ----------

export type PlaylistView = { id: string; name: string; trackCount: number; duration: number; art: string | null; customArt: boolean; updatedAt: string };

const PLAYLIST_SELECT = `
  SELECT p.id, p.name, p.updated_at, p.cover_path AS custom_art,
         COUNT(pt.track_id) AS track_count, COALESCE(SUM(t.duration),0) AS duration,
         COALESCE(p.cover_path,
           (SELECT COALESCE(t2.art_path, al2.art_path) FROM music_playlist_tracks pt2 JOIN music_tracks t2 ON t2.id = pt2.track_id JOIN music_albums al2 ON al2.id = t2.album_id
              WHERE pt2.playlist_id = p.id AND COALESCE(t2.art_path, al2.art_path) IS NOT NULL ORDER BY pt2.position LIMIT 1)) AS art
  FROM music_playlists p
  LEFT JOIN music_playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN music_tracks t ON t.id = pt.track_id
`;

function toPlaylist(r: any): PlaylistView {
  return { id: r.id, name: r.name, trackCount: r.track_count, duration: r.duration, art: r.art, customArt: Boolean(r.custom_art), updatedAt: r.updated_at };
}

export function listPlaylists(userId: string) {
  return (db.prepare(`${PLAYLIST_SELECT} WHERE p.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC`).all(userId)).map(toPlaylist);
}

export function createPlaylist(userId: string, name: string) {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO music_playlists (id, user_id, name) VALUES (?, ?, ?)").run(id, userId, name);
  return getPlaylist(userId, id);
}

export function getPlaylist(userId: string, id: string) {
  const row = db.prepare(`${PLAYLIST_SELECT} WHERE p.id = ? AND p.user_id = ? GROUP BY p.id`).get(id, userId);
  if (!row) return null;
  const rows = db.prepare(`${TRACK_SELECT} JOIN music_playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ? ORDER BY pt.position`).all(id) as any[];
  const positions = db.prepare("SELECT position, track_id FROM music_playlist_tracks WHERE playlist_id = ? ORDER BY position").all(id) as any[];
  const tracks = withLikes(userId, rows).map((t, i) => ({ ...t, position: positions[i]?.position ?? i }));
  return { ...toPlaylist(row), tracks };
}

export function renamePlaylist(userId: string, id: string, name: string) {
  const r = db.prepare("UPDATE music_playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(name, id, userId) as any;
  return r.changes > 0;
}

/** Set (or with null, clear) a custom cover; the file itself lives in the art cache. */
export function setPlaylistCover(userId: string, id: string, coverPath: string | null) {
  const r = db.prepare("UPDATE music_playlists SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(coverPath, id, userId) as any;
  return r.changes > 0;
}

export function deletePlaylist(userId: string, id: string) {
  const r = db.prepare("DELETE FROM music_playlists WHERE id = ? AND user_id = ?").run(id, userId) as any;
  return r.changes > 0;
}

export function addToPlaylist(userId: string, id: string, trackId: string) {
  const owned = db.prepare("SELECT 1 FROM music_playlists WHERE id = ? AND user_id = ?").get(id, userId);
  const track = db.prepare("SELECT 1 FROM music_tracks WHERE id = ?").get(trackId);
  if (!owned || !track) return false;
  const next = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM music_playlist_tracks WHERE playlist_id = ?").get(id) as any).n;
  db.prepare("INSERT INTO music_playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)").run(id, trackId, next);
  db.prepare("UPDATE music_playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  return true;
}

export function removeFromPlaylist(userId: string, id: string, position: number) {
  const owned = db.prepare("SELECT 1 FROM music_playlists WHERE id = ? AND user_id = ?").get(id, userId);
  if (!owned) return false;
  const r = db.prepare("DELETE FROM music_playlist_tracks WHERE playlist_id = ? AND position = ?").run(id, position) as any;
  if (r.changes) db.prepare("UPDATE music_playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  return r.changes > 0;
}

// ---------- playback session (one active device per user) ----------

export type PlaybackInput = {
  deviceId: string; deviceName: string; trackId: string | null; queueIds: string[]; cursor: number;
  shuffle: boolean; repeat: "off" | "all" | "one"; position: number; playing: boolean;
  context: { kind: string; name: string } | null;
};
export type PlaybackView = PlaybackInput & { track: TrackView | null; updatedAt: number; stale: boolean };

/** A device that has not reported for this long is assumed gone (tab closed). */
const PLAYBACK_STALE_MS = 25_000;

export function getPlayback(userId: string): PlaybackView | null {
  const r = db.prepare("SELECT * FROM music_playback WHERE user_id = ?").get(userId) as any;
  if (!r) return null;
  const stale = Date.now() - r.updated_at > PLAYBACK_STALE_MS;
  return {
    deviceId: r.device_id, deviceName: r.device_name, trackId: r.track_id,
    queueIds: JSON.parse(r.queue_ids || "[]"), cursor: r.cursor, shuffle: Boolean(r.shuffle), repeat: r.repeat,
    position: r.position, playing: Boolean(r.playing) && !stale, context: r.context ? JSON.parse(r.context) : null,
    track: r.track_id ? getTrack(userId, r.track_id) : null, updatedAt: r.updated_at, stale,
  };
}

/**
 * Record a device's playback state. The most recent report always wins: a
 * device that starts playing simply becomes the session, and the previous one
 * learns it has been superseded from the broadcast that follows.
 */
export function setPlayback(userId: string, s: PlaybackInput): PlaybackView {
  db.prepare(`
    INSERT INTO music_playback (user_id, device_id, device_name, track_id, queue_ids, cursor, shuffle, repeat, position, playing, context, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      device_id = excluded.device_id, device_name = excluded.device_name, track_id = excluded.track_id,
      queue_ids = excluded.queue_ids, cursor = excluded.cursor, shuffle = excluded.shuffle, repeat = excluded.repeat,
      position = excluded.position, playing = excluded.playing, context = excluded.context, updated_at = excluded.updated_at
  `).run(userId, s.deviceId, s.deviceName.slice(0, 80), s.trackId, JSON.stringify(s.queueIds.slice(0, 2000)), s.cursor,
    s.shuffle ? 1 : 0, s.repeat, s.position, s.playing ? 1 : 0, s.context ? JSON.stringify(s.context) : null, Date.now());
  return getPlayback(userId)!;
}

/** A device bowing out clears the session only if it still owns it. */
export function clearPlayback(userId: string, deviceId: string): boolean {
  const r = db.prepare("DELETE FROM music_playback WHERE user_id = ? AND device_id = ?").run(userId, deviceId) as any;
  return r.changes > 0;
}

/** Tracks by id, in the order asked for (queue handoff between devices). */
export function tracksByIds(userId: string, ids: string[]): TrackView[] {
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(",");
  const rows = withLikes(userId, db.prepare(`${TRACK_SELECT} WHERE t.id IN (${marks})`).all(...ids));
  const byId = new Map(rows.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is TrackView => Boolean(t));
}
