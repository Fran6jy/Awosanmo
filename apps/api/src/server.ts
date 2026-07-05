import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "node:http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import pinoHttpImport from "pino-http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { migrate } from "./db/schema.js";
import { ensureAdminUser, login, loginSchema, requireAuth, requireDownloadAuth, requireStreamAuth, requireSubtitleAuth, rotateRefresh, revokeRefresh, signDownloadToken, signStreamToken, signSubtitleToken } from "./modules/auth/auth.js";
import { torrentRoutes } from "./modules/torrents/routes.js";
import { torrentService } from "./modules/torrents/torrentService.js";
import { streamFile } from "./modules/streaming/streamController.js";
import { getStorageStats } from "./modules/storage/storageService.js";
import { mediaWorker } from "./modules/media/mediaWorker.js";
import { fileRoutes } from "./modules/files/routes.js";
import { downloadFile } from "./modules/files/downloadController.js";
import { playbackRoutes } from "./modules/playback/routes.js";
import { subtitleFile } from "./modules/files/subtitleController.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { searchRoutes } from "./modules/search/routes.js";
import { uploadRoutes } from "./modules/uploads/routes.js";
import { folderRoutes } from "./modules/folders/routes.js";
import { wishlistRoutes } from "./modules/wishlist/routes.js";
import { zipDownload } from "./modules/files/zipController.js";

fs.mkdirSync(config.dataDir, { recursive: true });
migrate();
ensureAdminUser();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.corsOrigin } });
torrentService.attach(io);
torrentService.restore();
mediaWorker.start();

app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      "frame-src": ["'self'", "blob:"],
      "child-src": ["'self'", "blob:"],
      "img-src": ["'self'", "data:", "blob:"]
    }
  }
}));
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(compression());
const pinoHttp = pinoHttpImport as unknown as typeof import("pino-http").default;
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: "256kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 180 }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.post("/api/login", async (req, res) => {
  const body = loginSchema.parse(req.body);
  const session = await login(body.email, body.password);
  if (!session) return res.status(401).json({ error: "Invalid credentials" });
  res.json(session);
});
app.post("/api/refresh", (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (typeof refreshToken !== "string") return res.status(400).json({ error: "Missing refresh token" });
  const next = rotateRefresh(refreshToken);
  if (!next) return res.status(401).json({ error: "Invalid or expired refresh token" });
  res.json(next);
});
app.post("/api/logout", (req, res) => {
  if (typeof req.body?.refreshToken === "string") revokeRefresh(req.body.refreshToken);
  res.sendStatus(204);
});
app.use("/api/torrents", requireAuth, torrentRoutes);
app.use("/api/files", requireAuth, fileRoutes);
app.use("/api/playback", requireAuth, playbackRoutes);
app.use("/api/admin", requireAuth, adminRoutes);
app.use("/api/search", requireAuth, searchRoutes);
app.use("/api/uploads", requireAuth, uploadRoutes);
app.use("/api/folders", requireAuth, folderRoutes);
app.use("/api/wishlist", requireAuth, wishlistRoutes);
// Token-authenticated so the browser can download by navigation (no header).
app.get("/api/zip", zipDownload);
app.post("/api/stream-token/:id", requireAuth, (req: any, res) => {
  res.json({ streamToken: signStreamToken(req.user.id, req.params.id), expiresIn: config.streamTokenTtlSeconds });
});
app.post("/api/download-token/:id", requireAuth, (req: any, res) => {
  res.json({ downloadToken: signDownloadToken(req.user.id, req.params.id), expiresIn: config.streamTokenTtlSeconds });
});
app.post("/api/subtitle-token/:id", requireAuth, (req: any, res) => {
  res.json({ subtitleToken: signSubtitleToken(req.user.id, req.params.id), expiresIn: config.streamTokenTtlSeconds });
});
app.get("/api/stream/:id", requireStreamAuth, streamFile);
app.get("/api/download/:id", requireDownloadAuth, downloadFile);
app.get("/api/subtitle/:id", requireSubtitleAuth, subtitleFile);
app.get("/api/stats", requireAuth, (_req, res) => {
  const usage = process.memoryUsage();
  res.json({ memory: usage, uptime: process.uptime(), torrents: torrentService.list().length });
});
app.get("/api/storage", requireAuth, (_req, res) => res.json(getStorageStats()));

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, etag: true, maxAge: "1h" }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

io.on("connection", (socket) => {
  socket.emit("torrents:update", torrentService.list());
});

server.listen(config.port, () => logger.info({ port: config.port }, "Awosanmo API listening"));
