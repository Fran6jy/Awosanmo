#!/usr/bin/env python3
"""Audit or remove completed, unselected and orphaned Awosanmo payloads."""

import argparse
import os
import shutil
import sqlite3
import time
from pathlib import Path


def size_of(root: Path) -> int:
    if root.is_file():
        return root.stat().st_size
    return sum(item.stat().st_size for item in root.rglob("*") if item.is_file())


def inside(root: Path, relative: str) -> Path:
    target = (root / relative).resolve()
    if target == root or root not in target.parents:
        raise ValueError(f"Unsafe database path: {relative}")
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--downloads", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--orphan-grace-hours", type=float, default=24)
    args = parser.parse_args()

    db = sqlite3.connect(args.database)
    db.row_factory = sqlite3.Row
    downloads = args.downloads.resolve()
    removed_bytes = 0
    candidates = 0

    completed = db.execute(
        "SELECT id, name FROM torrents WHERE status = 'completed' AND magnet_uri NOT LIKE 'local://%'"
    ).fetchall()
    for torrent in completed:
        root = downloads / torrent["id"]
        skipped = db.execute(
            "SELECT id, path FROM files WHERE torrent_id = ? AND selected = 0", (torrent["id"],)
        ).fetchall()
        for row in skipped:
            target = inside(root.resolve(), row["path"])
            amount = size_of(target) if target.exists() else 0
            print(f"UNSELECTED\t{amount}\t{torrent['name']}\t{row['path']}")
            candidates += 1
            removed_bytes += amount
            if args.apply:
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink(missing_ok=True)
                db.execute("DELETE FROM files WHERE id = ?", (row["id"],))

        selected = db.execute(
            "SELECT COUNT(*) FROM files WHERE torrent_id = ? AND selected = 1", (torrent["id"],)
        ).fetchone()[0]
        if selected == 0:
            amount = size_of(root) if root.exists() else 0
            print(f"EMPTY_TORRENT\t{amount}\t{torrent['name']}\t{torrent['id']}")
            candidates += 1
            removed_bytes += amount
            if args.apply:
                shutil.rmtree(root, ignore_errors=True)
                db.execute("DELETE FROM torrents WHERE id = ?", (torrent["id"],))

    owned = {row[0] for row in db.execute("SELECT id FROM torrents")}
    cutoff = time.time() - args.orphan_grace_hours * 3600
    for entry in downloads.iterdir():
        if not entry.is_dir() or entry.name in owned or entry.stat().st_mtime >= cutoff:
            continue
        amount = size_of(entry)
        print(f"ORPHAN\t{amount}\t{entry.name}")
        candidates += 1
        removed_bytes += amount
        if args.apply:
            shutil.rmtree(entry)

    if args.apply:
        db.commit()
    print(f"SUMMARY\tmode={'apply' if args.apply else 'dry-run'}\tcandidates={candidates}\tbytes={removed_bytes}")


if __name__ == "__main__":
    main()
