import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

fs.mkdirSync(config.storage.dataDir, { recursive: true });
fs.mkdirSync(config.storage.downloadDir, { recursive: true });

const dbPath = path.join(config.storage.dataDir, 'awosanmo.sqlite');

export const db = new Database(dbPath);

// Pragmas tuned for low-RAM VM + concurrent read/write.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -8000'); // ~8MB page cache
db.pragma('mmap_size = 67108864'); // 64MB mmap
db.pragma('busy_timeout = 5000');

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

    CREATE TABLE IF NOT EXISTS torrents (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      info_hash   TEXT NOT NULL,
      magnet      TEXT NOT NULL,
      name        TEXT NOT NULL DEFAULT '',
      total_bytes INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'downloading',
      added_at    INTEGER NOT NULL,
      done_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_torrents_user ON torrents(user_id);
    CREATE INDEX IF NOT EXISTS idx_torrents_hash ON torrents(info_hash);

    CREATE TABLE IF NOT EXISTS files (
      id         TEXT PRIMARY KEY,
      torrent_id TEXT NOT NULL REFERENCES torrents(id) ON DELETE CASCADE,
      path       TEXT NOT NULL,
      name       TEXT NOT NULL,
      length     INTEGER NOT NULL DEFAULT 0,
      is_media   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_files_torrent ON files(torrent_id);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);

    CREATE TABLE IF NOT EXISTS playback (
      file_id     TEXT NOT NULL,
      user_id     INTEGER NOT NULL,
      position    REAL NOT NULL DEFAULT 0,
      duration    REAL NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (file_id, user_id)
    );
  `);
  logger.info({ dbPath }, 'database migrated');
}
