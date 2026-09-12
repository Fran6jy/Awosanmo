import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrate } from "../db/schema.js";
import { register } from "../modules/auth/auth.js";
import * as music from "../modules/music/service.js";
import * as shares from "../modules/music/shares.js";

let user: string;
let other: string;

function seed(opts: { artist: string; album: string; title: string; art?: string }) {
  const artistId = (db.prepare(`INSERT INTO music_artists (id, name, sort_name) VALUES (?, ?, ?)
    ON CONFLICT(sort_name) DO UPDATE SET name = excluded.name RETURNING id`).get(crypto.randomUUID(), opts.artist, opts.artist.toLowerCase()) as any).id;
  const albumId = (db.prepare(`INSERT INTO music_albums (id, artist_id, title, sort_title, art_path) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(artist_id, sort_title) DO UPDATE SET title = excluded.title RETURNING id`)
    .get(crypto.randomUUID(), artistId, opts.album, opts.album.toLowerCase(), opts.art ?? null) as any).id;
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO music_tracks (id, album_id, artist_id, title, duration, path, size, mtime, playable) VALUES (?, ?, ?, ?, 200, ?, 1000, 1, 1)`)
    .run(id, albumId, artistId, opts.title, `/m/${id}.mp3`);
  return { id, albumId, artistId };
}

beforeAll(() => migrate());
beforeEach(async () => {
  for (const t of ["music_shares", "music_playlist_tracks", "music_playlists", "music_tracks", "music_albums", "music_artists", "refresh_tokens", "users"]) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  await register("me@x.com", "password123");
  await register("other@x.com", "password123");
  user = (db.prepare("SELECT id FROM users WHERE email = ?").get("me@x.com") as any).id;
  other = (db.prepare("SELECT id FROM users WHERE email = ?").get("other@x.com") as any).id;
});

describe("share links", () => {
  it("shares an album: anyone with the slug sees its tracks in order and may stream them", () => {
    const a = seed({ artist: "Owl City", album: "Ocean Eyes", title: "Fireflies", art: "aa.jpg" });
    seed({ artist: "Owl City", album: "Ocean Eyes", title: "Vanilla Twilight" });
    const share = shares.createShare(user, "album", a.albumId)!;
    expect(share.id).toMatch(/^[A-Za-z0-9]{9}$/);
    expect(share).toMatchObject({ kind: "album", title: "Ocean Eyes", subtitle: "Owl City", art: "aa.jpg", trackCount: 2, allowDownload: true, expiresAt: null });

    const page = shares.openShare(share.id)!;
    expect(page.sharedBy).toBe("me");
    expect(page.tracks.map((t) => t.title)).toEqual(["Fireflies", "Vanilla Twilight"]);
    expect(page.tracks[0]).not.toHaveProperty("liked"); // nothing personal leaks
    expect(shares.shareGrants(share.id, a.id)).toBe(true);
    expect(shares.listShares(user)[0].views).toBe(1);
  });

  it("only grants tracks that belong to the share", () => {
    const a = seed({ artist: "A", album: "X", title: "In" });
    const b = seed({ artist: "B", album: "Y", title: "Out" });
    const share = shares.createShare(user, "track", a.id)!;
    expect(shares.shareGrants(share.id, a.id)).toBe(true);
    expect(shares.shareGrants(share.id, b.id)).toBe(false);
    expect(shares.shareGrants("nope12345", a.id)).toBe(false);
  });

  it("honours the no-download setting for single files and the zip", () => {
    const a = seed({ artist: "A", album: "X", title: "Song" });
    const share = shares.createShare(user, "track", a.id, { allowDownload: false })!;
    expect(shares.shareGrants(share.id, a.id)).toBe(true);
    expect(shares.shareGrants(share.id, a.id, { download: true })).toBe(false);
    expect(shares.shareDownloadSet(share.id)).toBeNull();
    const open = shares.createShare(user, "track", a.id)!;
    expect(shares.shareDownloadSet(open.id)?.tracks.map((t) => t.title)).toEqual(["Song"]);
  });

  it("expires and can be revoked by its owner only", () => {
    const a = seed({ artist: "A", album: "X", title: "Song" });
    const share = shares.createShare(user, "track", a.id, { expiresInDays: 7 })!;
    expect(share.expiresAt).toBeGreaterThan(Date.now());
    db.prepare("UPDATE music_shares SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, share.id);
    expect(shares.openShare(share.id)).toBeNull();

    const live = shares.createShare(user, "track", a.id)!;
    expect(shares.revokeShare(other, live.id)).toBe(false);
    expect(shares.openShare(live.id)).not.toBeNull();
    expect(shares.revokeShare(user, live.id)).toBe(true);
    expect(shares.openShare(live.id)).toBeNull();
    expect(shares.shareGrants(live.id, a.id)).toBe(false);
    // The expired link still shows in the owner's list (so it can be cleaned up); the revoked one is gone.
    expect(shares.listShares(user).map((s) => s.id)).toEqual([share.id]);
  });

  it("refuses to share another user's playlist, and follows playlist order", () => {
    const a = seed({ artist: "A", album: "X", title: "Second" });
    const b = seed({ artist: "A", album: "X", title: "First" });
    const p = music.createPlaylist(user, "Mine")!;
    music.addToPlaylist(user, p.id, b.id);
    music.addToPlaylist(user, p.id, a.id);
    expect(shares.createShare(other, "playlist", p.id)).toBeNull();
    const share = shares.createShare(user, "playlist", p.id)!;
    expect(share).toMatchObject({ title: "Mine", subtitle: "Playlist", trackCount: 2 });
    expect(shares.openShare(share.id)!.tracks.map((t) => t.title)).toEqual(["First", "Second"]);
  });

  it("returns null for things that do not exist", () => {
    expect(shares.createShare(user, "album", crypto.randomUUID())).toBeNull();
    expect(shares.openShare("abcdefghj")).toBeNull();
  });
});
