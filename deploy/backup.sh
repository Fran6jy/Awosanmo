#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/awosanmo}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"

if [ -f "$DATA_DIR/awosanmo.sqlite" ]; then
  sqlite3 "$DATA_DIR/awosanmo.sqlite" ".backup '$BACKUP_DIR/awosanmo-$STAMP.sqlite'"
  gzip -f "$BACKUP_DIR/awosanmo-$STAMP.sqlite"
fi

find "$BACKUP_DIR" -type f -name "awosanmo-*.sqlite.gz" -mtime +"$KEEP_DAYS" -delete
echo "Backup complete: $BACKUP_DIR"
