import crypto from "node:crypto";
import { db } from "../../db/schema.js";
import { TRACK_SELECT, toView, type TrackView } from "./service.js";

/**
 * Share links. A share is a short random slug pointing at one track, album or
 * playlist. Anyone holding the slug can list and stream its tracks (and
 * download them unless the owner said no) with no account. The owner can set
 * an expiry and revoke at any time; a revoked or expired slug simply 404s.
 */

export type ShareKind = "track" | "album" | "playlist";

export type ShareView = {
  id: string;
  kind: ShareKind;
  targetId: string;
  title: string;
  subtitle: string;
  art: string | null;
  trackCount: number;
  allowDownload: boolean;
  createdAt: number;
  expiresAt: number | null;
  views: number;
};

/** What a visitor sees: the collection plus its tracks, minus anything personal. */
export type SharedContent = {
  id: string;
  kind: ShareKind;
  title: string;
  subtitle: string;
  art: string | null;
  allowDownload: boolean;
  sharedBy: string;
  tracks: TrackView[];
};

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/l/I

function newSlug(length = 9): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

type TargetInfo = { title: string; subtitle: string; art: string | null; trackCount: number } | null;

/** Resolve the thing a share points at; null when it no longer exists (or, for playlists, is not the owner's). */
function describeTarget(userId: string, kind: ShareKind, targetId: string): TargetInfo {
  if (kind === "track") {
    const r = db.prepare(`${TRACK_SELECT} WHERE t.id = ?`).get(targetId) as any;
    return r ? { title: r.title, subtitle: r.artist, art: r.art, trackCount: 1 } : null;
  }
  if (kind === "album") {
    const r = db.prepare(`SELECT al.title, al.art_path AS art, a.name AS artist, COUNT(t.id) AS n
      FROM music_albums al JOIN music_artists a ON a.id = al.artist_id LEFT JOIN music_tracks t ON t.album_id = al.id
      WHERE al.id = ? GROUP BY al.id`).get(targetId) as any;
    return r ? { title: r.title, subtitle: r.artist, art: r.art, trackCount: r.n } : null;
  }
  const r = db.prepare(`SELECT p.name, p.cover_path,
      (SELECT COALESCE(t2.art_path, al2.art_path) FROM music_playlist_tracks pt2 JOIN music_tracks t2 ON t2.id = pt2.track_id JOIN music_albums al2 ON al2.id = t2.album_id
         WHERE pt2.playlist_id = p.id AND COALESCE(t2.art_path, al2.art_path) IS NOT NULL ORDER BY pt2.position LIMIT 1) AS first_art,
      (SELECT COUNT(*) FROM music_playlist_tracks pt WHERE pt.playlist_id = p.id) AS n
    FROM music_playlists p WHERE p.id = ? AND p.user_id = ?`).get(targetId, userId) as any;
  return r ? { title: r.name, subtitle: "Playlist", art: r.cover_path ?? r.first_art, trackCount: r.n } : null;
}

function tracksOf(kind: ShareKind, targetId: string): TrackView[] {
  const sql =
    kind === "track" ? `${TRACK_SELECT} WHERE t.id = ?` :
    kind === "album" ? `${TRACK_SELECT} WHERE t.album_id = ? ORDER BY t.disc_no, t.track_no, t.title COLLATE NOCASE` :
    `${TRACK_SELECT} JOIN music_playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ? ORDER BY pt.position`;
  return (db.prepare(sql).all(targetId) as any[]).map((r) => toView(r));
}

function toShareView(row: any, target: NonNullable<TargetInfo>): ShareView {
  return {
    id: row.id, kind: row.kind, targetId: row.target_id,
    title: target.title, subtitle: target.subtitle, art: target.art, trackCount: target.trackCount,
    allowDownload: Boolean(row.allow_download), createdAt: row.created_at, expiresAt: row.expires_at, views: row.views,
  };
}

export function createShare(userId: string, kind: ShareKind, targetId: string, opts: { expiresInDays?: number | null; allowDownload?: boolean } = {}): ShareView | null {
  const target = describeTarget(userId, kind, targetId);
  if (!target) return null;
  const now = Date.now();
  const expiresAt = opts.expiresInDays ? now + opts.expiresInDays * 86_400_000 : null;
  const id = newSlug();
  db.prepare(`INSERT INTO music_shares (id, user_id, kind, target_id, allow_download, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, userId, kind, targetId, opts.allowDownload === false ? 0 : 1, now, expiresAt);
  const row = db.prepare("SELECT * FROM music_shares WHERE id = ?").get(id);
  return toShareView(row, target);
}

/** The owner's live shares, newest first. Shares whose target vanished are dropped from the list. */
export function listShares(userId: string): ShareView[] {
  const rows = db.prepare("SELECT * FROM music_shares WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC").all(userId) as any[];
  const out: ShareView[] = [];
  for (const row of rows) {
    const target = describeTarget(userId, row.kind, row.target_id);
    if (target) out.push(toShareView(row, target));
  }
  return out;
}

export function revokeShare(userId: string, id: string): boolean {
  const r = db.prepare("UPDATE music_shares SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").run(Date.now(), id, userId) as any;
  return r.changes > 0;
}

function liveRow(id: string): any | null {
  const row = db.prepare("SELECT s.*, u.email AS owner_email FROM music_shares s JOIN users u ON u.id = s.user_id WHERE s.id = ?").get(id) as any;
  if (!row || row.revoked_at) return null;
  if (row.expires_at && row.expires_at < Date.now()) return null;
  return row;
}

/** Everything the public share page needs. Counts a view. */
export function openShare(id: string): SharedContent | null {
  const row = liveRow(id);
  if (!row) return null;
  const target = describeTarget(row.user_id, row.kind, row.target_id);
  if (!target) return null;
  db.prepare("UPDATE music_shares SET views = views + 1 WHERE id = ?").run(id);
  return {
    id: row.id, kind: row.kind, title: target.title, subtitle: target.subtitle, art: target.art,
    allowDownload: Boolean(row.allow_download),
    sharedBy: String(row.owner_email).split("@")[0],
    tracks: tracksOf(row.kind, row.target_id),
  };
}

/** Is this track part of the share (so a visitor may stream or download it)? */
export function shareGrants(id: string, trackId: string, opts: { download?: boolean } = {}): boolean {
  const row = liveRow(id);
  if (!row) return false;
  if (opts.download && !row.allow_download) return false;
  return tracksOf(row.kind, row.target_id).some((t) => t.id === trackId);
}

/** All tracks of a share, for the zip download; null when not allowed. */
export function shareDownloadSet(id: string): { title: string; tracks: TrackView[] } | null {
  const row = liveRow(id);
  if (!row || !row.allow_download) return null;
  const target = describeTarget(row.user_id, row.kind, row.target_id);
  if (!target) return null;
  return { title: target.title, tracks: tracksOf(row.kind, row.target_id) };
}
