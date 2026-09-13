import { spawn } from "node:child_process";
import { db } from "../../db/schema.js";
import { logger } from "../../logger.js";

/**
 * Audio analysis: the numbers behind moods and smart mixes. Each file is
 * decoded to mono 11 kHz PCM by ffmpeg and measured here: tempo from the
 * autocorrelation of an onset envelope, energy from RMS loudness, brightness
 * from the zero-crossing rate, and how regular the beat is. Nothing leaves the
 * server. A 4-minute song takes a few seconds on a small ARM core, so this
 * runs in the background after scans and repair, one file at a time.
 */

export type Features = {
  tempo: number;        // BPM, 60..200
  energy: number;       // 0..1, perceived intensity (loudness + onset density)
  brightness: number;   // 0..1, spectral tilt proxy
  dance: number;        // 0..1, beat regularity and strength
  loudness: number;     // dBFS RMS, negative
  dynamics: number;     // dB between quiet and loud passages
};

const SAMPLE_RATE = 11_025;
const FRAME = 512;                       // ~46 ms
const HOP = 128;                         // ~12 ms → onset envelope at ~86 Hz, fine enough to tell 140 from 144 BPM

/** Decode a file to signed 16-bit mono PCM at SAMPLE_RATE; at most `maxSeconds` from the middle of the song. */
function decode(filePath: string, startSeconds = 0, maxSeconds = 150): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-nostdin", ...(startSeconds > 0 ? ["-ss", String(startSeconds)] : []), "-i", filePath, "-t", String(maxSeconds), "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"];
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => { err += c.toString(); });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0 && !chunks.length) return reject(new Error(err.trim() || `ffmpeg exited ${code}`));
      const buf = Buffer.concat(chunks);
      resolve(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2)));
    });
  });
}

/** Pure analysis of PCM; exported for tests with synthetic signals. */
export function analyse(pcm: Int16Array): Features | null {
  const n = pcm.length;
  if (n < SAMPLE_RATE * 20) return null; // under 20 s: not enough to say anything
  const frames = Math.floor((n - FRAME) / HOP);
  const rms = new Float32Array(frames);
  const zcr = new Float32Array(frames);
  const lowRms = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    const start = f * HOP;
    let sum = 0, crossings = 0, lowSum = 0, prev = pcm[start], lp = 0;
    for (let i = start; i < start + FRAME; i += 1) {
      const x = pcm[i] / 32768;
      sum += x * x;
      // One-pole low-pass (~150 Hz) for a bass-heavy onset envelope: kick and bass carry the beat.
      lp += 0.085 * (x - lp);
      lowSum += lp * lp;
      if ((pcm[i] >= 0) !== (prev >= 0)) crossings += 1;
      prev = pcm[i];
    }
    rms[f] = Math.sqrt(sum / FRAME);
    lowRms[f] = Math.sqrt(lowSum / FRAME);
    zcr[f] = crossings / FRAME;
  }

  // Loudness and dynamics from RMS (dB), ignoring silence.
  const db = Array.from(rms).filter((v) => v > 1e-4).map((v) => 20 * Math.log10(v)).sort((a, b) => a - b);
  if (db.length < 50) return null;
  const q = (p: number) => db[Math.floor(p * (db.length - 1))];
  const loudness = db.reduce((a, b) => a + b, 0) / db.length;
  const dynamics = q(0.95) - q(0.10);

  // Onset envelope: positive change in (bass-weighted) energy, smoothed.
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f += 1) {
    const d = (lowRms[f] - lowRms[f - 1]) * 2 + (rms[f] - rms[f - 1]);
    onset[f] = d > 0 ? d : 0;
  }
  const mean = onset.reduce((a, b) => a + b, 0) / frames;
  for (let f = 0; f < frames; f += 1) onset[f] -= mean;

  // Autocorrelation over the tempo range 60–200 BPM.
  const fps = SAMPLE_RATE / HOP;
  const minLag = Math.round((60 / 200) * fps), maxLag = Math.round((60 / 60) * fps);
  const ac: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let s = 0;
    for (let f = lag; f < frames; f += 1) s += onset[f] * onset[f - lag];
    ac.push(s / (frames - lag));
  }
  const best = Math.max(...ac);
  // A periodic beat peaks at its period and every multiple. Weight the peaks
  // by how common a tempo is (a wide bell around 110 BPM, as in Ellis 2007) so
  // the octave ambiguity resolves towards the tempo a listener would tap.
  const prior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.8) ** 2);
  let bestIdx = 0, bestWeighted = -Infinity;
  for (let i = 0; i < ac.length; i += 1) {
    // A beat period that falls between two lags spreads over both; judge each lag with its neighbours.
    const local = Math.max(ac[i], i > 0 ? ac[i - 1] : 0, i + 1 < ac.length ? ac[i + 1] : 0);
    if (local < best * 0.35) continue;
    const w = local * prior((60 * fps) / (minLag + i));
    if (w > bestWeighted) { bestWeighted = w; bestIdx = i; }
  }
  const tempo = (60 * fps) / (minLag + bestIdx);
  // Beat regularity: the normalised autocorrelation at the beat period. A
  // steady groove correlates strongly with itself one beat later; noise does not.
  let ac0 = 0;
  for (let f = 0; f < frames; f += 1) ac0 += onset[f] * onset[f];
  ac0 /= frames;
  const dance = Math.max(0, Math.min(1, (best / (ac0 + 1e-12)) / 0.45));

  // Energy: loudness mapped from -35..-8 dBFS, blended with onset density.
  const loudPart = Math.max(0, Math.min(1, (loudness + 35) / 27));
  const density = onset.filter((v) => v > 0).length / frames;
  const energy = Math.max(0, Math.min(1, loudPart * 0.7 + density * 0.6));
  const zMean = zcr.reduce((a, b) => a + b, 0) / frames;
  const brightness = Math.max(0, Math.min(1, (zMean - 0.02) / 0.45));

  return { tempo: Math.round(tempo), energy: round(energy), brightness: round(brightness), dance: round(dance), loudness: round(loudness), dynamics: round(dynamics) };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

