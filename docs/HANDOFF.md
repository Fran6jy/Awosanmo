# Awosanmo — Operations & Handoff

A complete operational picture of the running system: how it's deployed, how to
run it day-to-day, what's implemented, what isn't, and the gotchas that will bite
you if you don't know them.

> **Security note:** this file lives in a **public** repository. It deliberately
> contains **no secrets** (no passwords, JWT secret, or tokens). All secrets live
> only in `/opt/awosanmo/.env` on the server. Never commit that file.

---

## 1. What Awosanmo is

A self-hosted private cloud-torrenting, file-preview, and streaming platform (a
lightweight Seedr alternative). Paste a magnet link (or upload a `.torrent`, or
upload any file); the server downloads onto your VPS; you stream, preview, or
download it from anywhere. Built to run on the Oracle Cloud Free Tier (1 vCPU /
1 GB RAM).

---

## 2. Live deployment (as of this handoff)

| Item | Value |
| --- | --- |
| Repo | https://github.com/Fran6jy/Awosanmo (public) |
| Server | Oracle Cloud VM, Ubuntu 20.04, 1 vCPU / ~1 GB RAM / 100 GB disk / 2 GB swap |
| Public IP | `145.241.232.240` |
| App URL (HTTP) | `http://145.241.232.240` |
| App URL (HTTPS) | Cloudflare quick tunnel — **ephemeral, changes on tunnel restart** |
| SSH | `ssh -i <oracle-key> ubuntu@145.241.232.240` |
| App directory | `/opt/awosanmo` (owned by the `awosanmo` service user) |
| Data directory | `/var/lib/awosanmo` (SQLite DB, `downloads/`, `backups/`) |
| Runtime | Docker Compose (`docker-compose.prod.yml`), container `awosanmo-awosanmo-1` |
| Reverse proxy | nginx on port 80 → `127.0.0.1:4000` |
| HTTPS tunnel | `awosanmo-tunnel.service` (systemd) running `cloudflared` |

### Credentials
- Admin email/password: in `/opt/awosanmo/.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`).
- The admin user is **seeded once** on first boot from those values. Changing
  `.env` afterwards does **not** change an existing user's password — see §7.

### Get the current HTTPS tunnel URL
```bash
sudo journalctl -u awosanmo-tunnel.service --no-pager | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1
```

---

## 3. Architecture

```
Browser ──HTTP:80──> nginx ──> 127.0.0.1:4000 (Docker container)
   │                                   │
   └──HTTPS──> Cloudflare tunnel ──────┘        Node/Express API + WebTorrent
                                                 + Socket.IO + better-sqlite3
                                                 serves the built React SPA
```

- **One container** runs the API *and* serves the built frontend from the same
  origin (`apps/web/dist`). No separate web server needed.
- **nginx** is the public entry on port 80 (streaming, WebSocket upgrade, large
  uploads all configured).
- **Cloudflare tunnel** provides HTTPS without a domain or open 443.
- **SQLite (WAL)** at `/var/lib/awosanmo/awosanmo.sqlite`; downloads under
  `/var/lib/awosanmo/downloads/<torrent-id>/`.
- Memory kept low: Node `--max-old-space-size=384`, streams everywhere, capped
  torrent connections, small SQLite page cache.

---

## 4. Repository layout

```
apps/
  api/                     Node + Express + TypeScript backend
    src/
      server.ts            App wiring, routes, static SPA serving
      config.ts            Env-driven config
      db/schema.ts         SQLite schema + idempotent migrations
      modules/
        auth/              JWT login, token guards (stream/download/subtitle)
        torrents/          WebTorrent engine + routes
        streaming/         HTTP range streaming controller
        files/             list/rename/delete/bulk/move/zip + download/subtitle
        folders/           folders CRUD + move
        uploads/           arbitrary file upload (streamed to disk)
        media/             ffprobe metadata worker
        storage/, search/, admin/, playback/
  web/                     React + TS + Vite + Tailwind + Framer Motion SPA
    src/
      pages/               Dashboard, FilesPage, FileViewer, Player, TorrentDetail, System, Login
      components/          Shell, CommandPalette, LiveSync, Toast, ErrorBoundary, ContextMenu
      lib/                 api.ts (fetch + upload + zip), socket.ts, format.ts, fileTypes.ts
deploy/                    nginx.conf, systemd units, Oracle setup + backup scripts
docs/                      DEPLOYMENT.md, HANDOFF.md (this file)
Dockerfile, docker-compose.yml, docker-compose.prod.yml, vercel.json
```

