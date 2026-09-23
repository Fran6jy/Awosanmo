import { db } from "../../db/schema.js";
import { toView, TRACK_SELECT, type TrackView } from "./service.js";

/**
 * Listening statistics: the weekly "Wrapped", forgotten favourites, on this
 * day, and the nearest-neighbour "song radio". All of it comes from
 * music_plays (one row per counted play) and music_features.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/**
 * Monday 00:00 of the week `offset` weeks ago (0 = this week), in the
 * listener's timezone. `tzOffsetMin` is what the browser's
 * Date#getTimezoneOffset returns (minutes *behind* UTC, so BST is -60);
 * the server runs in UTC, so without it weeks would roll over an hour late
 * for someone in London and the card would say "14 Sep – 21 Sep".
 */
export function weekStart(offset = 0, now = new Date(), tzOffsetMin = new Date().getTimezoneOffset()): number {
  const shift = -tzOffsetMin * 60_000;
  const d = new Date(now.getTime() + shift); // wall-clock time, read with UTC getters
  d.setUTCHours(0, 0, 0, 0);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow - offset * 7);
  return d.getTime() - shift;
}

function likedSet(userId: string, ids: string[]): Set<string> {
  if (!ids.length) return new Set();
  const marks = ids.map(() => "?").join(",");
  return new Set((db.prepare(`SELECT track_id FROM music_likes WHERE user_id = ? AND track_id IN (${marks})`).all(userId, ...ids) as any[]).map((r) => r.track_id));
}
function views(userId: string, rows: any[]): TrackView[] {
  const liked = likedSet(userId, rows.map((r) => r.id));
  return rows.map((r) => toView(r, liked));
}

export type WrappedView = {
  from: number; to: number; weekOffset: number;
  plays: number; minutes: number; distinctTracks: number; distinctArtists: number;
  lastWeek: { plays: number; minutes: number };
  songOfWeek: (TrackView & { plays: number }) | null;
  topSongs: (TrackView & { plays: number })[];
  albumOfWeek: { id: string; title: string; artist: string; art: string | null; plays: number } | null;
  artistOfWeek: { id: string; name: string; image: string | null; art: string | null; plays: number; minutes: number } | null;
  topArtists: { id: string; name: string; image: string | null; art: string | null; plays: number }[];
  topGenre: { name: string; plays: number; share: number } | null;
  mood: { label: string; blurb: string; tempo: number; energy: number } | null;
  byHour: number[];   // 24 buckets of plays
  byDay: number[];    // Mon..Sun plays
  discoveries: TrackView[]; // first ever played this week
  streakDays: number;
  firstWeekWithPlays: number | null;
};

function moodLabel(tempo: number, energy: number, dance: number, brightness: number): { label: string; blurb: string } {
  if (energy >= 0.62 && tempo >= 118) return { label: "Full throttle", blurb: "Fast, loud and relentless" };
  if (dance >= 0.75 && energy >= 0.5) return { label: "In the groove", blurb: "You could not sit still" };
  if (energy <= 0.4 && tempo <= 100) return { label: "Low and slow", blurb: "A week of easy listening" };
  if (brightness >= 0.4 && energy >= 0.45) return { label: "Sunny side", blurb: "Bright and warm" };
  if (energy <= 0.45 && brightness <= 0.3) return { label: "After dark", blurb: "Late-night energy" };
  return { label: "Balanced", blurb: "A bit of everything" };
}

