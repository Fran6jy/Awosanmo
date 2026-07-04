# Awosanmo

A self-hosted private cloud torrenting & streaming platform. Paste a magnet link, the
server joins the swarm on your VPS, and you stream the video from anywhere — with
sequential downloading so playback starts before the download finishes.

> **Status:** early development. The backend foundation (config, SQLite schema,
> structured logging) is in place; the torrent engine, streaming controller, auth,
> WebSocket layer, and React frontend are in progress.

## Target environment

Built to run on a minimal VPS (the Oracle Cloud Free Tier in particular):

- Ubuntu 24.04 LTS · 1 vCPU · 1 GB RAM · 100 GB SSD · 2 GB swap

Everything is optimized for low memory: Node streams end-to-end, no full-file
buffering, WAL SQLite with a small page cache, and capped torrent connections.

## Monorepo layout

```
apps/
  server/   Node.js + Express + TypeScript API, WebTorrent engine, streaming
  web/       React + TypeScript + Vite frontend (in progress)
deploy/      Dockerfile, docker-compose, systemd, nginx, PM2 configs
```

## Development

```bash
npm install
cp .env.example .env      # then edit secrets
npm run dev               # runs server + web together
```

## Deployment

The **backend is a long-running stateful process** (persistent torrent swarm
connections, on-disk SQLite, background downloads, range streaming from disk). It
must run on your VPS via Docker / systemd / PM2 — see `deploy/` and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### About Vercel

Vercel is **serverless** and cannot host the backend (no persistent process, no
long-lived TCP peer connections, ephemeral filesystem, short function timeouts).
Only the static frontend (`apps/web`) can be deployed to Vercel, pointed at your
VPS API via `VITE_API_BASE_URL`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## License

Private. All rights reserved.
