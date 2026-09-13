import crypto from "node:crypto";
import { db } from "../../db/schema.js";
import { toView, TRACK_SELECT, type TrackView } from "./service.js";

/**
 * Moods and mixes: what makes the home page feel curated rather than a log of
 * what you already did. Moods come from the audio analysis (analysis.ts);
 * mixes combine that with listening history, so they are personal to a user
 * and change every day without ever repeating the same order.
 */

// ---------- moods ----------

export type MoodDef = {
  id: string;
  name: string;
  blurb: string;
  /** Tailwind-free colours so the client can paint the tile without knowing the rules. */
  colors: [string, string];
  /** SQL over music_features f, built from the library's own percentiles so "chill" means the calmest third of what you own. */
  where: (p: Percentiles) => string;
  /** How to order within the mood so the best fits come first. */
  fit: string;
};

/** Percentile cut-offs of the analysed library: loud masters make absolute thresholds meaningless. */
export type Percentiles = { e30: number; e50: number; e70: number; t35: number; t50: number; t65: number; b35: number; b65: number; d50: number; d75: number; dyn40: number };

function percentiles(): Percentiles {
  const col = (name: string, q: number) => {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM music_features WHERE tempo IS NOT NULL").get() as any).n as number;
    if (!n) return 0;
    const off = Math.max(0, Math.min(n - 1, Math.floor(q * (n - 1))));
    return (db.prepare(`SELECT ${name} AS v FROM music_features WHERE tempo IS NOT NULL ORDER BY ${name} LIMIT 1 OFFSET ?`).get(off) as any).v as number;
  };
  return {
    e30: col("energy", 0.3), e50: col("energy", 0.5), e70: col("energy", 0.7),
    t35: col("tempo", 0.35), t50: col("tempo", 0.5), t65: col("tempo", 0.65),
    b35: col("brightness", 0.35), b65: col("brightness", 0.65),
    d50: col("dance", 0.5), d75: col("dance", 0.75), dyn40: col("dynamics", 0.4),
  };
}

export const MOODS: MoodDef[] = [
  { id: "hype", name: "Hype", blurb: "Loud, fast and made to move", colors: ["#A32638", "#5C1420"],
    where: (p) => `f.energy >= ${p.e70} AND f.tempo >= ${p.t65} AND f.dance >= ${p.d50}`, fit: "f.energy * f.dance DESC" },
  { id: "party", name: "Party", blurb: "The groove never lets go", colors: ["#B8471F", "#5A2410"],
    where: (p) => `f.dance >= ${p.d75} AND f.energy >= ${p.e50} AND f.tempo BETWEEN ${p.t35} AND ${p.t65}`, fit: "f.dance DESC, f.energy DESC" },
  { id: "feelgood", name: "Feel good", blurb: "Bright, warm and easy", colors: ["#D4A056", "#7A5520"],
    where: (p) => `f.brightness >= ${p.b65} AND f.energy BETWEEN ${p.e30} AND ${p.e70} AND f.tempo BETWEEN ${p.t35} AND ${p.t65}`, fit: "f.brightness DESC" },
  { id: "workout", name: "Workout", blurb: "Tempo up, no excuses", colors: ["#8A2C5B", "#3F1230"],
    where: (p) => `f.tempo >= ${p.t65} AND f.energy >= ${p.e50}`, fit: "f.tempo DESC" },
  { id: "chill", name: "Chill", blurb: "Unhurried, soft around the edges", colors: ["#2F5C6E", "#122A33"],
    where: (p) => `f.energy <= ${p.e30} AND f.tempo <= ${p.t50}`, fit: "f.energy ASC" },
  { id: "latenight", name: "Late night", blurb: "Low light, low key", colors: ["#3B2F6E", "#171233"],
    where: (p) => `f.energy <= ${p.e30} AND f.brightness <= ${p.b35}`, fit: "f.brightness ASC, f.energy ASC" },
  { id: "slowjams", name: "Slow jams", blurb: "Take it slow", colors: ["#7A2E4A", "#361220"],
    where: (p) => `f.tempo <= ${p.t35} AND f.energy BETWEEN ${p.e30} AND ${p.e70}`, fit: "f.tempo ASC" },
  { id: "focus", name: "Focus", blurb: "Steady, unobtrusive, keeps you in it", colors: ["#3C5A3E", "#16251A"],
    where: (p) => `f.dynamics <= ${p.dyn40} AND f.energy <= ${p.e50} AND f.dance <= ${p.d50}`, fit: "f.dynamics ASC" },
  { id: "calm", name: "Calm & classical", blurb: "Quiet rooms and open space", colors: ["#5B5F74", "#232634"],
    where: () => "f.energy <= 0.25", fit: "f.energy ASC" },
];

