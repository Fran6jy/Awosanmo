import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrate } from "../db/schema.js";
import { register } from "../modules/auth/auth.js";
import { forgottenFavourites, getSettings, onThisDay, similarTracks, updateSettings, weekStart, wrapped } from "../modules/music/stats.js";

let user: string;
const DAY = 86_400_000;

function seed(opts: { artist: string; album: string; title: string; genre?: string; duration?: number; f?: { tempo: number; energy: number; brightness: number; dance: number } }) {
  const artistId = (db.prepare(`INSERT INTO music_artists (id, name, sort_name) VALUES (?, ?, ?) ON CONFLICT(sort_name) DO UPDATE SET name = excluded.name RETURNING id`).get(crypto.randomUUID(), opts.artist, opts.artist.toLowerCase()) as any).id;
  const albumId = (db.prepare(`INSERT INTO music_albums (id, artist_id, title, sort_title) VALUES (?, ?, ?, ?) ON CONFLICT(artist_id, sort_title) DO UPDATE SET title = excluded.title RETURNING id`).get(crypto.randomUUID(), artistId, opts.album, opts.album.toLowerCase()) as any).id;
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO music_tracks (id, album_id, artist_id, title, duration, genre, path, size, mtime, playable) VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 1, 1)`).run(id, albumId, artistId, opts.title, opts.duration ?? 180, opts.genre ?? null, `/m/${id}.mp3`);
  if (opts.f) db.prepare(`INSERT INTO music_features (track_id, tempo, energy, brightness, dance, loudness, dynamics, size, mtime, analysed_at) VALUES (?, ?, ?, ?, ?, -14, 10, 1000, 1, 1)`).run(id, opts.f.tempo, opts.f.energy, opts.f.brightness, opts.f.dance);
  return { id, albumId, artistId };
}
const playAt = (trackId: string, when: number) => db.prepare("INSERT INTO music_plays (user_id, track_id, played_at) VALUES (?, ?, ?)").run(user, trackId, when);

beforeAll(() => migrate());
beforeEach(async () => {
  for (const t of ["music_settings", "music_features", "music_likes", "music_plays", "music_tracks", "music_albums", "music_artists", "refresh_tokens", "users"]) db.prepare(`DELETE FROM ${t}`).run();
  await register("me@x.com", "password123");
  user = (db.prepare("SELECT id FROM users WHERE email = ?").get("me@x.com") as any).id;
});

describe("weekly wrapped", () => {
  it("names the song, album and artist of the week and counts the week only", () => {
    const now = Date.now();
    const a1 = seed({ artist: "Eminem", album: "Recovery", title: "Not Afraid", genre: "Hip-Hop & R&B", duration: 240 });
    const a2 = seed({ artist: "Eminem", album: "Recovery", title: "Love the Way You Lie", genre: "Hip-Hop & R&B", duration: 240 });
    seed({ artist: "Eminem", album: "Recovery", title: "Cinderella Man", genre: "Hip-Hop & R&B" });
    const b = seed({ artist: "Adele", album: "25", title: "Hello", genre: "Pop", duration: 300 });
    // Seconds apart, not hours: the test must pass just after midnight on a Monday too.
    for (let i = 0; i < 4; i += 1) playAt(a1.id, now - i * 1000);
    playAt(a2.id, now - 5000);
    playAt(b.id, now - 6000);
    playAt(b.id, now - 20 * DAY); // last week or earlier: not this week
    const w = wrapped(user, 0);
    expect(w.plays).toBe(6);
    expect(w.minutes).toBe(Math.round((4 * 240 + 240 + 300) / 60));
    expect(w.songOfWeek?.title).toBe("Not Afraid");
    expect(w.songOfWeek?.plays).toBe(4);
    expect(w.albumOfWeek?.title).toBe("Recovery");
    expect(w.artistOfWeek?.name).toBe("Eminem");
    expect(w.topGenre).toMatchObject({ name: "Hip-Hop & R&B", plays: 5 });
    expect(w.discoveries.map((t) => t.title)).toContain("Not Afraid");
    expect(w.discoveries.map((t) => t.title)).not.toContain("Hello"); // first played before this week
    expect(w.streakDays).toBeGreaterThanOrEqual(1);
    expect(w.byHour.reduce((s, n) => s + n, 0)).toBe(6);
  });

  it("starts weeks on Monday and offsets whole weeks", () => {
    const monday = new Date(2026, 8, 14, 15, 30); // Mon 14 Sep 2026
    expect(new Date(weekStart(0, monday)).getDay()).toBe(1);
    expect(weekStart(1, monday)).toBe(weekStart(0, monday) - 7 * DAY);
    const sunday = new Date(2026, 8, 20, 3, 0);
    expect(weekStart(0, sunday)).toBe(weekStart(0, monday));
    // A listener an hour ahead of UTC (BST, offset -60) starts the week an hour earlier in UTC terms.
    const utcMonday = new Date(Date.UTC(2026, 8, 21, 0, 30)); // 00:30 UTC Mon = 01:30 BST Mon
    expect(weekStart(0, utcMonday, -60)).toBe(Date.UTC(2026, 8, 20, 23, 0));
    // …and 00:30 BST on Monday (23:30 UTC Sunday) already belongs to the new week for them.
    expect(weekStart(0, new Date(Date.UTC(2026, 8, 20, 23, 30)), -60)).toBe(Date.UTC(2026, 8, 20, 23, 0));
    expect(weekStart(0, new Date(Date.UTC(2026, 8, 20, 22, 30)), -60)).toBe(Date.UTC(2026, 8, 13, 23, 0));
  });
});

describe("forgotten favourites and on this day", () => {
  it("surfaces songs played a lot months ago and not since", () => {
    const now = Date.now();
    const old = seed({ artist: "A", album: "X", title: "Old flame" });
    const recent = seed({ artist: "A", album: "X", title: "Still spinning" });
    for (let i = 0; i < 4; i += 1) { playAt(old.id, now - (60 + i) * DAY); playAt(recent.id, now - (60 + i) * DAY); }
    playAt(recent.id, now - 2 * DAY);
    expect(forgottenFavourites(user).map((t) => t.title)).toEqual(["Old flame"]);
  });

  it("finds what was playing a year ago this week", () => {
    const now = Date.now();
    const ids = [1, 2, 3].map((i) => seed({ artist: "B", album: "Y", title: `Then ${i}` }).id);
    for (const id of ids) playAt(id, now - 365 * DAY + DAY);
    const r = onThisDay(user)!;
    expect(r.yearsAgo).toBe(1);
    expect(r.tracks).toHaveLength(3);
    expect(onThisDay(user, 12)).not.toBeNull();
  });
});

describe("song radio", () => {
  it("returns the nearest-sounding tracks with an artist cap", () => {
    const seedTrack = seed({ artist: "S", album: "X", title: "Seed", genre: "Pop", f: { tempo: 120, energy: 0.7, brightness: 0.5, dance: 0.8 } });
    for (let i = 0; i < 6; i += 1) seed({ artist: "Same", album: "Z", title: `Clone ${i}`, genre: "Pop", f: { tempo: 121, energy: 0.7, brightness: 0.5, dance: 0.8 } });
    seed({ artist: "Near", album: "N", title: "Close", genre: "Pop", f: { tempo: 118, energy: 0.65, brightness: 0.45, dance: 0.75 } });
    seed({ artist: "Far", album: "F", title: "Slow ballad", genre: "Pop", f: { tempo: 70, energy: 0.2, brightness: 0.1, dance: 0.2 } });
    const r = similarTracks(user, seedTrack.id, 10);
    expect(r.map((t) => t.title)).not.toContain("Seed");
    expect(r.filter((t) => t.artist === "Same")).toHaveLength(3);
    expect(r.map((t) => t.title).indexOf("Close")).toBeLessThan(r.map((t) => t.title).indexOf("Slow ballad"));
  });
});

describe("settings", () => {
  it("merges patches per user", () => {
    expect(getSettings(user)).toEqual({});
    updateSettings(user, { crossfade: 6 });
    updateSettings(user, { volume: 0.7 });
    expect(getSettings(user)).toEqual({ crossfade: 6, volume: 0.7 });
  });
});
