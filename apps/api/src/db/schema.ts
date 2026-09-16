import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate() {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS torrents (
      id TEXT PRIMARY KEY,
      info_hash TEXT UNIQUE,
      name TEXT NOT NULL,
      magnet_uri TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      download_speed INTEGER NOT NULL DEFAULT 0,
      upload_speed INTEGER NOT NULL DEFAULT 0,
      downloaded INTEGER NOT NULL DEFAULT 0,
      uploaded INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      torrent_id TEXT NOT NULL REFERENCES torrents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT,
      media_kind TEXT,
      streamable INTEGER NOT NULL DEFAULT 0,
      duration REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS playback_positions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      position_seconds REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS idx_files_torrent ON files(torrent_id);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
    CREATE TABLE IF NOT EXISTS wishlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      magnet_uri TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id);
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      jti TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
    CREATE TABLE IF NOT EXISTS quota_reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bytes INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quota_reservations_user ON quota_reservations(user_id);

    -- Music library. Artists and albums are derived from track tags; a track
    -- always resolves to both, falling back to "Unknown" rows so that browsing
    -- never dead-ends on a poorly tagged file.
    CREATE TABLE IF NOT EXISTS music_artists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sort_name)
    );
    CREATE TABLE IF NOT EXISTS music_albums (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL REFERENCES music_artists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_title TEXT NOT NULL,
      year INTEGER,
      art_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(artist_id, sort_title)
    );
    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL REFERENCES music_albums(id) ON DELETE CASCADE,
      artist_id TEXT NOT NULL REFERENCES music_artists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      track_no INTEGER,
      disc_no INTEGER,
      duration REAL,
      genre TEXT,
      year INTEGER,
      path TEXT NOT NULL UNIQUE,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      mime TEXT,
      bitrate INTEGER,
      playable INTEGER NOT NULL DEFAULT 1,
      art_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_music_tracks_album ON music_tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_music_tracks_artist ON music_tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_music_tracks_title ON music_tracks(title);
    CREATE INDEX IF NOT EXISTS idx_music_tracks_genre ON music_tracks(genre);
    CREATE TABLE IF NOT EXISTS music_playlists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_music_playlists_user ON music_playlists(user_id);
    CREATE TABLE IF NOT EXISTS music_playlist_tracks (
      playlist_id TEXT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(playlist_id, position)
    );
    -- Play history drives "recently played" and "on repeat" on the home page.
    CREATE TABLE IF NOT EXISTS music_plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      played_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_music_plays_user_time ON music_plays(user_id, played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_music_plays_track ON music_plays(track_id);
    CREATE TABLE IF NOT EXISTS music_scan_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- "Liked Songs": the one playlist every user has without creating it.
    CREATE TABLE IF NOT EXISTS music_likes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
      liked_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS idx_music_likes_user_time ON music_likes(user_id, liked_at DESC);
    -- Metadata repair bookkeeping: one row per track the catalogue lookup has
    -- decided on, with the file fingerprint it decided on, so a changed file
    -- is looked at again and an unchanged one never is.
    CREATE TABLE IF NOT EXISTS music_enrich (
      track_id TEXT PRIMARY KEY REFERENCES music_tracks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      provider_id TEXT,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      checked_at INTEGER NOT NULL
    );
    -- Audio analysis per track (see analysis.ts). A row with NULL tempo means
    -- the file was looked at and could not be analysed; size/mtime say which
    -- version of the file the numbers describe.
    CREATE TABLE IF NOT EXISTS music_features (
      track_id TEXT PRIMARY KEY REFERENCES music_tracks(id) ON DELETE CASCADE,
      tempo INTEGER,
      energy REAL,
      brightness REAL,
      dance REAL,
      loudness REAL,
      dynamics REAL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      analysed_at INTEGER NOT NULL
    );
    -- Per-user app settings (volume, crossfade, ...) so every device behaves the same.
    CREATE TABLE IF NOT EXISTS music_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
    -- Lyrics cache (LRCLIB). NULL synced and plain with a recent fetched_at is a remembered miss.
    CREATE TABLE IF NOT EXISTS music_lyrics (
      track_id TEXT PRIMARY KEY REFERENCES music_tracks(id) ON DELETE CASCADE,
      synced TEXT,
      plain TEXT,
      fetched_at INTEGER NOT NULL
    );
    -- Public share links: a short slug that lets anyone play (and optionally
    -- download) one track, album or playlist without an account.
    CREATE TABLE IF NOT EXISTS music_shares (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('track','album','playlist')),
      target_id TEXT NOT NULL,
      allow_download INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER,
      views INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_music_shares_user ON music_shares(user_id, created_at DESC);
    -- One playback session per user: which device is playing what. Every
    -- other device shows it and can take over, Spotify Connect style.
    CREATE TABLE IF NOT EXISTS music_playback (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      track_id TEXT REFERENCES music_tracks(id) ON DELETE SET NULL,
      queue_ids TEXT NOT NULL DEFAULT '[]',
      cursor INTEGER NOT NULL DEFAULT 0,
      shuffle INTEGER NOT NULL DEFAULT 0,
      repeat TEXT NOT NULL DEFAULT 'off',
      position REAL NOT NULL DEFAULT 0,
      playing INTEGER NOT NULL DEFAULT 0,
      context TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare("DELETE FROM quota_reservations WHERE expires_at < ?").run(Date.now());
  // Virtual folder a file belongs to (NULL = library root).
  addColumn("files", "folder_id", "TEXT");
  addColumn("music_artists", "image_path", "TEXT");
  // Per-user ownership for isolation (NULL rows predate multi-user).
  addColumn("torrents", "user_id", "TEXT");
  addColumn("files", "user_id", "TEXT");
  addColumn("folders", "user_id", "TEXT");
  // TOTP two-factor auth.
  addColumn("users", "totp_secret", "TEXT");
  addColumn("users", "totp_enabled", "INTEGER NOT NULL DEFAULT 0");
  addColumn("users", "quota_bytes", `INTEGER NOT NULL DEFAULT ${config.defaultQuotaBytes}`);
  addColumn("files", "probe_status", "TEXT NOT NULL DEFAULT 'pending'");
  addColumn("files", "probe_error", "TEXT");
  addColumn("files", "thumbnail_path", "TEXT");
  addColumn("files", "codec_video", "TEXT");
  addColumn("files", "codec_audio", "TEXT");
  addColumn("files", "width", "INTEGER");
  addColumn("files", "height", "INTEGER");
  addColumn("files", "bitrate", "INTEGER");
  addColumn("files", "frame_rate", "REAL");
  addColumn("files", "audio_tracks", "INTEGER NOT NULL DEFAULT 0");
  addColumn("files", "subtitle_tracks", "INTEGER NOT NULL DEFAULT 0");
  addColumn("files", "probed_at", "TEXT");
  // A user-chosen playlist cover; NULL falls back to the first track's art.
  addColumn("music_playlists", "cover_path", "TEXT");
  // Torrent metadata may be visible before the user chooses what to download.
  // Existing rows default to selected so upgrades preserve current libraries.
  addColumn("files", "selected", "INTEGER NOT NULL DEFAULT 1");
  db.exec(`
    UPDATE files
    SET streamable = 1, probe_status = 'pending'
    WHERE media_kind = 'audio' AND streamable = 0;

    UPDATE files
    SET probe_status = 'ready'
    WHERE streamable = 0 AND probe_status = 'pending';

    UPDATE users
    SET quota_bytes = ${config.defaultQuotaBytes}
    WHERE quota_bytes IS NULL;
  `);
  // A torrent's file list was re-inserted every time WebTorrent re-emitted
  // "metadata" (notably on every server restart), because the INSERT OR IGNORE
  // used a fresh UUID primary key and so had nothing to collide with. Drop the
  // duplicates that accumulated, keeping the oldest row of each set, then add
  // the uniqueness constraint that makes OR IGNORE actually ignore.
  db.exec(`
    DELETE FROM files
    WHERE rowid NOT IN (SELECT MIN(rowid) FROM files GROUP BY torrent_id, path);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_torrent_path ON files(torrent_id, path);
  `);
}

function addColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