---

## 5. API surface

All `/api/*` routes require `Authorization: Bearer <token>` **except** `/api/login`,
`/health`, and the token-in-query media routes.

### Auth
- `POST /api/login` `{ email, password }` → `{ token }` (JWT, 30-day default)

### Torrents
- `GET /api/torrents` — list
- `POST /api/torrents` `{ magnetUri }` — add magnet
- `POST /api/torrents/upload` (multipart `torrent`) — add a `.torrent` file
- `GET /api/torrents/:id` — detail (peers, trackers, pieces, ETA, health)
- `GET /api/torrents/:id/files`
- `POST /api/torrents/:id/pause` · `/resume` · `/reannounce`
- `POST /api/torrents/files/:fileId/probe` — queue media probe
- `DELETE /api/torrents/:id?destroy=true|false`

### Files
- `GET /api/files?q=<search>&folderId=root|<id>`
- `GET /api/files/:id` — file metadata for the preview route
- `PATCH /api/files/:id` `{ name }` — rename
- `DELETE /api/files/:id`
- `POST /api/files/bulk-delete` `{ ids: [] }`
- `POST /api/files/move` `{ ids: [], folderId: <id>|null }`
- `POST /api/files/zip-token` `{ ids: [] }` → `{ zipToken }`

### Folders
- `GET /api/folders?parent=root|<id>` → `{ folders, breadcrumb }`
- `GET /api/folders?all=1` → flat list (move picker)
- `POST /api/folders` `{ name, parentId? }`
- `PATCH /api/folders/:id` `{ name }`
- `DELETE /api/folders/:id` (files return to root; subfolders cascade)

### Uploads
- `POST /api/uploads` (multipart `file`) — any file, streamed to disk

### Media tokens + delivery
- `POST /api/stream-token/:id` · `download-token/:id` · `subtitle-token/:id`
- `GET /api/stream/:id?st=<token>` — HTTP range / 206 streaming/preview for
  playable or inline-viewed files
- `GET /api/download/:id?dt=<token>`
- `GET /api/subtitle/:id?tt=<token>`
- `GET /api/zip?token=<zipToken>` — streamed zip of selected files

### Misc
- `GET /health` · `GET /api/stats` · `GET /api/storage` · `GET /api/search?q=`
- `GET /api/admin/status`

### WebSocket (Socket.IO, same origin, path `/socket.io`)
Server emits: `torrents:update` (full list ~1.5s), `torrent:metadata`,
`torrent:paused`, `torrent:resumed`, `torrent:removed`, `notification`.
The SPA feeds these into the React Query cache (`components/LiveSync.tsx`).

### Frontend routes and viewers
- `/files` — dense Seedr-style file manager with folders, search, bulk actions,
  right-click context menus, and download/rename/delete actions.
- `/view/:id` — unified viewer. Supports video, audio, images, PDFs, text-like
  files, and EPUBs. EPUB rendering uses `epubjs`.
- `/watch/:id` — compatibility route that now delegates to `/view/:id`.
- Dashboard hides the `local-uploads` pseudo-torrent, so direct uploads do not
  appear with pause/reannounce controls after they complete.

---

## 6. Environment variables (`/opt/awosanmo/.env`)

