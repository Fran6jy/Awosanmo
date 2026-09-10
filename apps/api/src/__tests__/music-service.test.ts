import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrate } from "../db/schema.js";
import { register } from "../modules/auth/auth.js";
import * as music from "../modules/music/service.js";

let user: string;
let other: string;

/** Seed an artist/album/track trio directly, the way the scanner would. */
function seed(opts: { artist: string; album: string; title: string; genre?: string; trackNo?: number; art?: string; year?: number }) {
  const artistId = (db.prepare(`INSERT INTO music_artists (id, name, sort_name) VALUES (?, ?, ?)
    ON CONFLICT(sort_name) DO UPDATE SET name = excluded.name RETURNING id`).get(crypto.randomUUID(), opts.artist, opts.artist.toLowerCase()) as any).id;
  const albumId = (db.prepare(`INSERT INTO music_albums (id, artist_id, title, sort_title, year, art_path) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(artist_id, sort_title) DO UPDATE SET year = COALESCE(music_albums.year, excluded.year) RETURNING id`)
    .get(crypto.randomUUID(), artistId, opts.album, opts.album.toLowerCase(), opts.year ?? null, opts.art ?? null) as any).id;
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO music_tracks (id, album_id, artist_id, title, track_no, duration, genre, year, path, size, mtime, playable)
    VALUES (?, ?, ?, ?, ?, 200, ?, ?, ?, 1000, 1, 1)`).run(id, albumId, artistId, opts.title, opts.trackNo ?? null, opts.genre ?? null, opts.year ?? null, `/m/${id}.mp3`);
  return { id, albumId, artistId };
}

beforeAll(() => migrate());
beforeEach(async () => {
  for (const t of ["music_likes", "music_plays", "music_playlist_tracks", "music_playlists", "music_tracks", "music_albums", "music_artists", "refresh_tokens", "users"]) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  await register("me@x.com", "password123");
  await register("other@x.com", "password123");
  user = (db.prepare("SELECT id FROM users WHERE email = ?").get("me@x.com") as any).id;
  other = (db.prepare("SELECT id FROM users WHERE email = ?").get("other@x.com") as any).id;
});

describe("library browsing", () => {
  it("returns an album with its tracks in disc/track order", () => {
    const { albumId } = seed({ artist: "Luke Combs", album: "This One's for You", title: "Hurricane", trackNo: 2 });
    seed({ artist: "Luke Combs", album: "This One's for You", title: "Out There", trackNo: 1 });
    const album = music.getAlbum(user, albumId)!;
    expect(album.trackCount).toBe(2);
    expect(album.tracks.map((t) => t.title)).toEqual(["Out There", "Hurricane"]);
    expect(album.tracks[0].artist).toBe("Luke Combs");
  });

  it("groups an artist's albums and exposes top tracks", () => {
    const a = seed({ artist: "Owl City", album: "Ocean Eyes", title: "Fireflies", year: 2009 });
    seed({ artist: "Owl City", album: "All Things Bright", title: "Galaxies", year: 2011 });
    const artist = music.getArtist(user, a.artistId)!;
    expect(artist.albumCount).toBe(2);
    expect(artist.trackCount).toBe(2);
    expect(artist.albums.map((x) => x.title)).toEqual(["All Things Bright", "Ocean Eyes"]); // newest first
    expect(artist.topTracks).toHaveLength(2);
  });

  it("lists genre shelves with counts", () => {
    seed({ artist: "A", album: "X", title: "1", genre: "Country" });
    seed({ artist: "B", album: "Y", title: "2", genre: "Country" });
    seed({ artist: "C", album: "Z", title: "3", genre: "Pop" });
    const genres = music.listGenres();
    expect(genres[0]).toMatchObject({ name: "Country", trackCount: 2 });
    expect(music.getGenre(user, "Pop", { limit: 50, offset: 0 }).total).toBe(1);
  });
});

describe("search", () => {
  it("matches title, artist and album, ranking title-prefix hits first", () => {
    seed({ artist: "Taylor Swift", album: "1989", title: "Style" });
    seed({ artist: "Someone", album: "Styles of Old", title: "Other" });
    seed({ artist: "Harry Styles", album: "Fine Line", title: "Adore You" });
    const r = music.search(user, "Style");
    expect(r.tracks.map((t) => t.title)[0]).toBe("Style");
    expect(r.tracks).toHaveLength(3); // title, album name, artist name all hit
    expect(r.artists.map((a) => a.name)).toEqual(["Harry Styles"]);
    expect(r.albums.map((a) => a.title)).toContain("Styles of Old");
  });

  it("does not treat SQL wildcards in the query as wildcards", () => {
    seed({ artist: "A", album: "X", title: "100% Real" });
    seed({ artist: "A", album: "X", title: "Something Else" });
    expect(music.search(user, "%").tracks.map((t) => t.title)).toEqual(["100% Real"]);
  });
});

describe("plays, likes and home", () => {
  it("records plays and surfaces them as recent and on-repeat", () => {
    const a = seed({ artist: "Eminem", album: "Recovery", title: "Not Afraid" });
    const b = seed({ artist: "Eminem", album: "Recovery", title: "Love the Way You Lie" });
    music.recordPlay(user, a.id); music.recordPlay(user, a.id); music.recordPlay(user, b.id);
    const h = music.home(user);
    expect(h.recent.map((t) => t.id)).toEqual([b.id, a.id]); // most recent first
    expect(h.onRepeat[0].id).toBe(a.id);                    // most played first
  });

  it("keeps likes per user and marks tracks accordingly", () => {
    const a = seed({ artist: "A", album: "X", title: "Song" });
    expect(music.setLiked(user, a.id, true)).toBe(true);
    expect(music.getTrack(user, a.id)!.liked).toBe(true);
    expect(music.getTrack(other, a.id)!.liked).toBe(false);
    expect(music.likedTracks(user, { limit: 10, offset: 0 }).total).toBe(1);
    expect(music.likedTracks(other, { limit: 10, offset: 0 }).total).toBe(0);
    music.setLiked(user, a.id, false);
    expect(music.likedTracks(user, { limit: 10, offset: 0 }).total).toBe(0);
  });

  it("refuses to record a play for a track that does not exist", () => {
    expect(music.recordPlay(user, crypto.randomUUID())).toBe(false);
  });
});

describe("playlists", () => {
  it("creates, fills, reorders by position, and is private to its owner", () => {
    const a = seed({ artist: "A", album: "X", title: "First" });
    const b = seed({ artist: "A", album: "X", title: "Second" });
    const p = music.createPlaylist(user, "Road trip")!;
    expect(music.addToPlaylist(user, p.id, a.id)).toBe(true);
    expect(music.addToPlaylist(user, p.id, b.id)).toBe(true);
    const full = music.getPlaylist(user, p.id)!;
    expect(full.trackCount).toBe(2);
    expect(full.tracks.map((t) => t.title)).toEqual(["First", "Second"]);
    expect(full.tracks.map((t) => t.position)).toEqual([0, 1]);
    // Another user cannot see or modify it.
    expect(music.getPlaylist(other, p.id)).toBeNull();
    expect(music.addToPlaylist(other, p.id, a.id)).toBe(false);
    expect(music.deletePlaylist(other, p.id)).toBe(false);
    // Removal by position.
    expect(music.removeFromPlaylist(user, p.id, 0)).toBe(true);
    expect(music.getPlaylist(user, p.id)!.tracks.map((t) => t.title)).toEqual(["Second"]);
  });

  it("uses the first track's art as the playlist cover", () => {
    const a = seed({ artist: "A", album: "X", title: "Song", art: "aaaa.jpg" });
    const p = music.createPlaylist(user, "Covers")!;
    music.addToPlaylist(user, p.id, a.id);
    expect(music.listPlaylists(user)[0].art).toBe("aaaa.jpg");
  });
});
