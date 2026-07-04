#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/awosanmo}"
DATA_DIR="${DATA_DIR:-/var/lib/awosanmo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

cd "$APP_DIR"

if [ ! -f ".env" ]; then
  echo "Missing $APP_DIR/.env. Copy .env.example to .env and set production secrets first."
  exit 1
fi

install -d "$DATA_DIR" "$DATA_DIR/backups"
docker compose -f "$COMPOSE_FILE" build --pull
docker compose -f "$COMPOSE_FILE" up -d
docker compose -f "$COMPOSE_FILE" ps
curl -fsS http://127.0.0.1:4000/health >/dev/null
echo "Awosanmo deployed and healthy."
