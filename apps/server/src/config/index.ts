import 'dotenv/config';
import path from 'node:path';

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const root = process.cwd();

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
  port: num(process.env.PORT, 8080),

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    accessTtl: num(process.env.ACCESS_TOKEN_TTL, 900),
    refreshTtl: num(process.env.REFRESH_TOKEN_TTL, 1209600),
  },

  admin: {
    email: process.env.ADMIN_EMAIL ?? 'admin@awosanmo.local',
    password: process.env.ADMIN_PASSWORD ?? 'changeme123',
  },

  storage: {
    dataDir: path.resolve(root, process.env.DATA_DIR ?? './data'),
    downloadDir: path.resolve(root, process.env.DOWNLOAD_DIR ?? './downloads'),
    maxBytes: num(process.env.MAX_STORAGE_BYTES, 95_000_000_000),
  },

  torrent: {
    maxConns: num(process.env.TORRENT_MAX_CONNS, 30),
    downloadLimit: num(process.env.TORRENT_DOWNLOAD_LIMIT, 0),
    uploadLimit: num(process.env.TORRENT_UPLOAD_LIMIT, 51200),
    maxActive: num(process.env.TORRENT_MAX_ACTIVE, 3),
  },

  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;
