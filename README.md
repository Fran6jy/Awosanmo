# Awosanmo

**A self-hosted private cloud-torrenting and streaming platform.** Paste a magnet
link, upload a `.torrent`, or upload any file — Awosanmo downloads it onto your
VPS and lets you **stream or download it from anywhere**, with sequential
downloading so video starts playing before the download finishes.

A lightweight, self-hosted alternative to Seedr, tuned to run on a 1 vCPU / 1 GB
RAM box (the Oracle Cloud Free Tier in particular).

> **Live & deployed.** Running on an Oracle Ubuntu VM behind nginx + a Cloudflare
> tunnel. For operating the running instance, see **[docs/HANDOFF.md](docs/HANDOFF.md)**.

---

## Highlights

- **Multi-user & secure** — fully siloed accounts with sign-up locked by default,
  refresh-token sessions (1h access / 30d refresh, rotating + revocable),
  password change, server-side logout, and optional **TOTP two-factor** (Google
  Authenticator / Authy) enrolled via QR.
- **Torrent engine** — magnet links & `.torrent` uploads, live peers/seeds/ETA/
  speeds, sticky pause/resume/reannounce, sequential download for streaming,
  session persistence + restore after restart, crash-safe error handling, and
  Seedr-style auto-stop when downloads complete.
- **Wishlist** — save magnets to add to downloads later (header star + panel).
- **Streaming + previews** — HTTP range requests / 206 partial content, fast seek,
  no full buffering, token-authenticated per file, video resume position, audio
  playback, browser-compatible MKV/HEVC transcode fallback, image/PDF/text
  previews, and an in-browser EPUB reader.
- **Files** — upload any file (streamed to disk), search, rename, delete,
  download, **multi-select + bulk delete**, **ZIP download**, **folders** (create/
  rename/delete/move with breadcrumbs), **right-click context menus**,
  **drag-and-drop into folders**, add-by-URL, thumbnails, resilient
  completed-torrent downloads, and a **delete confirmation** on every path.
- **Seedr-style workflow** — click the magnet box to auto-fill a clipboard magnet
  link over HTTPS, header storage quota bar, dense file-manager list view, drag a
  file onto a folder to move it (with clear drop-zone highlighting and a move
  cursor, never the not-allowed icon), and completed uploads kept out of active
  torrent controls.
- **Low-cost fast mode** — magnets appear in the dashboard immediately, duplicate
  same-user magnets/info-hashes reuse the existing torrent row, and metadata
  continues resolving in the background without storing a giant shared cache.
- **Completion cleanup** — when a torrent reaches 100%, Awosanmo marks it
  completed, stops the seeding session, and leaves the files available in Files.
- **Sticky transfer controls** — pause reflects on the first click, zeroes speeds,
  and stays paused until an explicit resume; background torrent events cannot
  auto-resume it.
- **Real-time UI** — Socket.IO pushes torrent progress live; toast + desktop
  notifications on completion.
- **Media metadata** — `ffprobe` extracts resolution, codec, duration, bitrate,
  frame rate, and track counts.
- **Premium two-theme SPA** — React + Tailwind + Framer Motion, Plex/Linear-style
  dark mode, polished light mode, Plus Jakarta Sans, glass surfaces, command
  palette (Ctrl-K), loading states, error boundary, responsive.
- **Documented & tested** — interactive Swagger UI at `/api/docs` (OpenAPI 3.0)
  and a Vitest suite (auth, refresh, 2FA, isolation) run in CI.
- **Low-memory by design** — Node streams end-to-end, per-user storage quotas,
  `--max-old-space-size=384`, WAL SQLite with a small page cache, capped torrent
  connections, and one protected ffmpeg transcode slot.
- **Background resilience** — production runs as a detached Docker Compose
  service with `restart: unless-stopped`, so crashes/OOM exits are restarted by
  Docker without an SSH login.

---

## Tech stack

**Backend:** Node.js 22 · Express 5 · TypeScript · WebTorrent · Socket.IO ·
better-sqlite3 · Multer · archiver · ffprobe/ffmpeg · pino · Zod · JWT · bcrypt ·
otplib + qrcode (2FA) · swagger-ui-express · Vitest

**Frontend:** React 19 · TypeScript · Vite · Tailwind CSS · Framer Motion ·
TanStack Query · React Router · Video.js · epub.js · Lucide icons ·
socket.io-client

**Infra:** Docker · Docker Compose · nginx · systemd · Cloudflare Tunnel · Oracle
Cloud (Ubuntu)

---

## Monorepo layout

```
apps/
  api/       Express + TypeScript API, WebTorrent engine, streaming, SQLite
  web/       React + TypeScript + Vite single-page app
deploy/      nginx, systemd units, Oracle setup + backup scripts
docs/        DEPLOYMENT.md, HANDOFF.md
Dockerfile · docker-compose*.yml · vercel.json
```

The API also serves the built SPA (`apps/web/dist`) in production, so the whole
app runs from **one container** on one origin.

---

## Target environment

- Ubuntu 24.04 / 20.04 LTS · 1 vCPU · 1 GB RAM · 100 GB SSD · 2 GB swap
- Everything is optimized for low memory: streams everywhere, no full-file
  buffering, capped connections, small caches.

---

## Local development

Requires Node 22+ and `ffmpeg`/`ffprobe` on PATH (for media metadata).

