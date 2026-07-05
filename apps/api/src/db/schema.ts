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
  `);
  // Virtual folder a file belongs to (NULL = library root).
  addColumn("files", "folder_id", "TEXT");
  addColumn("files", "probe_status", "TEXT NOT NULL DEFAULT 'pending'");
  addColumn("files", "probe_error", "TEXT");
  addColumn("files", "codec_video", "TEXT");
  addColumn("files", "codec_audio", "TEXT");
  addColumn("files", "width", "INTEGER");
  addColumn("files", "height", "INTEGER");
  addColumn("files", "bitrate", "INTEGER");
  addColumn("files", "frame_rate", "REAL");
  addColumn("files", "audio_tracks", "INTEGER NOT NULL DEFAULT 0");
  addColumn("files", "subtitle_tracks", "INTEGER NOT NULL DEFAULT 0");
  addColumn("files", "probed_at", "TEXT");
  db.exec(`
    UPDATE files
    SET streamable = 1, probe_status = 'pending'
    WHERE media_kind = 'audio' AND streamable = 0;

    UPDATE files
    SET probe_status = 'ready'
    WHERE streamable = 0 AND probe_status = 'pending';
  `);
}

function addColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
