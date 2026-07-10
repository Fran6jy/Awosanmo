import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrate } from "../db/schema.js";
import { register } from "../modules/auth/auth.js";
import { getOwnedFile, listFiles, deleteFile, renameFile } from "../modules/files/fileService.js";
import { createFolder, getFolder, listFolders, moveFiles } from "../modules/folders/folderService.js";
import { config } from "../config.js";
import { releaseQuota, reserveQuota, withQuotaAllocation } from "../modules/storage/storageService.js";

function clearDb() {
  for (const t of ["refresh_tokens", "wishlist", "folders", "files", "torrents", "users"]) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
}

/** Insert a torrent + one file owned by a user; returns the file id. */
function seedFile(userId: string, name: string): string {
  const torrentId = crypto.randomUUID();
  db.prepare("INSERT INTO torrents (id, user_id, name, magnet_uri, status) VALUES (?, ?, ?, ?, ?)")
    .run(torrentId, userId, name, "local://test", "completed");
  const fileId = crypto.randomUUID();
  db.prepare("INSERT INTO files (id, torrent_id, user_id, name, path, size, media_kind, streamable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(fileId, torrentId, userId, name, name, 100, "file", 0);
  return fileId;
}

let alice: string;
let bob: string;

beforeAll(() => migrate());
beforeEach(async () => {
  clearDb();
  await register("alice@x.com", "password123");
  await register("bob@x.com", "password123");
  alice = (db.prepare("SELECT id FROM users WHERE email = ?").get("alice@x.com") as any).id;
  bob = (db.prepare("SELECT id FROM users WHERE email = ?").get("bob@x.com") as any).id;
});

describe("file isolation", () => {
  it("only lists a user's own files", () => {
    seedFile(alice, "alice-movie.mkv");
    seedFile(bob, "bob-doc.pdf");
    const aliceFiles = listFiles(alice) as any[];
    const bobFiles = listFiles(bob) as any[];
    expect(aliceFiles).toHaveLength(1);
    expect(aliceFiles[0].name).toBe("alice-movie.mkv");
    expect(bobFiles).toHaveLength(1);
    expect(bobFiles[0].name).toBe("bob-doc.pdf");
  });

  it("does not let one user fetch another's file", () => {
    const aliceFile = seedFile(alice, "secret.mkv");
    expect(getOwnedFile(aliceFile, alice)).toBeTruthy();
    expect(getOwnedFile(aliceFile, bob)).toBeUndefined();
  });

  it("does not let one user delete another's file", () => {
    const aliceFile = seedFile(alice, "keep.mkv");
    expect(deleteFile(aliceFile, bob)).toBe(false);
    expect(getOwnedFile(aliceFile, alice)).toBeTruthy();
    expect(deleteFile(aliceFile, alice)).toBe(true);
  });

  it("scopes search results to the owner", () => {
    seedFile(alice, "shared-name.mkv");
    seedFile(bob, "shared-name.mkv");
    expect((listFiles(alice, "shared") as any[])).toHaveLength(1);
    expect((listFiles(bob, "shared") as any[])).toHaveLength(1);
  });

  it("does not overwrite an existing file during rename", () => {
    const fileId = seedFile(alice, "first.txt");
    const file = getOwnedFile(fileId, alice);
    const dir = path.join(config.dataDir, "downloads", file.torrent_id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "first.txt"), "first");
    fs.writeFileSync(path.join(dir, "second.txt"), "second");
    expect(() => renameFile(fileId, "second.txt", alice)).toThrow(/already exists/i);
    expect(fs.readFileSync(path.join(dir, "first.txt"), "utf8")).toBe("first");
    expect(fs.readFileSync(path.join(dir, "second.txt"), "utf8")).toBe("second");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("quota reservations", () => {
  it("prevents competing uploads from claiming the same capacity", () => {
    db.prepare("UPDATE users SET quota_bytes = 150 WHERE id = ?").run(alice);
    reserveQuota(alice, "upload-a", 100);
    expect(() => reserveQuota(alice, "upload-b", 60)).toThrow(/quota exceeded/i);
    expect(() => withQuotaAllocation(alice, 60, () => undefined)).toThrow(/quota exceeded/i);
    releaseQuota("upload-a", alice);
    expect(() => reserveQuota(alice, "upload-b", 60)).not.toThrow();
  });
});

describe("folder isolation", () => {
  it("only lists a user's own folders", () => {
    createFolder("Movies", null, alice);
    createFolder("Books", null, bob);
    expect(listFolders(null, alice).map((f) => f.name)).toEqual(["Movies"]);
    expect(listFolders(null, bob).map((f) => f.name)).toEqual(["Books"]);
  });

  it("hides another user's folder by id", () => {
    const folder = createFolder("Private", null, alice);
    expect(getFolder(folder.id, alice)).toBeTruthy();
    expect(getFolder(folder.id, bob)).toBeUndefined();
  });

  it("won't move files into a folder you don't own", () => {
    const aliceFolder = createFolder("AliceFolder", null, alice);
    const bobFile = seedFile(bob, "bob.mkv");
    // Bob cannot target Alice's folder.
    expect(() => moveFiles([bobFile], aliceFolder.id, bob)).toThrow();
  });

  it("won't move another user's file even into your own folder", () => {
    const bobFolder = createFolder("BobFolder", null, bob);
    const aliceFile = seedFile(alice, "alice.mkv");
    // Bob owns the folder but not the file → nothing moves.
    expect(moveFiles([aliceFile], bobFolder.id, bob)).toBe(0);
  });
});
