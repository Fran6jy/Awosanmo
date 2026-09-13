import crypto from "node:crypto";
import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";
import { normalizeGenre, sortKey, UNKNOWN_ALBUM, UNKNOWN_ARTIST } from "./normalize.js";
import { storeArt } from "./art.js";
import { invalidateHome } from "./service.js";

/**
 * Metadata repair. Ripped and downloaded files come with junk in their names
 * ("[SoundCloudMP3.cc]", "www.tooxclusive.com" as the artist, no cover) and
 * the library looks only as good as its tags. This module cleans the obvious
 * noise, then asks Deezer's public catalogue for the real record and applies
 * it when title, artist and duration all agree. Each decision is stored per
 * track so a file is looked up once; a rescan of an unchanged file keeps it.
 */

export type EnrichSummary = { checked: number; matched: number; cleaned: number; unmatched: number; art: number; seconds: number };

const DEEZER = "https://api.deezer.com";
const USER_AGENT = "JYMusic/1 (self-hosted library; metadata repair)";
// Deezer allows 50 calls per 5 s per IP; stay well under it.
const MIN_GAP_MS = 140;
const HTTP_TIMEOUT_MS = 12_000;

// ---------- text cleaning (pure; unit tested) ----------

const SITE = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|cc|ng|co\.uk|info|me|to|io)\b/gi;
const NOISE_PATTERNS: RegExp[] = [
  /[\[(【]\s*(?:official\s+)?(?:music\s+)?(?:video|audio|visuali[sz]er|lyrics?|lyric video|hd|hq|4k|mp3|320kbps|youtube|letralyrics|prod?\.?\s*by[^\])】]*)\s*[\])】]/gi,
  /\b(?:official\s+(?:music\s+)?video|official\s+audio|lyric\s+video|lyrics|visuali[sz]er)\b/gi,
  /\bnaijapals\b|\bnaijaexclusive\b|\btooxclusive\b|\bqoret\b|\bsoundcloudmp3\b|\bnaijaloaded\b|\bnotjustok\b|\b9jaflaver\b|\bwaploaded\b/gi,
  /(?:320|256|192|128)\s*kbps|ncs release|free download/gi,
  /\s\(\d\)\s*$/g,                // "(1)" duplicate-download suffix
  /\|\|/g,                        // "Title || site" separators
  /[\[(]\s*[\])]/g,               // empty brackets left behind
];

/** Strip site names, "official video" tags and their leftovers from a title or name. */
export function cleanName(raw: string): string {
  let s = raw.replace(/_/g, " ").replace(/\+/g, " ");
  s = s.replace(SITE, " ");
  for (const p of NOISE_PATTERNS) s = s.replace(p, " ");
  s = s.replace(/\s*[-–|]\s*$/g, "").replace(/^\s*[-–|]\s*/g, "");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([,)\]])/g, "$1").replace(/([(\[])\s+/g, "$1").trim();
  return s;
}

/** Names that carry no information about who made the song. */
export function isJunkName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim();
  if (!n || n === UNKNOWN_ARTIST || n === UNKNOWN_ALBUM) return true;
  if (/^(unknown|various( artists)?|va|artist|album|untitled|track ?\d*|audio ?track|new artist|new album)$/i.test(n)) return true;
  if (SITE.test(n)) { SITE.lastIndex = 0; return true; }
  SITE.lastIndex = 0;
  if (/^[\d\s.\-_]+$/.test(n)) return true;
  return false;
}

/** Lowercase alphanumerics with featured-artist and bracketed parts removed: the comparable core of a title. */
export function titleKey(s: string): string {
  return s.toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(feat|ft|featuring)\.?\b.*$/, " ")
    .replace(/\b(remix|remastered|remaster|version|edit|live|acoustic|radio|extended|original mix)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i += 1) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}

