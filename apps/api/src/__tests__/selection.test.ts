import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrate } from "../db/schema.js";
import { register } from "../modules/auth/auth.js";
import { torrentService } from "../modules/torrents/torrentService.js";

/** A file occupying an inclusive piece range, mimicking WebTorrent's File. */
class FakeFile {
  constructor(
    readonly path: string,
    readonly startPiece: number,
    readonly endPiece: number,
    private readonly pieces: Set<number>,
  ) {}
  select() {
    for (let i = this.startPiece; i <= this.endPiece; i += 1) this.pieces.add(i);
  }
  deselect() {
    for (let i = this.startPiece; i <= this.endPiece; i += 1) this.pieces.delete(i);
  }
}

/** Two adjacent files SHARE the piece on their boundary, exactly as in a real
 *  torrent -- that shared piece is what a deselect can wrongly strip away. */
function fakeTorrent() {
  const pieces = new Set<number>();
  const files = [
    new FakeFile("repack/wanted.bin", 0, 10, pieces),
    new FakeFile("repack/unwanted.bin", 10, 20, pieces),
  ];
  return { pieces, files, resume: () => undefined };
}

function seedTorrent(userId: string, paths: string[]) {
  const torrentId = crypto.randomUUID();
  db.prepare("INSERT INTO torrents (id, user_id, name, magnet_uri, status, size) VALUES (?, ?, ?, ?, ?, ?)")
    .run(torrentId, userId, "repack", "magnet:?xt=urn:btih:abc", "awaiting_selection", 2000);
  const fileIds = paths.map((p) => {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO files (id, torrent_id, user_id, name, path, size, media_kind, streamable, selected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(id, torrentId, userId, p, p, 1000, "file", 0);
    return id;
  });
  return { torrentId, fileIds };
}

let userId: string;

beforeAll(() => migrate());
beforeEach(async () => {
  for (const t of ["files", "torrents", "quota_reservations", "refresh_tokens", "users"]) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  await register("picker@x.com", "password123");
  userId = (db.prepare("SELECT id FROM users WHERE email = ?").get("picker@x.com") as any).id;
});

describe("selective downloads", () => {
  it("keeps every piece of a chosen file, including one shared with a skipped file", () => {
    const torrent = fakeTorrent();
    const { torrentId, fileIds } = seedTorrent(userId, ["repack/wanted.bin", "repack/unwanted.bin"]);
    (torrentService as any).active.set(torrentId, torrent);

    torrentService.selectFiles(torrentId, userId, [fileIds[0]]);

    // Piece 10 belongs to both files. Deselecting the skipped file after
    // selecting the wanted one would remove it, leaving the wanted file
    // permanently one piece short and the transfer stuck below 100%.
    for (let piece = 0; piece <= 10; piece += 1) {
      expect(torrent.pieces.has(piece), `piece ${piece} must stay selected`).toBe(true);
    }
    // Nothing beyond the wanted file may be fetched.
    for (let piece = 11; piece <= 20; piece += 1) {
      expect(torrent.pieces.has(piece), `piece ${piece} must not be selected`).toBe(false);
    }
  });

  it("persists the choice and charges only the selected bytes", () => {
    const torrent = fakeTorrent();
    const { torrentId, fileIds } = seedTorrent(userId, ["repack/wanted.bin", "repack/unwanted.bin"]);
    (torrentService as any).active.set(torrentId, torrent);

    const result = torrentService.selectFiles(torrentId, userId, [fileIds[0]]);

    expect(result).toMatchObject({ selectedFiles: 1, selectedBytes: 1000 });
    const rows = db.prepare("SELECT id, selected FROM files WHERE torrent_id = ?").all(torrentId) as any[];
    expect(rows.find((r) => r.id === fileIds[0]).selected).toBe(1);
    expect(rows.find((r) => r.id === fileIds[1]).selected).toBe(0);
    const row = db.prepare("SELECT status, size FROM torrents WHERE id = ?").get(torrentId) as any;
    expect(row.status).toBe("downloading");
    expect(row.size).toBe(1000);
  });

  it("rejects file ids belonging to another torrent", () => {
    const torrent = fakeTorrent();
    const a = seedTorrent(userId, ["repack/wanted.bin", "repack/unwanted.bin"]);
    const b = seedTorrent(userId, ["other/file.bin"]);
    (torrentService as any).active.set(a.torrentId, torrent);

    expect(() => torrentService.selectFiles(a.torrentId, userId, [b.fileIds[0]])).toThrow(/do not belong/i);
  });

  it("refuses a second selection once downloading has started", () => {
    const torrent = fakeTorrent();
    const { torrentId, fileIds } = seedTorrent(userId, ["repack/wanted.bin", "repack/unwanted.bin"]);
    (torrentService as any).active.set(torrentId, torrent);

    torrentService.selectFiles(torrentId, userId, [fileIds[0]]);
    expect(() => torrentService.selectFiles(torrentId, userId, [fileIds[1]])).toThrow(/only available before/i);
  });

  it("treats resubmitting the same selection as a no-op instead of an error", () => {
    const torrent = fakeTorrent();
    const { torrentId, fileIds } = seedTorrent(userId, ["repack/wanted.bin", "repack/unwanted.bin"]);
    (torrentService as any).active.set(torrentId, torrent);

    torrentService.selectFiles(torrentId, userId, [fileIds[0]]);
    // A retry after a dropped response must not fail the user.
    expect(torrentService.selectFiles(torrentId, userId, [fileIds[0]])).toMatchObject({ selectedFiles: 1 });
  });

  it("stays selectable while the torrent seeds to peers", () => {
    const torrent = fakeTorrent();
    const { torrentId, fileIds } = seedTorrent(userId, ["repack/wanted.bin", "repack/unwanted.bin"]);
    (torrentService as any).active.set(torrentId, torrent);

    // A torrent awaiting a choice still uploads to peers. That activity used to
    // rewrite the row as "downloading", after which the picker was refused.
    (torrentService as any).update(torrentId, { ...torrent, downloadSpeed: 0, uploadSpeed: 900, uploaded: 57317 });

    const row = db.prepare("SELECT status, uploaded FROM torrents WHERE id = ?").get(torrentId) as any;
    expect(row.status).toBe("awaiting_selection");
    expect(row.uploaded).toBe(57317);
    // ...and the selection still goes through.
    expect(torrentService.selectFiles(torrentId, userId, [fileIds[0]])).toMatchObject({ selectedFiles: 1 });
  });

  it("does not retire a torrent that is still awaiting a choice", () => {
    const torrent = fakeTorrent();
    const { torrentId } = seedTorrent(userId, ["repack/wanted.bin", "repack/unwanted.bin"]);
    (torrentService as any).active.set(torrentId, torrent);

    (torrentService as any).completeTorrent(torrentId, { ...torrent, name: "repack", downloaded: 0, uploaded: 0 });

    const row = db.prepare("SELECT status FROM torrents WHERE id = ?").get(torrentId) as any;
    expect(row.status).toBe("awaiting_selection");
  });

  it("hides unselected files from the library", () => {
    const torrent = fakeTorrent();
    const { torrentId, fileIds } = seedTorrent(userId, ["repack/wanted.bin", "repack/unwanted.bin"]);
    (torrentService as any).active.set(torrentId, torrent);

    torrentService.selectFiles(torrentId, userId, [fileIds[0]]);

    const visible = db.prepare("SELECT id FROM files WHERE user_id = ? AND selected = 1").all(userId) as any[];
    expect(visible.map((r) => r.id)).toEqual([fileIds[0]]);
  });
});