| Key | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | `production` | — |
| `PORT` | API port inside container | `4000` |
| `DATA_DIR` / `DB_PATH` | data + sqlite location | `/data` (container) → `/var/lib/awosanmo` (host) |
| `CORS_ORIGIN` | allowed browser origin | set to your URL |
| `JWT_SECRET` | token signing secret | **must be strong** |
| `AUTH_TOKEN_TTL` | login token lifetime | `30d` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seeded admin (first boot only) | — |
| `MAX_DOWNLOAD_RATE` / `MAX_UPLOAD_RATE` | bytes/s (0 = unlimited down) | `0` / `65536` |
| `MAX_UPLOAD_BYTES` | max direct file upload | 8 GB |
| `TORRENT_PORT` | swarm peer port | `51413` |
| `TORRENT_MAX_CONNS` | peer connection cap | `30` |
| `STREAM_TOKEN_TTL_SECONDS` | media token lifetime | `3600` |
| `MEDIA_SCAN_INTERVAL_SECONDS` / `MEDIA_PROBE_TIMEOUT_SECONDS` | ffprobe worker | `45` / `20` |

---

## 7. Operations runbook

All commands run on the VM over SSH. The repo dir is owned by the `awosanmo`
user, so most git/docker commands need `sudo`.

### Redeploy latest code
```bash
cd /opt/awosanmo
sudo git pull origin main
sudo docker compose -f docker-compose.prod.yml build
sudo docker compose -f docker-compose.prod.yml up -d
sudo docker inspect --format '{{.State.Health.Status}}' awosanmo-awosanmo-1
```
Or use the helper: `sudo bash deploy/deploy-oracle.sh`.

### Logs
```bash
sudo docker logs --tail 100 -f awosanmo-awosanmo-1        # app
sudo tail -f /var/log/nginx/{access,error}.log            # nginx
sudo journalctl -u awosanmo-tunnel.service -f             # tunnel
```

### Restart / stop
```bash
sudo docker compose -f docker-compose.prod.yml restart
sudo docker compose -f docker-compose.prod.yml down
```

### Change the admin password
The admin is seeded **once**. To change an existing password, update the DB hash.
Easiest path: stop the app, delete the users row, set a new `ADMIN_PASSWORD` in
`.env`, restart (it re-seeds). This wipes only the login user, not files.
```bash
cd /opt/awosanmo
sudo docker compose -f docker-compose.prod.yml down
sudo sqlite3 /var/lib/awosanmo/awosanmo.sqlite "DELETE FROM users;"
sudo nano .env   # set a new ADMIN_PASSWORD
sudo docker compose -f docker-compose.prod.yml up -d
```

### Rotate/replace the HTTPS tunnel
The quick-tunnel URL changes whenever the service restarts:
```bash
sudo systemctl restart awosanmo-tunnel.service
# then read the new URL (see §2)
```
For a **permanent** URL you need a domain on Cloudflare and a *named* tunnel
(replace the `ExecStart` in `/etc/systemd/system/awosanmo-tunnel.service`).

### Backups
`deploy/backup.sh` + `awosanmo-backup.timer` snapshot the SQLite DB to
`/var/lib/awosanmo/backups`. Downloads themselves are not backed up (they're
re-downloadable). Verify the timer: `systemctl list-timers | grep awosanmo`.

### Firewall (Oracle-specific — critical)
Two layers must both allow a port:
1. **Oracle VCN Security List / NSG** (cloud console) — 80, 443, 22, 51413.
2. **Host iptables** — Oracle's base image has a `REJECT all` rule that sits
   *above* ufw. ACCEPT rules for 80/443/51413 were inserted **above** that REJECT
   and persisted via `netfilter-persistent`. If you add ports, insert them above
   the REJECT (check order with `sudo iptables -L INPUT --line-numbers`).

---

## 8. Known gotchas

- **Ephemeral HTTPS URL.** The Cloudflare quick tunnel changes on restart. Not a
  permanent address — get a domain for a stable named tunnel.
- **Clipboard / Notifications need HTTPS.** Copy-download-link and desktop
  notifications only work over the tunnel (secure context), not over `http://IP`.
  Magnet auto-paste also needs HTTPS. The code guards this (falls back to a
  prompt for copy links; skips notifications/clipboard read when unsupported).
