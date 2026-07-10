# Awosanmo — Operations & Handoff

A complete operational picture of the running system: how it's deployed, how to
run it day-to-day, what's implemented, what isn't, and the gotchas that will bite
you if you don't know them.

> **Security note:** this file lives in a **public** repository. It deliberately
> contains **no secrets** (no passwords, JWT secret, or tokens). All secrets live
> only in `/opt/awosanmo/.env` on the server. Never commit that file.

---

## 1. What Awosanmo is

A self-hosted, **multi-user** private cloud-torrenting, file-preview, and
streaming platform (a lightweight Seedr alternative). Paste a magnet link (or
upload a `.torrent`, or upload any file); the server downloads onto your VPS; you
stream, preview, or download it from anywhere. Accounts are fully siloed, with
optional 2FA. Built to run on the Oracle Cloud Free Tier (1 vCPU / 1 GB RAM).

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
- Public sign-up is off by default (`ALLOW_REGISTRATION=false` unless explicitly
  set to `true`). Users can change password from System → Change password.
- New regular users get `DEFAULT_QUOTA_BYTES` (20 GB by default); the seeded
  admin is unlimited (`quota_bytes = 0`).

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
- The HTTP IP intentionally works without CSP `upgrade-insecure-requests`; adding
  that directive back makes browsers fetch the SPA assets over HTTPS from the raw
  IP and can leave the page blank.
- **SQLite (WAL)** at `/var/lib/awosanmo/awosanmo.sqlite`; downloads under
  `/var/lib/awosanmo/downloads/<torrent-id>/`.
- Memory kept low: Node `--max-old-space-size=384`, streams everywhere, capped
  torrent connections, small SQLite page cache.
- Runtime supervision is Docker Compose, not PM2. `restart: unless-stopped`
  restarts the app container after an actual process/container crash or OOM
  exit. The Docker healthcheck marks bad states as unhealthy; it does not restart
  the container by itself.

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
        auth/              login/register, refresh tokens, 2FA (auth.ts, totp.ts)
        torrents/          WebTorrent engine + routes (user-scoped)
        streaming/         HTTP range streaming controller
        files/             list/rename/delete/bulk/move/zip + download/subtitle
        folders/           folders CRUD + move (user-scoped)
        uploads/           arbitrary file upload (streamed to disk)
        wishlist/          saved magnets to add later
        media/             ffprobe metadata worker
        storage/, search/, admin/, playback/
      openapi.ts           OpenAPI 3.0 spec (served at /api/docs)
      __tests__/           Vitest suites (auth, isolation)
  web/                     React + TS + Vite + Tailwind + Framer Motion SPA
    src/
      pages/               Dashboard, FilesPage, FileViewer, Player, TorrentDetail, System, Login
      components/          Shell, CommandPalette, LiveSync, Toast, ErrorBoundary,
                           ContextMenu, Wishlist, TwoFactorSettings
      lib/                 api.ts (fetch + upload + zip + refresh), socket.ts,
                           clipboard.ts, format.ts, fileTypes.ts
      styles.css           Premium dark/light design system utilities and global UI