export function wrapped(userId: string, weekOffset = 0, tzOffsetMin = new Date().getTimezoneOffset()): WrappedView {
  const from = weekStart(weekOffset, new Date(), tzOffsetMin);
  const shift = -tzOffsetMin * 60_000;
  const to = from + WEEK;
  const prevFrom = from - WEEK;
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;

  const totals = one(`SELECT COUNT(*) AS plays, COALESCE(SUM(t.duration), 0) / 60.0 AS minutes, COUNT(DISTINCT p.track_id) AS tracks, COUNT(DISTINCT t.artist_id) AS artists
    FROM music_plays p JOIN music_tracks t ON t.id = p.track_id WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ?`, userId, from, to);
  const prev = one(`SELECT COUNT(*) AS plays, COALESCE(SUM(t.duration), 0) / 60.0 AS minutes FROM music_plays p JOIN music_tracks t ON t.id = p.track_id
    WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ?`, userId, prevFrom, from);

  const counts = db.prepare(`SELECT track_id, COUNT(*) AS plays FROM music_plays WHERE user_id = ? AND played_at >= ? AND played_at < ?
    GROUP BY track_id ORDER BY plays DESC, MAX(played_at) DESC LIMIT 10`).all(userId, from, to) as { track_id: string; plays: number }[];
  const byId = new Map(counts.map((c) => [c.track_id, c.plays]));
  const topRows = counts.length ? db.prepare(`${TRACK_SELECT} WHERE t.id IN (${counts.map(() => "?").join(",")})`).all(...counts.map((c) => c.track_id)) as any[] : [];
  const topSongs = views(userId, topRows).map((v) => ({ ...v, plays: byId.get(v.id) ?? 0 })).sort((a, b) => b.plays - a.plays);

  const album = one(`SELECT al.id, al.title, a.name AS artist, al.art_path AS art, COUNT(*) AS plays
    FROM music_plays p JOIN music_tracks t ON t.id = p.track_id JOIN music_albums al ON al.id = t.album_id JOIN music_artists a ON a.id = al.artist_id
    WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ?
      AND (SELECT COUNT(*) FROM music_tracks x WHERE x.album_id = al.id) >= 3
    GROUP BY al.id ORDER BY plays DESC, COUNT(DISTINCT t.id) DESC LIMIT 1`, userId, from, to);

  const artists = db.prepare(`SELECT a.id, a.name, a.image_path AS image, COUNT(*) AS plays, COALESCE(SUM(t.duration), 0) / 60.0 AS minutes,
      (SELECT COALESCE(t2.art_path, al2.art_path) FROM music_tracks t2 JOIN music_albums al2 ON al2.id = t2.album_id WHERE t2.artist_id = a.id AND COALESCE(t2.art_path, al2.art_path) IS NOT NULL LIMIT 1) AS art
    FROM music_plays p JOIN music_tracks t ON t.id = p.track_id JOIN music_artists a ON a.id = t.artist_id
    WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ? AND a.name <> 'Unknown Artist'
    GROUP BY a.id ORDER BY plays DESC LIMIT 5`).all(userId, from, to) as any[];

  const genre = one(`SELECT t.genre AS name, COUNT(*) AS plays FROM music_plays p JOIN music_tracks t ON t.id = p.track_id
    WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ? AND t.genre IS NOT NULL GROUP BY t.genre ORDER BY plays DESC LIMIT 1`, userId, from, to);

  const feat = one(`SELECT AVG(f.tempo) AS tempo, AVG(f.energy) AS energy, AVG(f.dance) AS dance, AVG(f.brightness) AS brightness, COUNT(*) AS n
    FROM music_plays p JOIN music_features f ON f.track_id = p.track_id WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ? AND f.tempo IS NOT NULL`, userId, from, to);

  const byHour = new Array(24).fill(0), byDay = new Array(7).fill(0);
  for (const r of db.prepare("SELECT played_at FROM music_plays WHERE user_id = ? AND played_at >= ? AND played_at < ?").all(userId, from, to) as any[]) {
    const d = new Date(r.played_at + shift);
    byHour[d.getUTCHours()] += 1;
    byDay[(d.getUTCDay() + 6) % 7] += 1;
  }

  const discRows = db.prepare(`${TRACK_SELECT}
    JOIN (SELECT track_id, MIN(played_at) AS first FROM music_plays WHERE user_id = ? GROUP BY track_id HAVING first >= ? AND first < ? ORDER BY first DESC LIMIT 12) p ON p.track_id = t.id
    ORDER BY p.first DESC`).all(userId, from, to) as any[];

  // Streak: consecutive days with at least one play, ending today (or yesterday).
  const days = new Set((db.prepare("SELECT DISTINCT CAST((played_at + ?) / ? AS INTEGER) AS d FROM music_plays WHERE user_id = ? AND played_at > ?")
    .all(shift, DAY, userId, Date.now() - 400 * DAY) as any[]).map((r) => r.d as number));
  const today = Math.floor((Date.now() + shift) / DAY);
  let streak = 0, cursor = days.has(today) ? today : today - 1;
  while (days.has(cursor)) { streak += 1; cursor -= 1; }

  const first = one("SELECT MIN(played_at) AS t FROM music_plays WHERE user_id = ?", userId);

  return {
    from, to, weekOffset,
    plays: totals.plays, minutes: Math.round(totals.minutes), distinctTracks: totals.tracks, distinctArtists: totals.artists,
    lastWeek: { plays: prev.plays, minutes: Math.round(prev.minutes) },
    songOfWeek: topSongs[0] ?? null,
    topSongs: topSongs.slice(0, 5),
    albumOfWeek: album ? { id: album.id, title: album.title, artist: album.artist, art: album.art, plays: album.plays } : null,
    artistOfWeek: artists[0] ? { id: artists[0].id, name: artists[0].name, image: artists[0].image, art: artists[0].art, plays: artists[0].plays, minutes: Math.round(artists[0].minutes) } : null,
    topArtists: artists.map((a) => ({ id: a.id, name: a.name, image: a.image, art: a.art, plays: a.plays })),
    topGenre: genre ? { name: genre.name, plays: genre.plays, share: totals.plays ? Math.round((genre.plays / totals.plays) * 100) : 0 } : null,
    mood: feat?.n >= 3 ? { ...moodLabel(feat.tempo, feat.energy, feat.dance, feat.brightness), tempo: Math.round(feat.tempo), energy: Math.round(feat.energy * 100) / 100 } : null,
    byHour, byDay,
    discoveries: views(userId, discRows),
    streakDays: streak,
    firstWeekWithPlays: first?.t ? weekStart(0, new Date(first.t), tzOffsetMin) : null,
  };
}