// ---------- persistence and the background job ----------

let running = false;
let progress: { done: number; total: number } | null = null;
export const analysisInProgress = () => running;
export const analysisProgress = () => progress;

function pendingTracks(limit: number) {
  return db.prepare(`
    SELECT t.id, t.path, t.size, t.mtime, t.duration FROM music_tracks t
    LEFT JOIN music_features f ON f.track_id = t.id
    WHERE t.playable = 1 AND (f.track_id IS NULL OR f.size <> t.size OR f.mtime <> t.mtime)
    ORDER BY t.created_at DESC LIMIT ?`).all(limit) as { id: string; path: string; size: number; mtime: number; duration: number | null }[];
}

export async function analyseLibrary(maxTracks = 10_000): Promise<{ analysed: number; failed: number; seconds: number }> {
  if (running) throw new Error("Analysis is already running");
  running = true;
  const started = Date.now();
  const summary = { analysed: 0, failed: 0, seconds: 0 };
  const save = db.prepare(`INSERT INTO music_features (track_id, tempo, energy, brightness, dance, loudness, dynamics, size, mtime, analysed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET tempo = excluded.tempo, energy = excluded.energy, brightness = excluded.brightness, dance = excluded.dance,
      loudness = excluded.loudness, dynamics = excluded.dynamics, size = excluded.size, mtime = excluded.mtime, analysed_at = excluded.analysed_at`);
  const markFailed = db.prepare(`INSERT INTO music_features (track_id, size, mtime, analysed_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, analysed_at = excluded.analysed_at`);
  try {
    const rows = pendingTracks(maxTracks);
    progress = { done: 0, total: rows.length };
    for (const row of rows) {
      progress.done += 1;
      try {
        // Sample from a fifth of the way in: verses and choruses rather than a fade-in.
        const start = row.duration && row.duration > 60 ? Math.floor(row.duration * 0.2) : 0;
        const f = analyse(await decode(row.path, start));
        if (f) { save.run(row.id, f.tempo, f.energy, f.brightness, f.dance, f.loudness, f.dynamics, row.size, row.mtime, Date.now()); summary.analysed += 1; }
        else { markFailed.run(row.id, row.size, row.mtime, Date.now()); summary.failed += 1; }
      } catch (error) {
        logger.warn({ error, path: row.path }, "Audio analysis failed");
        markFailed.run(row.id, row.size, row.mtime, Date.now());
        summary.failed += 1;
      }
    }
    summary.seconds = Math.round((Date.now() - started) / 1000);
    if (summary.analysed || summary.failed) logger.info(summary, "Audio analysis pass complete");
    db.prepare("INSERT INTO music_scan_state (key, value) VALUES ('last_analysis', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ at: new Date().toISOString(), ...summary }));
    return summary;
  } finally {
    running = false;
    progress = null;
  }
}

export function analysisStats() {
  const one = (sql: string) => (db.prepare(sql).get() as any).n as number;
  return {
    analysed: one("SELECT COUNT(*) AS n FROM music_features WHERE tempo IS NOT NULL"),
    pending: one("SELECT COUNT(*) AS n FROM music_tracks t LEFT JOIN music_features f ON f.track_id = t.id WHERE t.playable = 1 AND (f.track_id IS NULL OR f.size <> t.size OR f.mtime <> t.mtime)"),
  };
}
