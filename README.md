# Awosanmo

Awosanmo is a self-hosted private cloud torrenting and streaming platform for a small Ubuntu VPS. It is built as a TypeScript monorepo with a Node/Express API, WebTorrent engine, SQLite persistence, range-based streaming, Socket.IO live updates, and a React/Vite dashboard.

Only `fran6` is listed as project author/contributor in package metadata.

## Apps

- `apps/api`: Express API, auth, SQLite schema, torrent orchestration, streaming range endpoint.
- `apps/web`: React dashboard with dark glass UI, torrent intake, file browser, and video player.
- `deploy`: systemd and Nginx production deployment examples.

## Quick Start

```bash
npm install
npm run dev --workspace @awosanmo/api
npm run dev --workspace @awosanmo/web
```

Default login:

```text
admin@awosanmo.local
change-me-now
```

Change `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` before exposing the service.

## API

- `POST /api/login`
- `POST /api/torrents`
- `GET /api/torrents`
- `GET /api/torrents/:id`
- `GET /api/torrents/:id/files`
- `POST /api/torrents/:id/pause`
- `POST /api/torrents/:id/resume`
- `DELETE /api/torrents/:id`
- `GET /api/files`
- `GET /api/files?q=search`
- `PATCH /api/files/:id`
- `DELETE /api/files/:id`
- `POST /api/stream-token/:id`
- `POST /api/download-token/:id`
- `POST /api/subtitle-token/:id`
- `GET /api/stream/:id`
- `GET /api/download/:id`
- `GET /api/subtitle/:id`
- `GET /api/playback/:fileId`
- `PUT /api/playback/:fileId`
- `GET /api/admin/status`
- `GET /api/search?q=query`
- `GET /api/stats`
- `GET /api/storage`

Streaming uses short-lived stream tokens, HTTP range requests, `206 Partial Content`, 64KB stream chunks, and no full-file buffering.

In production, the API also serves the built React app from `apps/web/dist`, so the Docker image can run as a single small service behind Nginx.

## Media Metadata

Awosanmo runs a lightweight `ffprobe` worker for streamable files. It stores duration, video/audio codecs, resolution, bitrate, frame rate, and audio/subtitle track counts in SQLite. The worker scans one file at a time and is controlled by:

- `MEDIA_SCAN_INTERVAL_SECONDS`
- `MEDIA_PROBE_TIMEOUT_SECONDS`

This keeps probing gentle enough for a 1GB Oracle VM.

## Interface

The dashboard includes a global command palette. Press `Ctrl+K` to search torrents, files, videos, and core navigation actions.

## Oracle Free Tier Notes

- Keep upload rate low with `MAX_UPLOAD_RATE`.
- Use a swap file on 1GB RAM machines.
- Put `DATA_DIR` on the 100GB block volume.
- Keep concurrent torrents modest. WebTorrent is capped to conservative connection counts in `TorrentService`.
- FFmpeg is included in deployment images, but expensive transcodes should be queued and limited on 1 vCPU.
- Use `.env.example` as the starting point for production configuration.

## Docker

```bash
docker compose up -d --build
```

For Oracle Ubuntu deployment, use:

[deploy/ORACLE_VPS.md](deploy/ORACLE_VPS.md)

## Production Checklist

- Replace all default secrets.
- Put Nginx in front of the API and built web app.
- Enable TLS with Certbot.
- Set firewall rules for SSH, HTTP, HTTPS, and required torrent traffic.
- Back up `/data/awosanmo.sqlite` and downloaded media metadata.
- Monitor memory, disk, and open file handles.

## Roadmap

The foundation is intentionally modular. Next production increments should add torrent-file bencode parsing, FFmpeg metadata workers, poster/thumbnail extraction, OpenAPI generation, user storage quotas, share links, richer admin controls, and visual torrent detail pages.