/** Songs you played a lot 1–6 months ago and have not touched in the last month. */
export function forgottenFavourites(userId: string, limit = 12): TrackView[] {
  const now = Date.now();
  const rows = db.prepare(`${TRACK_SELECT}
    JOIN (SELECT track_id, COUNT(*) AS plays FROM music_plays WHERE user_id = ? AND played_at BETWEEN ? AND ? GROUP BY track_id HAVING plays >= 3) old ON old.track_id = t.id
    WHERE t.playable = 1 AND t.id NOT IN (SELECT track_id FROM music_plays WHERE user_id = ? AND played_at > ?)
    ORDER BY old.plays DESC, RANDOM() LIMIT ?`).all(userId, now - 180 * DAY, now - 30 * DAY, userId, now - 30 * DAY, limit) as any[];
  return views(userId, rows);
}

// ---------- year in music ----------

export type YearView = {
  year: number;
  from: number; to: number;
  plays: number; minutes: number; distinctTracks: number; distinctArtists: number; distinctAlbums: number;
  daysListened: number; daysInYear: number; longestStreak: number;
  lastYear: { plays: number; minutes: number } | null;
  topSongs: (TrackView & { plays: number })[];
  topArtists: { id: string; name: string; image: string | null; art: string | null; plays: number; minutes: number }[];
  topAlbums: { id: string; title: string; artist: string; art: string | null; plays: number }[];
  topGenres: { name: string; plays: number; share: number }[];
  /** Plays per month, Jan..Dec, and the busiest month/day. */
  byMonth: number[];
  bigMonth: { month: number; plays: number } | null;
  bigDay: { at: number; plays: number } | null;
  firstPlay: (TrackView & { at: number }) | null;
  /** Found this year, then played most. */
  discovery: (TrackView & { plays: number; at: number }) | null;
  newToYou: number;
  mood: { label: string; blurb: string; tempo: number; energy: number } | null;
  /** Years that have at least one play, newest first — what the page can page through. */
  yearsWithPlays: number[];
};

