import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "change-this-before-production",
  dataDir: process.env.DATA_DIR ?? "./data",
  dbPath: process.env.DB_PATH ?? "./data/awosanmo.sqlite",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  torrentPort: Number(process.env.TORRENT_PORT ?? 51413),
  maxDownloadRate: Number(process.env.MAX_DOWNLOAD_RATE ?? 0),
  maxUploadRate: Number(process.env.MAX_UPLOAD_RATE ?? 64 * 1024),
  streamTokenTtlSeconds: Number(process.env.STREAM_TOKEN_TTL_SECONDS ?? 60 * 60),
  mediaScanIntervalSeconds: Number(process.env.MEDIA_SCAN_INTERVAL_SECONDS ?? 45),
  mediaProbeTimeoutSeconds: Number(process.env.MEDIA_PROBE_TIMEOUT_SECONDS ?? 20)
};
