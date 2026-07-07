import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import express from "express";
import http from "node:http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import pinoHttpImport from "pino-http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { migrate } from "./db/schema.js";
import { changePassword, completeTwoFactorLogin, disableTotp, enableTotp, ensureAdminUser, login, loginSchema, register, registerSchema, requireAuth, requireDownloadAuth, requireStreamAuth, requireSubtitleAuth, rotateRefresh, revokeRefresh, setupTotp, signDownloadToken, signStreamToken, signSubtitleToken, twoFactorStatus } from "./modules/auth/auth.js";
import { getOwnedFile } from "./modules/files/fileService.js";
import { torrentRoutes } from "./modules/torrents/routes.js";
import { torrentService } from "./modules/torrents/torrentService.js";
import { streamFile } from "./modules/streaming/streamController.js";
import { transcodeFile } from "./modules/streaming/transcodeController.js";
import { hlsPlaylist, hlsSegment } from "./modules/streaming/hlsController.js";
import { getStorageStats, getUserStorageStats } from "./modules/storage/storageService.js";
import { mediaWorker } from "./modules/media/mediaWorker.js";
import { fileRoutes } from "./modules/files/routes.js";
import { downloadFile } from "./modules/files/downloadController.js";
import { playbackRoutes } from "./modules/playback/routes.js";
import { subtitleFile } from "./modules/files/subtitleController.js";
import { thumbnailFile } from "./modules/files/thumbnailController.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { searchRoutes } from "./modules/search/routes.js";
import { uploadRoutes } from "./modules/uploads/routes.js";
import { folderRoutes } from "./modules/folders/routes.js";
import { wishlistRoutes } from "./modules/wishlist/routes.js";
import { zipDownload } from "./modules/files/zipController.js";
import { openapiSpec } from "./openapi.js";

