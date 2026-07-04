# Deployment

Awosanmo has two deployable pieces with very different hosting needs.

## 1. Backend — runs on your VPS (required)

The API server is a **stateful, long-running process**:

- It holds live TCP connections to torrent swarm peers.
- It writes downloads to local disk and reads them back for range streaming.
- It keeps a persistent SQLite database file.
- Downloads and streams last minutes to hours.

None of this is compatible with serverless platforms. Run it on the Oracle Ubuntu
VPS using one of the configs in `deploy/`:

- **systemd** — `deploy/awosanmo.service`
- **Docker** — `deploy/Dockerfile` + `deploy/docker-compose.yml`
- **PM2** — `deploy/ecosystem.config.cjs`
- **nginx** reverse proxy + TLS — `deploy/nginx.conf`

(These files are generated as backend work lands.)

## 2. Frontend — optionally on Vercel

The `apps/web` build is a static SPA and *can* be hosted on Vercel or any CDN. It
must be told where the backend lives:

```
VITE_API_BASE_URL=https://your-vps-domain.example.com
```

`vercel.json` at the repo root scopes the build to `apps/web` and rewrites SPA
routes. **Note:** streaming, WebSockets, and downloads still go directly to your
VPS — Vercel only serves the HTML/JS/CSS shell.

### Why not the whole app on Vercel?

| Requirement                        | Vercel (serverless) |
| ---------------------------------- | ------------------- |
| Long-lived peer TCP connections    | ❌ not supported    |
| Persistent local filesystem        | ❌ ephemeral        |
| Multi-minute streaming responses   | ❌ function timeout |
| Background download workers        | ❌ no daemon        |
| Persistent SQLite on disk          | ❌ ephemeral        |

The VPS is not optional for the backend — it is the product.
