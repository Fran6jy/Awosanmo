import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";

/**
 * Lyrics from LRCLIB (lrclib.net): a free, open database with time-synced
 * lines for a large share of popular music. Looked up once per track and
 * cached — including misses, so a song with no lyrics is not asked about on
 * every open.
 */

export type LyricsView = { synced: { t: number; line: string }[] | null; plain: string | null };

const USER_AGENT = "JYMusic/1 (self-hosted library; https://github.com/Fran6jy/jymusic)";
const MISS_TTL_MS = 30 * 86_400_000;

/** "[01:23.45] line" → { t: 83.45, line } */
export function parseLrc(lrc: string): { t: number; line: string }[] {
  const out: { t: number; line: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = raw.match(/^\s*\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!m) continue;
    const frac = m[3] ? Number(m[3].padEnd(3, "0")) / 1000 : 0;
    out.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, line: m[4].trim() });
  }
  return out.sort((a, b) => a.t - b.t);
}

export async function lyricsFor(trackId: string): Promise<LyricsView | null> {
  const track = db.prepare(`SELECT t.title, t.duration, a.name AS artist, al.title AS album FROM music_tracks t
    JOIN music_artists a ON a.id = t.artist_id JOIN music_albums al ON al.id = t.album_id WHERE t.id = ?`).get(trackId) as any;
  if (!track) return null;
  const cached = db.prepare("SELECT synced, plain, fetched_at FROM music_lyrics WHERE track_id = ?").get(trackId) as any;
  if (cached && (cached.synced || cached.plain || Date.now() - cached.fetched_at < MISS_TTL_MS)) {
    return { synced: cached.synced ? parseLrc(cached.synced) : null, plain: cached.plain ?? null };
  }
  let synced: string | null = null, plain: string | null = null;
  try {
    const q = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
    if (track.album && track.album !== track.title) q.set("album_name", track.album);
    if (track.duration) q.set("duration", String(Math.round(track.duration)));
    let res = await fetch(`https://lrclib.net/api/get?${q}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) {
      // The exact-match endpoint is strict about album/duration; fall back to search and take the closest length.
      const s = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: track.title, artist_name: track.artist })}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      const list: any[] = s.ok ? await s.json() : [];
      const best = list.filter((r) => r.syncedLyrics || r.plainLyrics).sort((a, b) => Math.abs((a.duration ?? 0) - (track.duration ?? 0)) - Math.abs((b.duration ?? 0) - (track.duration ?? 0)))[0];
      if (best && (!track.duration || Math.abs((best.duration ?? 0) - track.duration) <= 8)) { synced = best.syncedLyrics ?? null; plain = best.plainLyrics ?? null; }
      res = null as any;
    }
    if (res?.ok) { const j: any = await res.json(); synced = j.syncedLyrics ?? null; plain = j.plainLyrics ?? null; }
  } catch (error) {
    logger.warn({ error, title: track.title }, "Lyrics lookup failed");
    if (cached) return { synced: cached.synced ? parseLrc(cached.synced) : null, plain: cached.plain ?? null };
  }
  db.prepare(`INSERT INTO music_lyrics (track_id, synced, plain, fetched_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET synced = excluded.synced, plain = excluded.plain, fetched_at = excluded.fetched_at`).run(trackId, synced, plain, Date.now());
  return { synced: synced ? parseLrc(synced) : null, plain };
}
