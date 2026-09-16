import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrate } from "../db/schema.js";
import { register } from "../modules/auth/auth.js";
import * as music from "../modules/music/service.js";
import { listMixes, listMoods, mixTracks, moodTracks, seededShuffle, timeOfDayMood } from "../modules/music/mixes.js";

let user: string;

function seed(opts: { artist: string; album: string; title: string; genre?: string; f?: { tempo: number; energy: number; brightness: number; dance: number; dynamics?: number } }) {
  const artistId = (db.prepare(`INSERT INTO music_artists (id, name, sort_name) VALUES (?, ?, ?) ON CONFLICT(sort_name) DO UPDATE SET name = excluded.name RETURNING id`)
    .get(crypto.randomUUID(), opts.artist, opts.artist.toLowerCase()) as any).id;
  const albumId = (db.prepare(`INSERT INTO music_albums (id, artist_id, title, sort_title) VALUES (?, ?, ?, ?) ON CONFLICT(artist_id, sort_title) DO UPDATE SET title = excluded.title RETURNING id`)
    .get(crypto.randomUUID(), artistId, opts.album, opts.album.toLowerCase()) as any).id;
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO music_tracks (id, album_id, artist_id, title, duration, genre, path, size, mtime, playable) VALUES (?, ?, ?, ?, 200, ?, ?, 1000, 1, 1)`)
    .run(id, albumId, artistId, opts.title, opts.genre ?? null, `/m/${id}.mp3`);
  if (opts.f) db.prepare(`INSERT INTO music_features (track_id, tempo, energy, brightness, dance, loudness, dynamics, size, mtime, analysed_at) VALUES (?, ?, ?, ?, ?, -14, ?, 1000, 1, 1)`)
    .run(id, opts.f.tempo, opts.f.energy, opts.f.brightness, opts.f.dance, opts.f.dynamics ?? 10);
  return { id, artistId };
}

beforeAll(() => migrate());
beforeEach(async () => {
  for (const t of ["music_mix_state", "music_features", "music_likes", "music_plays", "music_tracks", "music_albums", "music_artists", "refresh_tokens", "users"]) db.prepare(`DELETE FROM ${t}`).run();
  await register("me@x.com", "password123");
  user = (db.prepare("SELECT id FROM users WHERE email = ?").get("me@x.com") as any).id;
});

describe("moods", () => {
  it("buckets analysed tracks and hides moods with too few songs", () => {
    for (let i = 0; i < 6; i += 1) seed({ artist: `H${i}`, album: "X", title: `Banger ${i}`, f: { tempo: 128, energy: 0.8, brightness: 0.4, dance: 0.9 } });
    for (let i = 0; i < 6; i += 1) seed({ artist: `C${i}`, album: "Y", title: `Soft ${i}`, f: { tempo: 80, energy: 0.3, brightness: 0.2, dance: 0.4 } });
    seed({ artist: "N", album: "Z", title: "Not analysed" });
    const moods = listMoods();
    const names = moods.map((m) => m.id);
    expect(names).toContain("hype");
    expect(names).toContain("chill");
    expect(names).not.toContain("calm"); // energy 0.3 is not ≤ 0.25
    const hype = moodTracks(user, "hype")!;
    expect(hype.tracks).toHaveLength(6);
    expect(hype.tracks.every((t) => t.title.startsWith("Banger"))).toBe(true);
    expect(moodTracks(user, "nope")).toBeNull();
  });
});

describe("mixes", () => {
  it("shuffles deterministically per seed", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(seededShuffle(items, "a")).toEqual(seededShuffle(items, "a"));
    expect(seededShuffle(items, "a")).not.toEqual(seededShuffle(items, "b"));
    expect([...seededShuffle(items, "a")].sort((x, y) => x - y)).toEqual(items);
  });

  it("builds daily mixes from the genres you play, mixing familiar artists with unplayed songs", () => {
    const played: string[] = [];
    for (let i = 0; i < 10; i += 1) { const t = seed({ artist: "Fav", album: "A", title: `Fav ${i}`, genre: "Pop" }); if (i < 5) played.push(t.id); }
    for (let i = 0; i < 10; i += 1) seed({ artist: `Other${i}`, album: "B", title: `New ${i}`, genre: "Pop" });
    for (let i = 0; i < 10; i += 1) seed({ artist: "Twang", album: "C", title: `Country ${i}`, genre: "Country" });
    for (const id of played) music.recordPlay(user, id);
    const mixes = listMixes(user);
    const daily = mixes.filter((m) => m.kind === "daily");
    expect(daily[0]).toMatchObject({ name: "Daily Mix 1", blurb: "Pop" });
    const tracks = mixTracks(user, daily[0].id)!.tracks;
    expect(tracks.length).toBeGreaterThanOrEqual(10);
    expect(tracks.some((t) => t.artist === "Fav")).toBe(true);
    expect(tracks.some((t) => t.artist.startsWith("Other"))).toBe(true);
    expect(tracks.every((t) => t.genre === "Pop")).toBe(true);
    // Discover: songs by artists you play that you have never played.
    const discover = mixTracks(user, "discover")!.tracks;
    expect(discover.every((t) => !played.includes(t.id))).toBe(true);
    expect(discover.some((t) => t.artist === "Fav")).toBe(true);
  });

  it("names the time of day sensibly", () => {
    expect(timeOfDayMood(8).moodId).toBe("feelgood");
    expect(timeOfDayMood(21).moodId).toBe("chill");
    expect(timeOfDayMood(2).moodId).toBe("latenight");
  });
});

describe("re-deal and skips", () => {
  it("changes the hand on refresh and keeps a skipped song out", async () => {
    const { refreshMix, skipInMix } = await import("../modules/music/mixes.js");
    for (let i = 0; i < 30; i += 1) seed({ artist: `H${i}`, album: "X", title: `Banger ${i}`, f: { tempo: 128, energy: 0.8, brightness: 0.4, dance: 0.9 } });
    const before = moodTracks(user, "hype", 10)!.tracks.map((t) => t.id);
    expect(moodTracks(user, "hype", 10)!.tracks.map((t) => t.id)).toEqual(before); // stable within the day
    refreshMix(user, "hype");
    const after = moodTracks(user, "hype", 10)!.tracks.map((t) => t.id);
    expect(after).not.toEqual(before);
    skipInMix(user, "hype", after[0]);
    expect(moodTracks(user, "hype", 10)!.tracks.map((t) => t.id)).not.toContain(after[0]);
  });
});
