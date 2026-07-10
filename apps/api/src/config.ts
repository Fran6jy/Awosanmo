import "dotenv/config";

const production = process.env.NODE_ENV === "production";

function requiredInProduction(name: string, developmentFallback: string, minimumLength = 1) {
  const value = process.env[name]?.trim();
  if (production && (!value || value.length < minimumLength)) {
    throw new Error(`${name} must be set to at least ${minimumLength} characters in production`);
  }
  return value || developmentFallback;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: requiredInProduction("JWT_SECRET", "development-only-jwt-secret", 32),
  adminEmail: requiredInProduction("ADMIN_EMAIL", "admin@awosanmo.local"),
  adminPassword: requiredInProduction("ADMIN_PASSWORD", "change-me-now", 12),
  authTokenTtl: process.env.AUTH_TOKEN_TTL ?? "30d",
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "1h",
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? "30d",
  refreshTokenTtlMs: Number(process.env.REFRESH_TOKEN_TTL_MS ?? 30 * 24 * 60 * 60 * 1000),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024 * 1024),
  dataDir: process.env.DATA_DIR ?? "./data",
  dbPath: process.env.DB_PATH ?? "./data/awosanmo.sqlite",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  torrentPort: Number(process.env.TORRENT_PORT ?? 51413),
  torrentMaxConns: Number(process.env.TORRENT_MAX_CONNS ?? 30),
  maxDownloadRate: Number(process.env.MAX_DOWNLOAD_RATE ?? 0),
  maxUploadRate: Number(process.env.MAX_UPLOAD_RATE ?? 64 * 1024),
  streamTokenTtlSeconds: Number(process.env.STREAM_TOKEN_TTL_SECONDS ?? 60 * 60),
  mediaScanIntervalSeconds: Number(process.env.MEDIA_SCAN_INTERVAL_SECONDS ?? 45),
  mediaProbeTimeoutSeconds: Number(process.env.MEDIA_PROBE_TIMEOUT_SECONDS ?? 20),
  maxTranscodes: Number(process.env.MAX_TRANSCODES ?? 1),
  // On-the-fly transcode tuned for a 2-vCPU VM (real-time headroom over 1x).
  transcodeHeight: Number(process.env.TRANSCODE_HEIGHT ?? 720),
  transcodePreset: process.env.TRANSCODE_PRESET ?? "ultrafast",
  transcodeCrf: Number(process.env.TRANSCODE_CRF ?? 26),
  // Security: open sign-up is OFF by default; the admin creates users otherwise.
  allowRegistration: process.env.ALLOW_REGISTRATION === "true",
  // Per-user storage quota (bytes). 0 = unlimited. New users get the default.
  defaultQuotaBytes: Number(process.env.DEFAULT_QUOTA_BYTES ?? 20 * 1024 * 1024 * 1024),
  // Max size for a single add-by-URL fetch.
  maxRemoteBytes: Number(process.env.MAX_REMOTE_BYTES ?? 8 * 1024 * 1024 * 1024)
};