export type MoodView = { id: string; name: string; blurb: string; colors: [string, string]; trackCount: number; art: string | null };

// Mood counts and mix pools change slowly (as analysis and plays land); cache them briefly.
const moodCache: { at: number; data: MoodView[] } = { at: 0, data: [] };
const mixCache = new Map<string, { at: number; data: MixView[] }>();
const CACHE_MS = 5 * 60_000;

export function listMoods(): MoodView[] {
  if (Date.now() - moodCache.at < CACHE_MS) return moodCache.data;
  moodCache.data = computeMoods();
  moodCache.at = Date.now();
  return moodCache.data;
}

let pct: { at: number; p: Percentiles } | null = null;
function cutoffs(): Percentiles {
  if (!pct || Date.now() - pct.at > CACHE_MS) pct = { at: Date.now(), p: percentiles() };
  return pct.p;
}

function computeMoods(): MoodView[] {
  const p = cutoffs();
  return MOODS.map((m) => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM music_features f JOIN music_tracks t ON t.id = f.track_id WHERE t.playable = 1 AND f.tempo IS NOT NULL AND ${m.where(p)}`).get() as any;
    const art = db.prepare(`SELECT COALESCE(t.art_path, al.art_path) AS art FROM music_features f JOIN music_tracks t ON t.id = f.track_id JOIN music_albums al ON al.id = t.album_id
      WHERE t.playable = 1 AND f.tempo IS NOT NULL AND ${m.where(p)} AND COALESCE(t.art_path, al.art_path) IS NOT NULL ORDER BY ${m.fit} LIMIT 1`).get() as any;
    return { id: m.id, name: m.name, blurb: m.blurb, colors: m.colors, trackCount: row.n, art: art?.art ?? null };
  }).filter((m) => m.trackCount >= 5);
}

/** Up to `limit` tracks for a mood: the best 3× pool, then a day-seeded shuffle so the mix is stable for a day and fresh the next. */
export function moodTracks(userId: string, id: string, limit = 60): { mood: MoodView; tracks: TrackView[] } | null {
  const m = MOODS.find((x) => x.id === id);
  if (!m) return null;
  const view = listMoods().find((x) => x.id === id) ?? { id: m.id, name: m.name, blurb: m.blurb, colors: m.colors, trackCount: 0, art: null };
  const pool = db.prepare(`${TRACK_SELECT} JOIN music_features f ON f.track_id = t.id WHERE t.playable = 1 AND f.tempo IS NOT NULL AND ${m.where(cutoffs())} ORDER BY ${m.fit} LIMIT ?`).all(limit * 3) as any[];
  const tracks = seededShuffle(pool, `${userId}:${id}:${dayKey()}`).slice(0, limit);
  return { mood: view, tracks: withLikesFor(userId, tracks) };
}

// ---------- mixes ----------

export type MixView = { id: string; kind: "daily" | "discover" | "timeofday" | "artist"; name: string; blurb: string; colors: [string, string]; art: string | null; trackCount: number };

const PALETTES: [string, string][] = [["#A32638", "#2A0D13"], ["#B8471F", "#2E120A"], ["#3C5A3E", "#101A12"], ["#2F5C6E", "#0D1A20"], ["#7A2E4A", "#220D16"], ["#3B2F6E", "#110E22"]];

function dayKey() { return new Date().toISOString().slice(0, 10); }

/** Deterministic shuffle from a string seed: the same mix all day, a new order tomorrow. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let h = Number.parseInt(crypto.createHash("sha1").update(seed).digest("hex").slice(0, 8), 16) || 1;
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

function withLikesFor(userId: string, rows: any[]): TrackView[] {
  if (!rows.length) return [];
  const marks = rows.map(() => "?").join(",");
  const liked = new Set((db.prepare(`SELECT track_id FROM music_likes WHERE user_id = ? AND track_id IN (${marks})`).all(userId, ...rows.map((r) => r.id)) as any[]).map((r) => r.track_id));
  return rows.map((r) => toView(r, liked));
}

/** Genres the user actually listens to, most played first, over the last 90 days (all time if quiet). */
function topGenres(userId: string, limit: number): { genre: string; plays: number }[] {
  const since = Date.now() - 90 * 86_400_000;
  let rows = db.prepare(`SELECT t.genre, COUNT(*) AS plays FROM music_plays p JOIN music_tracks t ON t.id = p.track_id
    WHERE p.user_id = ? AND p.played_at > ? AND t.genre IS NOT NULL GROUP BY t.genre ORDER BY plays DESC LIMIT ?`).all(userId, since, limit) as any[];
  if (rows.length < 2) rows = db.prepare(`SELECT t.genre, COUNT(*) AS plays FROM music_tracks t WHERE t.genre IS NOT NULL GROUP BY t.genre ORDER BY plays DESC LIMIT ?`).all(limit) as any[];
  return rows;
}

/**
 * A daily mix for one genre: half songs from artists you play in it, half
 * songs in it you have not played (or not lately), liked songs weighted in.
 */
function dailyMixTracks(userId: string, genre: string, limit: number): any[] {
  const day = dayKey();
  const familiar = db.prepare(`${TRACK_SELECT}
    WHERE t.playable = 1 AND t.genre = ? AND t.artist_id IN (
      SELECT t2.artist_id FROM music_plays p JOIN music_tracks t2 ON t2.id = p.track_id WHERE p.user_id = ? GROUP BY t2.artist_id ORDER BY COUNT(*) DESC LIMIT 25)`).all(genre, userId) as any[];
  const fresh = db.prepare(`${TRACK_SELECT}
    WHERE t.playable = 1 AND t.genre = ? AND t.id NOT IN (SELECT track_id FROM music_plays WHERE user_id = ? AND played_at > ?)`).all(genre, userId, Date.now() - 14 * 86_400_000) as any[];
  // Liked songs float up in the familiar half; both halves reshuffle daily.
  const liked = new Set((db.prepare("SELECT track_id FROM music_likes WHERE user_id = ?").all(userId) as any[]).map((r) => r.track_id));
  const fam = seededShuffle(familiar, `${userId}:${genre}:fam:${day}`).sort((a, b) => Number(liked.has(b.id)) - Number(liked.has(a.id)));
  return interleave(dedupe(fam), dedupe(seededShuffle(fresh, `${userId}:${genre}:fresh:${day}`)), limit);
}

function dedupe(rows: any[]) { const seen = new Set<string>(); return rows.filter((r) => !seen.has(r.id) && seen.add(r.id)); }
function interleave(a: any[], b: any[], limit: number) {
  const out: any[] = []; const seen = new Set<string>();
  for (let i = 0; out.length < limit && (i < a.length || i < b.length); i += 1) {
    for (const r of [a[i], b[i]]) if (r && !seen.has(r.id) && out.length < limit) { seen.add(r.id); out.push(r); }
  }
  return out;
}

/** Songs you have never played, by artists you do play, plus songs whose sound sits near what you like. */
function discoverTracks(userId: string, limit: number): any[] {
  const day = dayKey();
  const byArtists = db.prepare(`${TRACK_SELECT}
    WHERE t.playable = 1 AND t.id NOT IN (SELECT track_id FROM music_plays WHERE user_id = ?)
      AND t.artist_id IN (SELECT t2.artist_id FROM music_plays p JOIN music_tracks t2 ON t2.id = p.track_id WHERE p.user_id = ? GROUP BY t2.artist_id ORDER BY COUNT(*) DESC LIMIT 40)`).all(userId, userId) as any[];
  // Centroid of the audio features of liked songs; nearest unplayed songs to it.
  const c = db.prepare(`SELECT AVG(f.tempo) AS tempo, AVG(f.energy) AS energy, AVG(f.brightness) AS brightness, AVG(f.dance) AS dance
    FROM music_likes l JOIN music_features f ON f.track_id = l.track_id WHERE l.user_id = ? AND f.tempo IS NOT NULL`).get(userId) as any;
  const bySound = c?.tempo ? db.prepare(`${TRACK_SELECT} JOIN music_features f ON f.track_id = t.id
    WHERE t.playable = 1 AND f.tempo IS NOT NULL AND t.id NOT IN (SELECT track_id FROM music_plays WHERE user_id = ?)
    ORDER BY ABS(f.tempo - ?) / 60.0 + ABS(f.energy - ?) * 2 + ABS(f.brightness - ?) + ABS(f.dance - ?) LIMIT ?`).all(userId, c.tempo, c.energy, c.brightness, c.dance, limit * 2) as any[] : [];
  return interleave(seededShuffle(byArtists, `${userId}:disc:a:${day}`), seededShuffle(bySound, `${userId}:disc:s:${day}`), limit);
}

/** Where the mood ought to be right now, by the clock. */
export function timeOfDayMood(hour = new Date().getHours()): { moodId: string; name: string; blurb: string } {
  if (hour < 6) return { moodId: "latenight", name: "Small hours", blurb: "Quiet company for the night" };
  if (hour < 11) return { moodId: "feelgood", name: "Morning lift", blurb: "Bright songs to start the day" };
  if (hour < 15) return { moodId: "focus", name: "Midday focus", blurb: "Steady sound that stays out of the way" };
  if (hour < 19) return { moodId: "party", name: "Afternoon groove", blurb: "Something with a pulse" };
  if (hour < 23) return { moodId: "chill", name: "Evening wind-down", blurb: "Ease off the day" };
  return { moodId: "latenight", name: "Late night", blurb: "Low light, low key" };
}

export function listMixes(userId: string): MixView[] {
  const hit = mixCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = computeMixes(userId);
  mixCache.set(userId, { at: Date.now(), data });
  return data;
}

function computeMixes(userId: string): MixView[] {
  const out: MixView[] = [];
  const genres = topGenres(userId, 4);
  genres.forEach((g, i) => {
    const tracks = dailyMixTracks(userId, g.genre, 40);
    if (tracks.length < 8) return;
    out.push({ id: `daily:${g.genre}`, kind: "daily", name: `Daily Mix ${out.length + 1}`, blurb: g.genre, colors: PALETTES[i % PALETTES.length], art: tracks.find((t) => t.art)?.art ?? null, trackCount: tracks.length });
  });
  const discover = discoverTracks(userId, 40);
  if (discover.length >= 5) out.push({ id: "discover", kind: "discover", name: "Discover", blurb: "Songs you own but have never played", colors: ["#1F6B5B", "#0A2A24"], art: discover.find((t) => t.art)?.art ?? null, trackCount: discover.length });
  const tod = timeOfDayMood();
  const mood = listMoods().find((m) => m.id === tod.moodId);
  if (mood) out.push({ id: `timeofday:${tod.moodId}`, kind: "timeofday", name: tod.name, blurb: tod.blurb, colors: mood.colors, art: mood.art, trackCount: Math.min(mood.trackCount, 60) });
  return out;
}

export function mixTracks(userId: string, id: string, limit = 50): { mix: MixView; tracks: TrackView[] } | null {
  const mixes = listMixes(userId);
  const mix = mixes.find((m) => m.id === id);
  if (!mix) return null;
  let rows: any[] = [];
  if (mix.kind === "daily") rows = dailyMixTracks(userId, id.slice("daily:".length), limit);
  else if (mix.kind === "discover") rows = discoverTracks(userId, limit);
  else if (mix.kind === "timeofday") return { mix, tracks: moodTracks(userId, id.slice("timeofday:".length), limit)?.tracks ?? [] };
  return { mix, tracks: withLikesFor(userId, seededShuffle(rows, `${userId}:${id}:${dayKey()}`)) };
}