// swagger-ui-express is CommonJS; load via createRequire for reliable interop.
const swaggerUi = createRequire(import.meta.url)("swagger-ui-express") as {
  serve: express.RequestHandler[];
  setup: (spec: unknown, opts?: unknown) => express.RequestHandler;
};

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
      "img-src": ["'self'", "data:", "blob:"],
      // hls.js plays via MSE (blob: media source) and a blob: web worker — the
      // helmet defaults ('self') block both, which silently freezes playback.
      "media-src": ["'self'", "blob:", "data:"],
      "worker-src": ["'self'", "blob:"],
      "connect-src": ["'self'", "blob:"]
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
app.get("/api/app-config", (_req, res) => res.json({ allowRegistration: config.allowRegistration }));
// API documentation (public): raw spec + Swagger UI.
app.get("/api/openapi.json", (_req, res) => res.json(openapiSpec));
app.use(
  "/api/docs",
  (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Swagger UI relies on inline script/style; relax CSP for this path only.
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, { customSiteTitle: "Awosanmo API" }),
);
app.post("/api/login", async (req, res) => {
  const body = loginSchema.parse(req.body);
  const session = await login(body.email, body.password);
  if (!session) return res.status(401).json({ error: "Invalid credentials" });
  res.json(session);
});
app.post("/api/register", async (req, res) => {
  if (!config.allowRegistration) return res.status(403).json({ error: "Sign-up is disabled" });
  const body = registerSchema.parse(req.body);
  const session = await register(body.email, body.password);
  if (!session) return res.status(409).json({ error: "An account with that email already exists" });
  res.status(201).json(session);
});
app.post("/api/account/password", requireAuth, async (req: any, res) => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const nextPassword = typeof req.body?.nextPassword === "string" ? req.body.nextPassword : "";
  if (!(await changePassword(req.user.id, currentPassword, nextPassword))) return res.status(400).json({ error: "Could not change password" });
  res.json({ ok: true });
});
// Second step of a 2FA login.
app.post("/api/login/2fa", async (req, res) => {
  const { ticket, code } = req.body ?? {};
  if (typeof ticket !== "string" || typeof code !== "string") return res.status(400).json({ error: "Missing ticket or code" });
  const session = await completeTwoFactorLogin(ticket, code);
  if (!session) return res.status(401).json({ error: "Invalid or expired code" });
  res.json(session);
});
// 2FA management (all require an active session).
app.get("/api/2fa/status", requireAuth, (req: any, res) => res.json(twoFactorStatus(req.user.id)));
app.post("/api/2fa/setup", requireAuth, async (req: any, res) => {
  const result = await setupTotp(req.user.id);
  if (!result) return res.status(404).json({ error: "User not found" });
  res.json(result);
});
app.post("/api/2fa/enable", requireAuth, async (req: any, res) => {
  const code = req.body?.code;
  if (typeof code !== "string") return res.status(400).json({ error: "Missing code" });
  if (!(await enableTotp(req.user.id, code))) return res.status(400).json({ error: "Invalid code" });
  res.json({ enabled: true });
});
app.post("/api/2fa/disable", requireAuth, async (req: any, res) => {
  const code = req.body?.code;
  if (typeof code !== "string") return res.status(400).json({ error: "Missing code" });
  if (!(await disableTotp(req.user.id, code))) return res.status(400).json({ error: "Invalid code" });
  res.json({ enabled: false });
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
// Only issue a media token if the caller owns the file.
const ownsFile = (req: any, res: any, next: any) => {
  if (!getOwnedFile(req.params.id, req.user.id)) return res.status(404).json({ error: "File not found" });
  next();
};
app.post("/api/stream-token/:id", requireAuth, ownsFile, (req: any, res) => {
  res.json({ streamToken: signStreamToken(req.user.id, req.params.id), expiresIn: config.streamTokenTtlSeconds });
});
app.post("/api/download-token/:id", requireAuth, ownsFile, (req: any, res) => {
  res.json({ downloadToken: signDownloadToken(req.user.id, req.params.id), expiresIn: config.streamTokenTtlSeconds });
});
app.post("/api/subtitle-token/:id", requireAuth, ownsFile, (req: any, res) => {
  res.json({ subtitleToken: signSubtitleToken(req.user.id, req.params.id), expiresIn: config.streamTokenTtlSeconds });
});
app.get("/api/stream/:id", requireStreamAuth, streamFile);
app.get("/api/transcode/:id", requireStreamAuth, transcodeFile);
// HLS on-the-fly transcode (reliable browser playback of unsupported codecs).
app.get("/api/hls/:id/index.m3u8", requireStreamAuth, hlsPlaylist);
app.get("/api/hls/:id/:seg", requireStreamAuth, hlsSegment);
app.get("/api/download/:id", requireDownloadAuth, downloadFile);
app.get("/api/subtitle/:id", requireSubtitleAuth, subtitleFile);
app.get("/api/thumbnail/:id", requireStreamAuth, thumbnailFile);
app.get("/api/stats", requireAuth, (req: any, res) => {
  const usage = process.memoryUsage();
  res.json({ memory: usage, uptime: process.uptime(), torrents: torrentService.list(req.user.id).length });
});
app.get("/api/storage", requireAuth, (req: any, res) => res.json({ ...getStorageStats(), user: getUserStorageStats(req.user.id) }));

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, etag: true, maxAge: "1h" }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

// Authenticate every socket so torrent updates are delivered per-user only.
io.use((socket, next) => {
  try {
    const raw = socket.handshake.auth?.token as string | undefined;
    if (!raw) return next(new Error("unauthorized"));
    const payload = jwt.verify(raw, config.jwtSecret) as any;
    if (payload.typ === "refresh" || !payload.id) return next(new Error("unauthorized"));
    (socket.data as any).userId = payload.id;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});
io.on("connection", (socket) => {
  const userId = (socket.data as any).userId as string;
  socket.join(`u:${userId}`);
  socket.emit("torrents:update", torrentService.list(userId));
});

server.listen(config.port, () => logger.info({ port: config.port }, "Awosanmo API listening"));
