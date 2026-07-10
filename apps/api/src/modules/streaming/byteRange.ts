/** Parse one HTTP byte range. Multi-range responses are intentionally unsupported. */
export function parseByteRange(range: string, size: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0 || !/^bytes=\d+-\d*$/.test(range)) return null;
  const [startRaw, endRaw] = range.slice(6).split("-");
  const start = Number(startRaw);
  const requestedEnd = endRaw ? Number(endRaw) : Math.min(size - 1, start + 4 * 1024 * 1024 - 1);
  const end = Math.min(requestedEnd, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || end < start) return null;
  return { start, end };
}