/** Sørensen–Dice similarity on character bigrams, 0..1; forgiving of small spelling differences. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a), gb = bigrams(b);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

export type Candidate = {
  provider: "deezer" | "itunes"; id: number; title: string; artist: string; artistId: number; album: string; albumId: number; duration: number;
  cover: string | null; artistPicture: string | null; year?: number | null; genre?: string | null;
};
export type Local = { title: string; artist: string | null; duration: number | null };

/**
 * How well a catalogue record matches the local file. Title must match well;
 * artist must match unless we do not trust the local artist at all; and the
 * duration is the tie-breaker that stops "Halo" by X becoming "Halo" by Y.
 */
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The comparable forms of a local title. Filenames carry the artist and
 * featured guests in every order imaginable ("banky w ft wizkid-omoge u too
 * much"), so besides the whole title we try each dash/pipe-separated segment,
 * with and without the candidate's artist name removed.
 */
function titleVariants(title: string, artistKey: string): { key: string; segment: boolean }[] {
  const out: { key: string; segment: boolean }[] = [];
  const push = (raw: string, segment: boolean) => {
    const k = titleKey(raw);
    if (k) out.push({ key: k, segment });
    if (artistKey.length >= 3 && k.includes(artistKey)) { const stripped = k.replace(artistKey, ""); if (stripped) out.push({ key: stripped, segment }); }
  };
  push(title, false);
  for (const seg of title.split(/\s*[-–|:]\s*/)) if (seg.trim() && seg !== title) push(seg, true);
  return out;
}

export function score(local: Local, c: Candidate): number {
  const artistKey = alnum(c.artist);
  const artistInTitle = artistKey.length >= 3 && alnum(local.title).includes(artistKey);
  const artistKnown = !isJunkName(local.artist);
  const cKey = titleKey(c.title);
  let t = 0;
  for (const v of titleVariants(local.title, artistKey)) {
    // A lone segment is only trusted when we know who the artist is; otherwise
    // "Intro - something" would match every "Intro" of the right length.
    if (v.segment && !(artistInTitle || artistKnown)) continue;
    t = Math.max(t, similarity(v.key, cKey));
  }
  // "M.I" vs "M.I Abaga", "Banky W" vs "Banky W.": one name containing the other counts as agreement.
  const localArtistKey = artistKnown ? alnum(titleKey(local.artist!)) : "";
  const contains = localArtistKey.length >= 2 && artistKey.length >= 2 && (artistKey.includes(localArtistKey) || localArtistKey.includes(artistKey));
  const a = artistKnown ? Math.max(similarity(localArtistKey, artistKey), contains ? 0.85 : 0, artistInTitle ? 0.9 : 0) : artistInTitle ? 0.9 : 0.75;
  // A slightly off spelling ("Luv" / "Love") is fine when the artist is certain and the length agrees exactly.
  const sameLength = !!local.duration && !!c.duration && Math.abs(local.duration - c.duration) <= 3;
  if (t < 0.8 && !(t >= 0.7 && a >= 0.9 && sameLength)) return 0;
  if (artistKnown && a < 0.6) return 0;
  // No artist evidence at all: only a near-exact title with a near-exact length will do,
  // otherwise "Seven Days" by anyone of the right length would be accepted.
  if (!artistKnown && !artistInTitle && !(t >= 0.92 && local.duration && c.duration && Math.abs(local.duration - c.duration) <= 2)) return 0;
  // Without a duration to check, a bare title match is not enough unless the artist agrees too.
  let d = 0.3;
  if (local.duration && c.duration) {
    const delta = Math.abs(local.duration - c.duration);
    if (delta > 12) return 0;
    d = delta <= 3 ? 1 : delta <= 7 ? 0.8 : 0.6;
  }
  return t * 0.5 + a * 0.3 + d * 0.2;
}

export const ACCEPT = 0.82;

/** "Artist - Title" (or "Artist- Title") as ripped filenames put it; null when the title has no such shape. */
export function splitArtistTitle(title: string): { artist: string; title: string } | null {
  const m = title.match(/^(.{2,40}?)\s*[-–]\s*(.{2,})$/);
  if (!m) return null;
  const artist = m[1].replace(/(feat|ft|featuring)\.?.*$/i, "").trim();
  if (!artist || isJunkName(artist) || /^\d+$/.test(artist)) return null;
  return { artist, title: m[2].trim() };
}

/** Pick the best candidate above the acceptance threshold. */
export function choose(local: Local, candidates: Candidate[]): Candidate | null {
  let best: Candidate | null = null, bestScore = 0;
  for (const c of candidates) {
    const s = score(local, c);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return bestScore >= ACCEPT ? best : null;
}

// ---------- Deezer client ----------

let lastCall = 0;
async function deezer<T>(pathAndQuery: string): Promise<T | null> {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`${DEEZER}${pathAndQuery}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      if (json?.error) {
        // Quota exceeded: back off and retry rather than mark tracks unmatched.
        if (json.error.code === 4) { await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1))); continue; }
        return null;
      }
      return json as T;
    } catch (error) {
      if (attempt === 2) { logger.warn({ error, pathAndQuery }, "Deezer request failed"); return null; }
      await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
    }
  }
  return null;
}

function toCandidate(d: any): Candidate {
  return {
    provider: "deezer", id: d.id, title: d.title, artist: d.artist?.name ?? "", artistId: d.artist?.id ?? 0,
    album: d.album?.title ?? "", albumId: d.album?.id ?? 0, duration: d.duration ?? 0,
    cover: d.album?.cover_xl ?? d.album?.cover_big ?? null, artistPicture: d.artist?.picture_xl ?? d.artist?.picture_big ?? null,
  };
}

export async function searchDeezer(local: Local): Promise<Candidate[]> {
  const queries: string[] = [];
  const title = titleKey(local.title) ? local.title.replace(/\(.*?\)|\[.*?\]/g, " ").trim() : local.title;
  if (!isJunkName(local.artist)) queries.push(`artist:"${local.artist}" track:"${title}"`, `${local.artist} ${title}`);
  queries.push(title);
  // Filenames that carry the artist: "Chase rice 25 wexford st", "Phil Vassar- Thats when i love you".
  const dash = title.match(/^(.{2,40}?)\s*[-–]\s*(.{2,})$/);
  if (dash) queries.push(`${dash[1]} ${dash[2]}`);
  const beforeFeat = title.replace(/(feat|ft|featuring)\.?.*$/i, "").trim();
  if (beforeFeat && beforeFeat !== title) queries.push(beforeFeat);
  const words = beforeFeat.split(/\s+/);
  if (words.length > 6) queries.push(words.slice(0, 6).join(" "));
  if (dash) {
    // "banky w ft wizkid-omoge u too much": lead artist from the first half, song from the second.
    const lead = dash[1].replace(/(feat|ft|featuring|x|&)\.?.*$/i, "").trim();
    if (lead && lead !== dash[1]) queries.push(`${lead} ${dash[2]}`);
    queries.push(dash[2]);
  }
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  for (const q of unique) {
    const r = await deezer<{ data: any[] }>(`/search?limit=8&q=${encodeURIComponent(q)}`);
    for (const d of r?.data ?? []) if (!seen.has(`d${d.id}`)) { seen.add(`d${d.id}`); out.push(toCandidate(d)); }
    if (out.length && choose(local, out)) return out; // good enough; do not spend more calls
  }
  // Deezer had nothing convincing: Apple's catalogue is stronger for African and Asian releases.
  for (const q of unique.slice(0, 3)) {
    for (const c of await itunes(q)) if (!seen.has(`i${c.id}`)) { seen.add(`i${c.id}`); out.push(c); }
    if (choose(local, out)) break;
  }
  return out;
}

// iTunes Search allows roughly 20 calls a minute per IP, so it is the fallback, not the first stop.
let lastItunes = 0;
async function itunes(term: string): Promise<Candidate[]> {
  const wait = lastItunes + 3_200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastItunes = Date.now();
  try {
    const res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=6&term=${encodeURIComponent(term)}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json.results ?? []).filter((r: any) => r.trackName && r.artistName).map((r: any): Candidate => ({
      provider: "itunes", id: r.trackId, title: r.trackName, artist: r.artistName, artistId: r.artistId ?? 0,
      album: r.collectionName ?? r.trackName, albumId: r.collectionId ?? 0, duration: Math.round((r.trackTimeMillis ?? 0) / 1000),
      cover: r.artworkUrl100 ? String(r.artworkUrl100).replace(/100x100bb/, "600x600bb") : null, artistPicture: null,
      year: r.releaseDate ? Number(String(r.releaseDate).slice(0, 4)) || null : null, genre: r.primaryGenreName ?? null,
    }));
  } catch { return []; }
}

const albumCache = new Map<number, { year: number | null; genre: string | null }>();
async function albumDetails(albumId: number): Promise<{ year: number | null; genre: string | null }> {
  const hit = albumCache.get(albumId);
  if (hit) return hit;
  const a = await deezer<any>(`/album/${albumId}`);
  const year = a?.release_date ? Number(String(a.release_date).slice(0, 4)) || null : null;
  const genre = a?.genres?.data?.[0]?.name ?? null;
  const v = { year, genre };
  albumCache.set(albumId, v);
  return v;
}

const imageCache = new Map<string, string | null>();
async function fetchImage(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url)!;
  let name: string | null = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      // Deezer serves a 1x1 placeholder for missing images; skip anything that small.
      if (buf.length > 2_000) name = storeArt(buf, res.headers.get("content-type") ?? "image/jpeg");
    }
  } catch { /* leave without art */ }
  imageCache.set(url, name);
  return name;
}

// ---------- applying a result ----------

type TrackRow = { id: string; title: string; artist: string; album: string; album_artist: string; duration: number | null; genre: string | null; year: number | null; art_path: string | null; album_art: string | null; size: number; mtime: number; album_id: string; artist_id: string };

function stmts() {
  return {
    upsertArtist: db.prepare(`INSERT INTO music_artists (id, name, sort_name) VALUES (?, ?, ?)
      ON CONFLICT(sort_name) DO UPDATE SET name = excluded.name RETURNING id`),
    upsertAlbum: db.prepare(`INSERT INTO music_albums (id, artist_id, title, sort_title, year, art_path) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(artist_id, sort_title) DO UPDATE SET
        year = COALESCE(excluded.year, music_albums.year),
        art_path = COALESCE(excluded.art_path, music_albums.art_path)
      RETURNING id`),
    setArtistImage: db.prepare("UPDATE music_artists SET image_path = COALESCE(?, image_path) WHERE id = ?"),
    moveTrack: db.prepare("UPDATE music_tracks SET album_id = ?, artist_id = ?, title = ?, year = COALESCE(?, year), genre = COALESCE(genre, ?), art_path = COALESCE(?, art_path) WHERE id = ?"),
    setTrackTitle: db.prepare("UPDATE music_tracks SET title = ? WHERE id = ?"),
    setArtistName: db.prepare("UPDATE music_artists SET name = ?, sort_name = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM music_artists x WHERE x.sort_name = ? AND x.id <> ?)"),
    setAlbumTitle: db.prepare("UPDATE music_albums SET title = ?, sort_title = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM music_albums x WHERE x.artist_id = music_albums.artist_id AND x.sort_title = ? AND x.id <> ?)"),
    remember: db.prepare(`INSERT INTO music_enrich (track_id, status, provider_id, size, mtime, checked_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET status = excluded.status, provider_id = excluded.provider_id, size = excluded.size, mtime = excluded.mtime, checked_at = excluded.checked_at`),
    prune: db.prepare(`DELETE FROM music_albums WHERE id NOT IN (SELECT DISTINCT album_id FROM music_tracks)`),
    pruneArtists: db.prepare(`DELETE FROM music_artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM music_tracks) AND id NOT IN (SELECT DISTINCT artist_id FROM music_albums)`),
  };
}

/** Tracks the repair has not looked at yet (or whose file changed since). */
function pending(limit: number): TrackRow[] {
  return db.prepare(`
    SELECT t.id, t.title, a.name AS artist, al.title AS album, aa.name AS album_artist, t.duration, t.genre, t.year, t.art_path, al.art_path AS album_art,
           t.size, t.mtime, t.album_id, t.artist_id
    FROM music_tracks t
    JOIN music_artists a ON a.id = t.artist_id
    JOIN music_albums al ON al.id = t.album_id
    JOIN music_artists aa ON aa.id = al.artist_id
    LEFT JOIN music_enrich e ON e.track_id = t.id
    WHERE e.track_id IS NULL OR e.size <> t.size OR e.mtime <> t.mtime
    ORDER BY t.created_at DESC
    LIMIT ?`).all(limit) as TrackRow[];
}

/**
 * "Banky W" and "Banky W." are one artist. Catalogues disagree on punctuation,
 * so before creating an artist row we look for an existing one whose name
 * matches on letters and digits alone, and reuse its spelling.
 */
function canonicalArtistName(name: string): string {
  const key = alnum(name);
  if (!key) return name;
  const rows = db.prepare("SELECT name FROM music_artists").all() as { name: string }[];
  const hit = rows.find((r) => alnum(r.name) === key && !isJunkName(r.name));
  return hit ? hit.name : name;
}

/** Apply a catalogue match: correct names, move the track under the right artist/album, attach art. */
async function applyMatch(row: TrackRow, c: Candidate, s: ReturnType<typeof stmts>): Promise<boolean> {
  const details = c.provider === "deezer" ? await albumDetails(c.albumId) : { year: c.year ?? null, genre: c.genre ?? null };
  const cover = row.art_path || row.album_art ? null : await fetchImage(c.cover);
  const picture = await fetchImage(c.artistPicture);
  // The catalogue's artist name is canonical (a local tag often carries the
  // featured guests too), unified with any spelling the library already has.
  // A properly tagged album keeps its own name — the catalogue may know the
  // song from a compilation — and a clean title keeps its spelling.
  const artistName = canonicalArtistName(c.artist);
  const albumIsReal = !isJunkName(row.album) && sortKey(row.album) !== sortKey(row.title) && cleanName(row.album) === row.album && alnum(row.artist) === alnum(artistName);
  const albumTitle = albumIsReal ? row.album : c.album;
  const title = cleanName(row.title) === row.title && !isJunkName(row.artist) && !splitArtistTitle(row.title) ? row.title : c.title;
  db.transaction(() => {
    const artistId = (s.upsertArtist.get(crypto.randomUUID(), artistName, sortKey(artistName)) as any).id as string;
    if (picture) s.setArtistImage.run(picture, artistId);
    // Album art: prefer what the file already had; otherwise the catalogue cover.
    const albumId = (s.upsertAlbum.get(crypto.randomUUID(), artistId, albumTitle, sortKey(albumTitle), details.year, cover ?? row.album_art ?? row.art_path) as any).id as string;
    s.moveTrack.run(albumId, artistId, title, details.year, normalizeGenre(details.genre), cover, row.id);
  })();
  return Boolean(cover);
}

let running = false;
let progress: { done: number; total: number } | null = null;
export function enrichInProgress() { return running; }
export function enrichProgress() { return progress; }

/**
 * Repair everything not yet looked at. Safe to call repeatedly; returns when
 * the backlog is empty or `maxTracks` have been processed.
 */
export async function enrichLibrary(maxTracks = 5_000): Promise<EnrichSummary> {
  if (running) throw new Error("Metadata repair is already running");
  running = true;
  const started = Date.now();
  const summary: EnrichSummary = { checked: 0, matched: 0, cleaned: 0, unmatched: 0, art: 0, seconds: 0 };
  const s = stmts();
  try {
    const rows = pending(maxTracks);
    progress = { done: 0, total: rows.length };
    for (const row of rows) {
      progress.done += 1;
      summary.checked += 1;
      try {
        const cleanedTitle = cleanName(row.title) || row.title;
        let local: Local = { title: cleanedTitle, artist: isJunkName(row.artist) ? null : cleanName(row.artist), duration: row.duration };
        // With no usable artist tag, an "Artist - Title" filename is the next best evidence.
        const split = !local.artist ? splitArtistTitle(cleanedTitle) : null;
        if (split) local = { ...local, artist: split.artist, title: split.title };
        const match = choose(local, await searchDeezer(local));
        if (match) {
          if (await applyMatch(row, match, s)) summary.art += 1;
          summary.matched += 1;
          s.remember.run(row.id, "matched", String(match.id), row.size, row.mtime, Date.now());
          continue;
        }
        // No trustworthy match: at least take the junk out of what we have, and
        // let an "Artist - Title" filename stand in for a missing artist tag.
        let cleaned = false;
        if (split) {
          db.transaction(() => {
            const name = canonicalArtistName(split.artist);
            const artistId = (s.upsertArtist.get(crypto.randomUUID(), name, sortKey(name)) as any).id as string;
            const albumTitle = isJunkName(row.album) || sortKey(row.album) === sortKey(row.title) ? split.title : row.album;
            const albumId = (s.upsertAlbum.get(crypto.randomUUID(), artistId, albumTitle, sortKey(albumTitle), row.year, row.album_art ?? row.art_path) as any).id as string;
            s.moveTrack.run(albumId, artistId, split.title, null, null, null, row.id);
          })();
          cleaned = true;
        } else if (cleanedTitle !== row.title) { s.setTrackTitle.run(cleanedTitle, row.id); cleaned = true; }
        const cleanedArtist = cleanName(row.artist);
        if (cleanedArtist && cleanedArtist !== row.artist && !isJunkName(cleanedArtist)) { s.setArtistName.run(cleanedArtist, sortKey(cleanedArtist), row.artist_id, sortKey(cleanedArtist), row.artist_id); cleaned = true; }
        const cleanedAlbum = cleanName(row.album);
        if (cleanedAlbum && cleanedAlbum !== row.album && !isJunkName(cleanedAlbum)) { s.setAlbumTitle.run(cleanedAlbum, sortKey(cleanedAlbum), row.album_id, sortKey(cleanedAlbum), row.album_id); cleaned = true; }
        if (cleaned) summary.cleaned += 1; else summary.unmatched += 1;
        s.remember.run(row.id, cleaned ? "cleaned" : "unmatched", null, row.size, row.mtime, Date.now());
      } catch (error) {
        logger.warn({ error, track: row.title }, "Metadata repair failed for a track");
        s.remember.run(row.id, "error", null, row.size, row.mtime, Date.now());
      }
    }
    db.transaction(() => { s.prune.run(); s.pruneArtists.run(); })();
    summary.seconds = Math.round((Date.now() - started) / 1000);
    db.prepare("INSERT INTO music_scan_state (key, value) VALUES ('last_enrich', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ at: new Date().toISOString(), ...summary }));
    invalidateHome();
    if (summary.checked) logger.info(summary, "Metadata repair pass complete");
    return summary;
  } finally {
    running = false;
    progress = null;
  }
}

export function lastEnrich(): (EnrichSummary & { at: string }) | null {
  const row = db.prepare("SELECT value FROM music_scan_state WHERE key = 'last_enrich'").get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
}

/** Forget every decision so the next pass looks at the whole library again. */
export function resetEnrichment() {
  db.prepare("DELETE FROM music_enrich").run();
}

/** How much of the library is in good shape: for the Library page. */
export function enrichStats() {
  const one = (sql: string) => (db.prepare(sql).get() as any).n as number;
  return {
    tracks: one("SELECT COUNT(*) AS n FROM music_tracks"),
    withArt: one("SELECT COUNT(*) AS n FROM music_tracks t JOIN music_albums al ON al.id = t.album_id WHERE COALESCE(t.art_path, al.art_path) IS NOT NULL"),
    unknownArtist: one(`SELECT COUNT(*) AS n FROM music_tracks t JOIN music_artists a ON a.id = t.artist_id WHERE a.name = '${UNKNOWN_ARTIST}'`),
    pending: one("SELECT COUNT(*) AS n FROM music_tracks t LEFT JOIN music_enrich e ON e.track_id = t.id WHERE e.track_id IS NULL OR e.size <> t.size OR e.mtime <> t.mtime"),
    matched: one("SELECT COUNT(*) AS n FROM music_enrich WHERE status = 'matched'"),
  };
}