deploy/                    nginx.conf, systemd units, Oracle setup + backup scripts
docs/                      DEPLOYMENT.md, HANDOFF.md (this file)
Dockerfile, docker-compose.yml, docker-compose.prod.yml, vercel.json
```

---

## 5. API surface

All `/api/*` routes require `Authorization: Bearer <token>` **except** `/api/login`,
`/api/register`, `/api/refresh`, `/api/login/2fa`, `/health`, the API docs, and the
token-in-query media routes. **Accounts are fully siloed** — every torrent, file,
folder, wishlist item, and search result is scoped to the authenticated user.

### Auth & accounts
- `POST /api/register` `{ email, password }` → `{ token }` plus an HttpOnly refresh cookie, only
  when `ALLOW_REGISTRATION=true`; otherwise 403
- `POST /api/login` `{ email, password }` → `{ token }` plus an HttpOnly refresh cookie, **or**
  `{ twoFactorRequired: true, ticket }` when 2FA is enabled
- `POST /api/account/password` `{ currentPassword, nextPassword }` → changes the
  current user's password and revokes refresh sessions
- `POST /api/login/2fa` `{ ticket, code }` → `{ token }` plus an HttpOnly refresh cookie
- `POST /api/refresh` uses the cookie → new `{ token }` and rotates the cookie
- `POST /api/logout` → 204, revokes and clears the refresh cookie

Access tokens are short-lived (1h); the SPA refreshes them transparently on 401
using the 30-day HttpOnly, SameSite cookie, which is whitelisted in the DB for
rotation/revocation and marked Secure on HTTPS. Access tokens stay in memory;
the SPA restores one from the cookie before mounting so page refreshes stay signed in.

### Two-factor (TOTP)
- `GET  /api/2fa/status` → `{ enabled }`
- `POST /api/2fa/setup` → `{ secret, otpauthUrl, qrDataUrl }` (begins enrollment)
- `POST /api/2fa/enable` `{ code }` → confirms with the first code
- `POST /api/2fa/disable` `{ code }` → turns 2FA off (requires a current code)

### Torrents
- `GET /api/torrents` — list
- `POST /api/torrents` `{ magnetUri }` — add magnet. Fast-mode behavior:
  returns `202` immediately, pushes the new row through Socket.IO, and reuses the
  caller's existing torrent row when the same magnet/info-hash is already known.
- `POST /api/torrents/upload` (multipart `torrent`) — add a `.torrent` file
- `GET /api/torrents/:id` — detail (peers, trackers, pieces, ETA, health)
- `GET /api/torrents/:id/files`
- `POST /api/torrents/:id/pause` · `/resume` · `/reannounce`
- `POST /api/torrents/files/:fileId/probe` — queue media probe
- `DELETE /api/torrents/:id?destroy=true|false`

Completed torrent behavior: when WebTorrent reports `done`, or progress reaches
`>= 0.999`, the backend marks the row `completed`, zeroes transfer speeds, stops
the active torrent with `destroyStore: false`, and leaves files on disk for the
library/viewer. Completed rows are not restored for seeding on app restart.

Completed file access: download, streaming, subtitles, ZIP export, and media
probing all resolve files through the shared `resolveDiskPath()` helper. It first
tries the DB path, then searches only that torrent's download directory for a
single matching filename/size and repairs the stored path. This prevents a
completed torrent from returning "File is not available yet" when WebTorrent's
on-disk path differs from the stored row.

Browser playback: `/api/stream/:id` still serves the original file for normal
HTML5 playback and range requests. `/api/transcode/:id` uses ffmpeg to emit a
fragmented MP4 (`H.264 + AAC`) for browser-hostile containers/codecs such as
MKV/HEVC/DD5.1. The React viewer selects transcode automatically for MKV/AVI/FLV
or after native playback errors. `MAX_TRANSCODES` defaults to `1` to protect the
1 GB VM; a second transcode request returns 429 until the active one closes.

Pause/resume behavior: pause is authoritative and sticky. The dashboard updates
optimistically on the first click. The backend writes the row to `paused`, zeroes
transfer speeds, calls WebTorrent pause when an active session exists, and
progress/metadata/download events are not allowed to flip it back to
`downloading`. Resume is the only action that restarts the row.

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
- `POST /api/uploads/url` `{ url }` — server-side fetch of a direct HTTP/HTTPS
  file URL. It blocks localhost/private IP targets, honors `MAX_REMOTE_BYTES`,
  enforces user quota, and stores the result in the user's uploads bucket.

### Wishlist
- `GET  /api/wishlist` — saved magnets
- `POST /api/wishlist` `{ magnetUri, name?, size? }` — save for later
- `DELETE /api/wishlist/:id`
- `POST /api/wishlist/:id/download` — add to downloads and remove from wishlist

### API documentation
- `GET /api/docs` — interactive Swagger UI
- `GET /api/openapi.json` — raw OpenAPI 3.0 spec

### Media tokens + delivery
- `POST /api/stream-token/:id` · `download-token/:id` · `subtitle-token/:id`
- `GET /api/stream/:id?st=<token>` — HTTP range / 206 streaming/preview for
  playable or inline-viewed files
- `GET /api/download/:id?dt=<token>`
- `GET /api/subtitle/:id?tt=<token>`
- `GET /api/thumbnail/:id?st=<token>` — token-protected thumbnail/poster
- `GET /api/zip?token=<zipToken>` — streamed zip of selected files

### Misc
- `GET /health` · `GET /api/stats` · `GET /api/storage` · `GET /api/search?q=`
- `GET /api/admin/status`

### WebSocket (Socket.IO, same origin, path `/socket.io`)
The handshake is **authenticated** with the access token (`auth.token`); each
socket joins a per-user room, so `torrents:update` and notifications are delivered
**only to their owner**. Server emits: `torrents:update` (that user's list ~1.5s),
`torrent:metadata`, `torrent:paused`, `torrent:resumed`, `torrent:removed`,
`notification`. The SPA feeds these into the React Query cache (`components/LiveSync.tsx`).

### Frontend routes and viewers
- `/files` — dense Seedr-style file manager with folders, search, bulk actions,
  right-click context menus, and download/rename/delete actions.
  - **Drag to move:** drag a file (or the whole current selection) onto a folder
    row or the "Library" breadcrumb to move it. During a drag the entire list
    accepts the drop (`dropEffect="move"`), so the cursor never flips to the red
    not-allowed icon; folders highlight as drop zones, a custom indigo "Move N
    files" ghost follows the cursor, and a bottom hint banner explains the action.
    A drop only moves when it lands on a folder/breadcrumb; anywhere else cancels.
  - **Delete confirmation:** every delete path (row button, context-menu Delete,
    and the bulk Delete bar) opens a confirmation modal before removing files.
- `/view/:id` — unified viewer. Supports video, audio, images, PDFs, text-like
  files, and EPUBs. EPUB rendering uses `epubjs`.
- `/watch/:id` — compatibility route that now delegates to `/view/:id`.
- Dashboard hides the `local-uploads` pseudo-torrent, so direct uploads do not
  appear with pause/reannounce controls after they complete.
- Dashboard hides completed torrent rows from the active Downloads panel; the
  downloaded files remain available under `/files`.
- Dashboard uses optimistic magnet rows, so a new magnet appears as "Fetching
  metadata" immediately instead of waiting for the next poll/socket tick.

### Frontend visual system
- Premium dark Plex/Linear-style aesthetic: near-black `#07070C` base, indigo
  `#6366F1` accent, light text, subtle indigo aurora glow, and a faint green tint.
- Light mode is also supported with a persistent header toggle. The selected
  theme is stored in `localStorage.theme` and applied through
  `document.documentElement.dataset.theme` before React renders.
- Typography uses Plus Jakarta Sans across the app.
- Shared utility classes keep controls consistent: `.btn-primary`, `.btn-ghost`,
  `.btn-danger`, `.icon-btn`, `.field`, `.chip`, and `.card`.
- Surfaces use translucent glass, backdrop blur, hairline borders, soft depth
  shadows, and custom dark scrollbars.
- **Floating overlays** (modals, dropdowns, the right-click menu) use the opaque
  `.panel` surface + `.scrim` backdrop rather than translucent glass, so content
  underneath never bleeds through. Use `.panel`/`.scrim` for any new overlay.
- Sidebar is reduced to three main nav items: Dashboard, Files, and System, with
  active-route highlighting and a gradient logo.
- Dashboard has no Recent files panel. It uses elevated stat cards, a clean
  command bar for magnet entry, premium torrent rows, status-colored labels, and
  a proper empty state.
- System page has no Recent Activity panel and uses a wider Runtime grid.
- `/view/:id` uses the same theme system, including image previews on a neutral
  viewer canvas instead of the old bright/purple frame.

---

## 6. Environment variables (`/opt/awosanmo/.env`)

| Key | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | `production` | — |
| `PORT` | API port inside container | `4000` |
| `DATA_DIR` / `DB_PATH` | data + sqlite location | `/data` (container) → `/var/lib/awosanmo` (host) |
| `CORS_ORIGIN` | allowed browser origin | set to your URL |
| `JWT_SECRET` | signing secret for all tokens | **must be strong** |
| `ACCESS_TOKEN_TTL` | access token lifetime | `1h` |
| `REFRESH_TOKEN_TTL` / `REFRESH_TOKEN_TTL_MS` | refresh token lifetime | `30d` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seeded admin (first boot only) | — |
| `ALLOW_REGISTRATION` | public self sign-up gate | `false` |
| `DEFAULT_QUOTA_BYTES` | per-user quota for new users (`0` = unlimited) | 20 GB |
| `MAX_REMOTE_BYTES` | max add-by-URL fetch size | 8 GB |
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

### Crash / OOM recovery
Production runs detached under Docker Compose with `restart: unless-stopped`.
If the Node process exits, or the kernel kills the container for memory pressure,
Docker should restart it automatically within a few seconds. Downloads and the
SQLite database live on `/var/lib/awosanmo`, so they survive container restarts.

Check restart/health state:
```bash
sudo docker inspect --format '{{.RestartCount}} {{.State.Status}} {{.State.Health.Status}}' awosanmo-awosanmo-1
sudo docker logs --tail 100 awosanmo-awosanmo-1
```

Important caveat: Docker does not restart a container merely because its
healthcheck says `unhealthy`. Add an external auto-heal/watchdog later if that
behavior is required.

### Change the admin password
The admin is seeded **once**. To reset it, delete **only the admin row** (never
`DELETE FROM users` — that wipes every account now that it's multi-user), set a
new `ADMIN_PASSWORD`, and restart so it re-seeds. This removes the admin login
but not their files (which are re-owned on the next boot's backfill).
```bash
cd /opt/awosanmo
sudo docker compose -f docker-compose.prod.yml down
sudo sqlite3 /var/lib/awosanmo/awosanmo.sqlite "DELETE FROM users WHERE email='admin@awosanmo.local';"
sudo nano .env   # set a new ADMIN_PASSWORD
sudo docker compose -f docker-compose.prod.yml up -d
```
(2FA users who lose their device can be reset with
`UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE email='…';`.)

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
- **Fast mode is not a Seedr shared cache.** It costs almost no extra storage:
  optimistic rows, immediate Socket.IO publication, and same-user duplicate
  magnet/info-hash reuse. Instant access to uncached public torrents still
  depends on swarm health, trackers, DHT, and the 1 GB VM's network/CPU/RAM.
- **Docker workspace deps.** Some npm deps (e.g. `archiver`) are not hoisted to
  the root `node_modules`; the Dockerfile explicitly copies `apps/api/node_modules`.
  If you add a dep that lands there, that copy already covers it.
- **`archiver` must stay on v7.** v8 dropped the callable factory export; the zip
  controller loads it via `createRequire`.
- **Line endings.** Git warns about LF→CRLF on Windows checkouts; harmless.
- **CJS deps loaded via `createRequire`.** `archiver`, `otplib`, `qrcode`, and
  `swagger-ui-express` don't provide clean ESM default exports, so they're loaded
  with `createRequire(import.meta.url)`. Follow that pattern for new CJS deps.
- **Never `DELETE FROM users` on the live DB** — it now removes every account.
  See the admin-password runbook for the scoped reset.
- **EPUB reader dependency.** EPUB preview uses `epubjs`. It works in-browser,
  but its dependency tree currently reports npm audit warnings, including
  high-severity findings. Treat this as acceptable only for a private single-user
  deployment, or replace/sandbox the EPUB renderer before hardening for broader
  production.
- **`probe_status` meaning.** Only video/audio files are ffprobe-scanned. Older
  non-media rows that had the default `pending` value are migrated to `ready` so
  PDFs, EPUBs, images, and text files do not look stuck.

---

## 9. Changelog

### Multi-tenant & security feature batch
- **Multi-user isolation:** `user_id` ownership on torrents/files/folders;
  every read and mutation scoped per user; per-user uploads bucket; media tokens
  and zip tickets honored only for the owner; socket handshake authenticated and
  torrent updates delivered per-user (fixed a prior broadcast-to-everyone leak).
- **Security lockdown:** self sign-up is gated by `ALLOW_REGISTRATION`; users can
  change passwords from System; regular users get quota defaults while the seeded
  admin is unlimited.
- **Add-by-URL + thumbnails:** direct HTTP/HTTPS file fetches are available from
  Dashboard/Files with per-hop redirect validation, DNS-pinned SSRF/private-IP
  protection, byte caps, and atomic quota reservations;
  media probing now generates thumbnails served via token-authenticated URLs.
- **Refresh tokens:** 1h access + 30d refresh (DB-whitelisted, rotating); the
  refresh token is an HttpOnly/SameSite cookie (Secure over HTTPS), access tokens
  are memory-only, and sidebar **logout** revokes server-side.
- **2FA (TOTP):** enroll from the System page (QR via `otplib`/`qrcode`), a
  two-step coded login, and disable — all code-verified.
- **Wishlist:** save magnets to add later (header star + panel).
- **OpenAPI/Swagger:** spec at `/api/openapi.json`, UI at `/api/docs`.
- **Automated tests:** Vitest covers auth/token scopes, refresh, 2FA, isolation,
  SSRF address guards, quota reservations, rename collisions, and byte ranges.

### Fixes made during initial build/deploy

- **Premium dark redesign:** rebuilt the SPA around a Plex/Linear-style dark
  design system using Plus Jakarta Sans, near-black surfaces, indigo accent,
  glass cards, refined scrollbars, reusable component classes, simplified
  sidebar navigation, dashboard stat cards, and cleaned System runtime layout.
- **Overlay + file-manager interaction pass:** made all floating overlays opaque
  (`.panel`/`.scrim`) so the right-click menu/modals no longer show content
  bleeding through; added drag-a-file-onto-a-folder moves with clear affordances
  (list-wide `dropEffect=move` to kill the not-allowed cursor, folder drop-zone
  highlights, a "Move N files" ghost, and a hint banner); and added a delete
  confirmation modal across all delete paths.
- **Light theme + themed viewer:** added a persistent dark/light toggle and
  updated the file viewer so image/PDF/text/audio/EPUB pages use the shared
  design system instead of the old light-only preview shell.
- **Low-cost fast magnet mode:** magnet submits now feel instant via optimistic
  dashboard rows, immediate Socket.IO publication, and same-user duplicate
  magnet/info-hash reuse. This does not create a large Seedr-style shared cache.
- **Seedr-style completion cleanup:** torrents now auto-finalize at completion,
  stop seeding while preserving downloaded files, and disappear from active
  dashboard transfers.
- **Completed-file path healing:** download/stream/ZIP/probe now repair stale
  torrent file paths by matching the actual completed file inside the torrent
  folder, avoiding false "File is not available yet" responses.
- **MKV/HEVC browser playback:** added `/api/transcode/:id` and automatic viewer
  fallback for MKV/AVI/FLV/HEVC files; the file list shows "browser transcode"
  instead of a raw probe `failed` label for these playable-but-not-native videos.
- **Sticky pause/resume:** pause now updates on the first click in the dashboard,
  zeroes speeds, and cannot be overwritten back to downloading by later
  WebTorrent progress/metadata events; resume is explicit.
- **Seedr-style UX pass:** dense file table, fixed dashboard overflow, header
  storage quota, and click-to-auto-paste magnet behavior over HTTPS.
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

Blocked on a domain:
- **OAuth (Google/GitHub login)** — needs a fixed pre-registered redirect URL
  (the ephemeral tunnel changes on restart) and your OAuth app credentials.

Resource-dependent (free software, but heavy on a 1 vCPU / 1 GB VM):
- **Thumbnails / posters / filmstrip** — fine if generation is throttled/queued.
- **On-the-fly transcoding** — ffmpeg is in the image, but real-time HD transcode
  will likely struggle on this hardware; plan a bigger VM if truly needed.

Nice-to-have:
- Nested-folder move picker as a tree (currently a flat list).
- Remote URL / FTP / SFTP fetch, cloud-storage integrations, share links, RSS,
  plugin architecture (see the original spec).

Done since the first handoff: wishlist, refresh tokens, multi-user isolation,
2FA, OpenAPI docs, automated tests, file previews, EPUB reader, clipboard
auto-paste, header storage quota, premium dark redesign, light theme toggle,
low-cost fast magnet mode, Seedr-style completion cleanup, opaque overlays,
drag-and-drop into folders, and a delete confirmation modal.

---

## 11. Security posture & TODO

**In place:** per-user isolation, authenticated per-user WebSocket, HttpOnly-cookie
refresh rotation + revocation, optional TOTP 2FA, strict scoped media tokens,
helmet, rate limiting, input validation, path-traversal guards, DNS-pinned SSRF
protection, atomic quota reservations, and validated HTTP byte ranges.

**Still to do before treating this as public production:**
1. Rotate the seeded admin password and `JWT_SECRET` if either has ever been shared.
2. Move to HTTPS with a real domain (named Cloudflare tunnel or certbot); then
   close the direct HTTP `:80` path.
3. Keep `ALLOW_REGISTRATION=false` unless intentionally opening account creation.
4. Review the `epubjs` dependency audit findings (§8) before broad exposure.
