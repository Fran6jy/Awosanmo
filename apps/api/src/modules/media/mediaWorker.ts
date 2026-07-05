import fs from "node:fs";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";
import { resolveDiskPath } from "../files/fileService.js";
import { probeMedia } from "./mediaProbe.js";

type FileRow = {
  id: string;
  torrent_id: string;
  path: string;
  streamable: number;
  probe_status: string;
};

export class MediaWorker {
  private running = false;
  private timer?: NodeJS.Timeout;

  start() {
    this.scan().catch((error) => logger.warn({ error }, "Initial media scan failed"));
    this.timer = setInterval(() => {
      this.scan().catch((error) => logger.warn({ error }, "Media scan failed"));
    }, config.mediaScanIntervalSeconds * 1000);
    this.timer.unref();
  }

  async scan() {
    if (this.running) return;
    this.running = true;
    try {
      const row = db.prepare(`
        SELECT id, torrent_id, path, streamable, probe_status
        FROM files
        WHERE streamable = 1
          AND (probe_status = 'pending' OR probe_status = 'retry')
        ORDER BY created_at ASC
        LIMIT 1
      `).get() as FileRow | undefined;
      if (!row) return;
      await this.probe(row);
    } finally {
      this.running = false;
    }
  }

  private async probe(file: FileRow) {
    const diskPath = resolveDiskPath(file);
    if (!fs.existsSync(diskPath)) return;
    db.prepare("UPDATE files SET probe_status = ?, probe_error = NULL WHERE id = ?").run("probing", file.id);
    try {
      const result = await probeMedia(diskPath);
      db.prepare(`
        UPDATE files SET
          probe_status = 'ready',
          probe_error = NULL,
          duration = ?,
          codec_video = ?,
          codec_audio = ?,
          width = ?,
          height = ?,
          bitrate = ?,
          frame_rate = ?,
          audio_tracks = ?,
          subtitle_tracks = ?,
          probed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        result.duration,
        result.codecVideo,
        result.codecAudio,
        result.width,
        result.height,
        result.bitrate,
        result.frameRate,
        result.audioTracks,
        result.subtitleTracks,
        file.id
      );
    } catch (error: any) {
      const message = String(error?.message ?? error).slice(0, 500);
      db.prepare("UPDATE files SET probe_status = ?, probe_error = ? WHERE id = ?").run("failed", message, file.id);
      logger.warn({ error, fileId: file.id }, "Media probe failed");
    }
  }
}

export const mediaWorker = new MediaWorker();
