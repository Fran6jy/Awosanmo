/** Parse one HTTP byte range. Multi-range responses are intentionally unsupported.
 *
 *  `chunkCap` bounds an open-ended range ("bytes=N-"). Video streaming sets it so
 *  each seek pulls a small window instead of the rest of the file. Downloads must
 *  NOT set it: a browser resuming a download sends an open-ended range and expects
 *  everything through end-of-file, so capping it truncates the saved file. */
export function parseByteRange(range: string, size: number, chunkCap?: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0 || !/^bytes=\d+-\d*$/.test(range)) return null;
  const [startRaw, endRaw] = range.slice(6).split("-");
  const start = Number(startRaw);
  const openEnded = chunkCap ? Math.min(size - 1, start + chunkCap - 1) : size - 1;
  const requestedEnd = endRaw ? Number(endRaw) : openEnded;
  const end = Math.min(requestedEnd, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || end < start) return null;
  return { start, end };
}

/** Window served for an open-ended range while streaming video. */
export const STREAM_CHUNK_BYTES = 4 * 1024 * 1024;