/** 00:00 on 1 January of `year`, in the listener's timezone. */
function yearStart(year: number, tzOffsetMin: number): number {
  return Date.UTC(year, 0, 1) + tzOffsetMin * 60_000;
}

export function yearInMusic(userId: string, year?: number, tzOffsetMin = new Date().getTimezoneOffset()): YearView {
  const shift = -tzOffsetMin * 60_000;
  const nowYear = new Date(Date.now() + shift).getUTCFullYear();
  const y = year ?? nowYear;
  const from = yearStart(y, tzOffsetMin);
  const to = yearStart(y + 1, tzOffsetMin);
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;

  const totals = one(`SELECT COUNT(*) AS plays, COALESCE(SUM(t.duration), 0) / 60.0 AS minutes, COUNT(DISTINCT p.track_id) AS tracks,
      COUNT(DISTINCT t.artist_id) AS artists, COUNT(DISTINCT t.album_id) AS albums
    FROM music_plays p JOIN music_tracks t ON t.id = p.track_id WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ?`, userId, from, to);
  const prevFrom = yearStart(y - 1, tzOffsetMin);
  const prevRow = one(`SELECT COUNT(*) AS plays, COALESCE(SUM(t.duration), 0) / 60.0 AS minutes FROM music_plays p JOIN music_tracks t ON t.id = p.track_id
    WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ?`, userId, prevFrom, from);

  const counts = db.prepare(`SELECT track_id, COUNT(*) AS plays FROM music_plays WHERE user_id = ? AND played_at >= ? AND played_at < ?
    GROUP BY track_id ORDER BY plays DESC, MAX(played_at) DESC LIMIT 10`).all(userId, from, to) as { track_id: string; plays: number }[];
  const byId = new Map(counts.map((c) => [c.track_id, c.plays]));
  const topRows = counts.length ? db.prepare(`${TRACK_SELECT} WHERE t.id IN (${counts.map(() => "?").join(",")})`).all(...counts.map((c) => c.track_id)) as any[] : [];
  const topSongs = views(userId, topRows).map((v) => ({ ...v, plays: byId.get(v.id) ?? 0 })).sort((a, b) => b.plays - a.plays);

  const topArtists = (db.prepare(`SELECT a.id, a.name, a.image_path AS image, COUNT(*) AS plays, COALESCE(SUM(t.duration), 0) / 60.0 AS minutes,
      (SELECT COALESCE(t2.art_path, al2.art_path) FROM music_tracks t2 JOIN music_albums al2 ON al2.id = t2.album_id WHERE t2.artist_id = a.id AND COALESCE(t2.art_path, al2.art_path) IS NOT NULL LIMIT 1) AS art
    FROM music_plays p JOIN music_tracks t ON t.id = p.track_id JOIN music_artists a ON a.id = t.artist_id
    WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ? AND a.name <> 'Unknown Artist'
    GROUP BY a.id ORDER BY plays DESC LIMIT 5`).all(userId, from, to) as any[])
    .map((a) => ({ id: a.id, name: a.name, image: a.image, art: a.art, plays: a.plays, minutes: Math.round(a.minutes) }));

  const topAlbums = (db.prepare(`SELECT al.id, al.title, a.name AS artist, al.art_path AS art, COUNT(*) AS plays
    FROM music_plays p JOIN music_tracks t ON t.id = p.track_id JOIN music_albums al ON al.id = t.album_id JOIN music_artists a ON a.id = al.artist_id
    WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ?
      AND (SELECT COUNT(*) FROM music_tracks x WHERE x.album_id = al.id) >= 3
    GROUP BY al.id ORDER BY plays DESC, COUNT(DISTINCT t.id) DESC LIMIT 5`).all(userId, from, to) as any[])
    .map((x) => ({ id: x.id, title: x.title, artist: x.artist, art: x.art, plays: x.plays }));

  const genreRows = db.prepare(`SELECT t.genre AS name, COUNT(*) AS plays FROM music_plays p JOIN music_tracks t ON t.id = p.track_id
    WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ? AND t.genre IS NOT NULL GROUP BY t.genre ORDER BY plays DESC LIMIT 5`).all(userId, from, to) as any[];
  const topGenres = genreRows.map((g) => ({ name: g.name, plays: g.plays, share: totals.plays ? Math.round((g.plays / totals.plays) * 100) : 0 }));

  // Months, days listened and the longest streak, all on the listener's calendar.
  const byMonth = Array.from({ length: 12 }, () => 0);
  const perDay = new Map<number, number>();
  for (const r of db.prepare("SELECT played_at FROM music_plays WHERE user_id = ? AND played_at >= ? AND played_at < ?").all(userId, from, to) as any[]) {
    const d = new Date(r.played_at + shift);
    byMonth[d.getUTCMonth()] += 1;
    const day = Math.floor((r.played_at + shift) / DAY);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const bigMonthIdx = byMonth.reduce((best, n, i) => (n > byMonth[best] ? i : best), 0);
  let bigDay: { at: number; plays: number } | null = null;
  let longestStreak = 0, run = 0, prevDay: number | null = null;
  for (const day of [...perDay.keys()].sort((a, b) => a - b)) {
    const n = perDay.get(day)!;
    if (!bigDay || n > bigDay.plays) bigDay = { at: day * DAY - shift, plays: n };
    run = prevDay !== null && day === prevDay + 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    prevDay = day;
  }

  // The first thing you played all year.
  const firstAt = one("SELECT played_at AS at, track_id FROM music_plays WHERE user_id = ? AND played_at >= ? AND played_at < ? ORDER BY played_at ASC LIMIT 1", userId, from, to);
  const firstTrackRow = firstAt?.track_id ? one(`${TRACK_SELECT} WHERE t.id = ?`, firstAt.track_id) : null;
  const firstPlay = firstTrackRow ? { ...views(userId, [firstTrackRow])[0], at: firstAt.at as number } : null;

  // Discovery: first ever heard this year, then played the most since.
  const discRows = db.prepare(`SELECT p.track_id, p.first AS at, COUNT(p2.id) AS plays
    FROM (SELECT track_id, MIN(played_at) AS first FROM music_plays WHERE user_id = ? GROUP BY track_id HAVING first >= ? AND first < ?) p
    JOIN music_plays p2 ON p2.track_id = p.track_id AND p2.user_id = ?
    GROUP BY p.track_id ORDER BY plays DESC, at ASC LIMIT 1`).all(userId, from, to, userId) as any[];
  const newToYou = (one("SELECT COUNT(*) AS n FROM (SELECT track_id, MIN(played_at) AS first FROM music_plays WHERE user_id = ? GROUP BY track_id HAVING first >= ? AND first < ?)", userId, from, to)?.n ?? 0) as number;
  let discovery: (TrackView & { plays: number; at: number }) | null = null;
  if (discRows[0]) {
    const row = one(`${TRACK_SELECT} WHERE t.id = ?`, discRows[0].track_id);
    if (row) discovery = { ...views(userId, [row])[0], plays: discRows[0].plays, at: discRows[0].at };
  }

  const feat = one(`SELECT AVG(fx.tempo) AS tempo, AVG(fx.energy) AS energy, AVG(fx.dance) AS dance, AVG(fx.brightness) AS brightness, COUNT(*) AS n
    FROM music_plays p JOIN music_features fx ON fx.track_id = p.track_id WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ?`, userId, from, to);

  const yearsWithPlays = (db.prepare("SELECT DISTINCT CAST(strftime('%Y', (played_at + ?) / 1000, 'unixepoch') AS INTEGER) AS y FROM music_plays WHERE user_id = ? ORDER BY y DESC")
    .all(shift, userId) as any[]).map((r) => r.y as number);

  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return {
    year: y, from, to,
    plays: totals.plays, minutes: Math.round(totals.minutes), distinctTracks: totals.tracks, distinctArtists: totals.artists, distinctAlbums: totals.albums,
    daysListened: perDay.size, daysInYear: isLeap ? 366 : 365, longestStreak,
    lastYear: prevRow.plays ? { plays: prevRow.plays, minutes: Math.round(prevRow.minutes) } : null,
    topSongs: topSongs.slice(0, 5),
    topArtists, topAlbums, topGenres,
    byMonth,
    bigMonth: byMonth[bigMonthIdx] ? { month: bigMonthIdx, plays: byMonth[bigMonthIdx] } : null,
    bigDay,
    firstPlay,
    discovery, newToYou,
    mood: feat?.n >= 3 ? { ...moodLabel(feat.tempo, feat.energy, feat.dance, feat.brightness), tempo: Math.round(feat.tempo), energy: Math.round(feat.energy * 100) / 100 } : null,
    yearsWithPlays,
  };
}

/** What you were playing a year ago this week (or the same week two, three years back). */
export function onThisDay(userId: string, limit = 12): { yearsAgo: number; tracks: TrackView[] } | null {
  for (const years of [1, 2, 3]) {
    const centre = Date.now() - years * 365 * DAY;
    const rows = db.prepare(`${TRACK_SELECT}
      JOIN (SELECT track_id, COUNT(*) AS plays FROM music_plays WHERE user_id = ? AND played_at BETWEEN ? AND ? GROUP BY track_id ORDER BY plays DESC LIMIT ?) p ON p.track_id = t.id
      WHERE t.playable = 1 ORDER BY p.plays DESC`).all(userId, centre - 4 * DAY, centre + 4 * DAY, limit) as any[];
    if (rows.length >= 3) return { yearsAgo: years, tracks: views(userId, rows) };
  }
  return null;
}

/**
 * Song radio: the tracks whose measured sound sits nearest to this one, with a
 * nudge for the same genre and a cap so one artist does not take over.
 */
export function similarTracks(userId: string, trackId: string, limit = 50): TrackView[] {
  const seed = db.prepare("SELECT t.artist_id, t.genre, f.tempo, f.energy, f.brightness, f.dance FROM music_tracks t LEFT JOIN music_features f ON f.track_id = t.id WHERE t.id = ?").get(trackId) as any;
  if (!seed) return [];
  let rows: any[];
  if (seed.tempo) {
    rows = db.prepare(`${TRACK_SELECT} JOIN music_features f ON f.track_id = t.id
      WHERE t.playable = 1 AND f.tempo IS NOT NULL AND t.id <> ?
      ORDER BY (ABS(f.tempo - ?) / 40.0 + ABS(f.energy - ?) * 2.5 + ABS(f.brightness - ?) * 1.5 + ABS(f.dance - ?) * 1.2 + CASE WHEN t.genre IS ? THEN 0 ELSE 0.35 END)
      LIMIT ?`).all(trackId, seed.tempo, seed.energy, seed.brightness, seed.dance, seed.genre, limit * 3) as any[];
  } else {
    rows = db.prepare(`${TRACK_SELECT} WHERE t.playable = 1 AND t.id <> ? AND (t.genre IS ? OR t.artist_id = ?) ORDER BY RANDOM() LIMIT ?`).all(trackId, seed.genre, seed.artist_id, limit * 3) as any[];
  }
  // No artist more than three times, and the seed's own artist only twice: radio, not an album.
  const perArtist = new Map<string, number>();
  const out: any[] = [];
  for (const r of rows) {
    const n = perArtist.get(r.artist_id) ?? 0;
    const cap = r.artist_id === seed.artist_id ? 2 : 3;
    if (n >= cap) continue;
    perArtist.set(r.artist_id, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return views(userId, out);
}

// ---------- per-user settings ----------

export type Settings = Record<string, unknown>;

export function getSettings(userId: string): Settings {
  const row = db.prepare("SELECT data FROM music_settings WHERE user_id = ?").get(userId) as any;
  try { return row ? JSON.parse(row.data) : {}; } catch { return {}; }
}

export function updateSettings(userId: string, patch: Settings): Settings {
  const merged = { ...getSettings(userId), ...patch };
  db.prepare(`INSERT INTO music_settings (user_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(userId, JSON.stringify(merged), Date.now());
  return merged;
}