```bash
git clone https://github.com/Fran6jy/Awosanmo.git
cd Awosanmo
npm install
cp .env.example apps/api/.env    # then edit secrets

# run API (:4000) and web (:5173) together
npm run dev
```

- Web dev server proxies to the API via `VITE_API_URL` (defaults to
  `http://localhost:4000` in dev).
- Build everything: `npm run build`. Type-check the API: `npm run lint`.
- Run tests: `npm test` (Vitest, uses an isolated throwaway SQLite DB).
- Explore the API: browse Swagger UI at `<server>/api/docs`.

---

## Configuration

Configuration is environment-driven. See **[.env.example](.env.example)** and the
full table in **[docs/HANDOFF.md §6](docs/HANDOFF.md)**. Key values:

| Key | Purpose |
| --- | --- |
| `JWT_SECRET` | Token signing secret (set a strong one) |
| `AUTH_TOKEN_TTL` | Login token lifetime (default `30d`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded admin on first boot |
| `ALLOW_REGISTRATION` | Enable public self sign-up (`false` by default) |
| `DEFAULT_QUOTA_BYTES` | New-user quota (default 20 GB, `0` unlimited) |
| `MAX_REMOTE_BYTES` | Max add-by-URL file size |
| `DATA_DIR` / `DB_PATH` | Data + SQLite location |
| `CORS_ORIGIN` | Allowed browser origin |
| `MAX_UPLOAD_RATE` / `MAX_DOWNLOAD_RATE` | Bandwidth throttles (bytes/s) |
| `TORRENT_PORT` / `TORRENT_MAX_CONNS` | Swarm port + peer cap |

---

## Deployment

The backend is a **stateful, long-running process** (live peer connections,
on-disk SQLite, background downloads, range streaming). It must run on a VPS —
**not** a serverless platform. See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for
the full walk-through and **[docs/HANDOFF.md](docs/HANDOFF.md)** for the live setup.

### Quick deploy on Ubuntu (Docker)

```bash
sudo git clone https://github.com/Fran6jy/Awosanmo.git /opt/awosanmo
cd /opt/awosanmo
sudo bash deploy/oracle-ubuntu-setup.sh      # Docker, nginx, swap, firewall
sudo cp .env.example .env && sudo nano .env  # JWT_SECRET, ADMIN_PASSWORD, CORS_ORIGIN
sudo docker compose -f docker-compose.prod.yml up -d --build
curl -fsS http://127.0.0.1:4000/health       # -> {"ok":true}
```

Then put nginx in front (`deploy/nginx.conf`) and add HTTPS. Without a domain, a
**Cloudflare Tunnel** gives you HTTPS with no open 443:

```bash
cloudflared tunnel --url http://localhost:80   # ephemeral https URL
```

For a permanent URL, add a domain to Cloudflare and use a *named* tunnel, or run
`certbot` for TLS on your domain.

### About Vercel

Vercel is serverless and **cannot host the backend** (no persistent process, no
long-lived peer connections, ephemeral filesystem, short timeouts). Only the
static frontend can be deployed there, pointed at your VPS API via
`VITE_API_URL`. `vercel.json` is provided for that split. The VPS is not optional.

---

## Scaling, monitoring & maintenance

- **Monitoring:** `GET /health`, `GET /api/stats` (memory/uptime/torrent count),
  `GET /api/storage` (used/available). Container has a Docker healthcheck.
- **Runtime supervision:** production uses Docker Compose, not PM2. The
  `restart: unless-stopped` policy restarts the container after a crash or OOM
  exit; healthcheck failures are visible but do not by themselves restart Docker.
- **Logs:** structured JSON via pino (`docker logs`), plus nginx access/error logs.
- **Backups:** `deploy/backup.sh` + `awosanmo-backup.timer` snapshot the SQLite DB.
  Downloaded media is re-downloadable and not backed up by default.
- **Redeploy:** `git pull` + `docker compose build && up -d` (or
  `deploy/deploy-oracle.sh`). See the runbook in **[docs/HANDOFF.md §7](docs/HANDOFF.md)**.
- **Scaling up:** raise `TORRENT_MAX_CONNS`, `MAX_*_RATE`, and Node heap on a
  bigger VM. The architecture (repository-style modules, token-authed media,
  same-origin SPA) is ready for multi-user isolation and object storage later.

---

## Roadmap

Implemented: multi-user isolation + gated sign-up, refresh tokens, password
change, TOTP 2FA,
wishlist, torrent engine (magnet + `.torrent`), Seedr-style clipboard auto-paste,
streaming, uploads, add-by-URL, thumbnails, file manager (search/rename/delete/
bulk/ZIP/folders/context-menus/drag-to-folder/delete-confirm), video/audio/image/
PDF/text/EPUB viewing, themed file previews, header storage quota, low-cost fast
magnet mode, premium dark/light redesign, automatic completion cleanup, live
per-user updates, media probing, OpenAPI docs, automated tests, deploy tooling.

Fast mode is deliberately cheap: it improves perceived speed with optimistic UI,
immediate socket publication, and same-user duplicate reuse. It does **not** keep
a large shared Seedr-style cache of other users' torrents.

Not yet built: **OAuth** (blocked on a domain for a stable redirect URL), FTP/SFTP
fetch, cloud integrations, share links, RSS automation, plugin architecture. See
**[docs/HANDOFF.md §10](docs/HANDOFF.md)** for detail.

---

## License

Private. All rights reserved.