- **Large uploads via the tunnel** are capped ~100 MB by Cloudflare's free plan.
  Use the direct IP (nginx has no size cap) or a paid Cloudflare plan for big files.
- **Docker workspace deps.** Some npm deps (e.g. `archiver`) are not hoisted to
  the root `node_modules`; the Dockerfile explicitly copies `apps/api/node_modules`.
  If you add a dep that lands there, that copy already covers it.
- **`archiver` must stay on v7.** v8 dropped the callable factory export; the zip
  controller loads it via `createRequire`.
- **Line endings.** Git warns about LF→CRLF on Windows checkouts; harmless.
- **Socket has no per-connection auth.** `torrents:update` is broadcast to any
  connected socket. Fine for single-user; tighten before multi-user.
- **EPUB reader dependency.** EPUB preview uses `epubjs`. It works in-browser,
  but its dependency tree currently reports npm audit warnings, including
  high-severity findings. Treat this as acceptable only for a private single-user
  deployment, or replace/sandbox the EPUB renderer before hardening for broader
  production.
- **`probe_status` meaning.** Only video/audio files are ffprobe-scanned. Older
  non-media rows that had the default `pending` value are migrated to `ready` so
  PDFs, EPUBs, images, and text files do not look stuck.

---

## 9. Changelog — fixes made during initial build/deploy

- **Seedr-style UX pass:** premium light file-manager UI, dense file table,
  fixed dashboard overflow, header storage quota, and click-to-auto-paste magnet
  behavior over HTTPS.
- **Unified file viewer:** added `/view/:id` for video, audio, image, PDF, text,
  and EPUB files. Audio uploads are now streamable/playable; EPUBs render
  in-browser via `epubjs`.
- **Upload/torrent state cleanup:** direct uploads are grouped in
  `local-uploads` but hidden from dashboard torrent controls; completed torrents
  no longer show pause/reannounce buttons; non-media file probe status is marked
  ready instead of pending.
- Harden torrent engine: handle WebTorrent `error` events (no more process crash
  on `EADDRINUSE`); cap peer connections via `TORRENT_MAX_CONNS`.
- Frontend API base defaults to **same-origin** in production (was hardcoded to
  `localhost:4000`, breaking every browser call behind the proxy/tunnel).
- Wire real **Socket.IO** live updates into the SPA (was polling only).
- **Auth silent-failure fix:** 15-min tokens with no refresh + swallowed 401s made
  "nothing happens" bugs. Token TTL now 30 days; client redirects to login on 401.
- **Blank-page fix #1:** auth guard ran before hooks; clearing the token on 401
  changed the hook count and crashed React. Guards moved below all hooks.
- **Blank-page fix #2 (HTTP only):** `Notification.requestPermission()` threw
  synchronously in an insecure context inside a `useEffect`. Guarded by
  `isSecureContext` + try/catch, and added a top-level **ErrorBoundary**.
- **ZIP fixes:** pinned `archiver@7`, loaded via `createRequire`, and copied
  `apps/api/node_modules` in the Dockerfile.

---

## 10. Roadmap — not yet built

Requested / high-value:
- **Wishlist** (save magnets to add later; needs a small table).
- **Thumbnails / posters / filmstrip** and **on-the-fly transcoding** (ffmpeg is
  in the image; the pipeline isn't built).

Larger / future:
- Refresh tokens, multi-user storage isolation, 2FA / OAuth.
- Nested-folder move picker as a tree (currently a flat list).
- Drag-and-drop into folders.
- OpenAPI/Swagger docs and automated tests (vitest is set up; no suites yet).
- Remote URL / FTP / SFTP fetch, cloud-storage integrations, share links, RSS,
  plugin architecture (see the original spec).

---

## 11. Security TODO before treating this as production

1. Change the seeded admin password (§7) and set a strong `JWT_SECRET`.
2. Move to HTTPS with a real domain (named Cloudflare tunnel or certbot).
3. Add per-connection Socket.IO auth if you add users.
4. Consider closing the direct HTTP `:80` path once HTTPS is stable.
