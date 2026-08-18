import { describe, expect, it } from "vitest";
import { STREAM_CHUNK_BYTES, parseByteRange } from "../modules/streaming/byteRange.js";
import { reannounceTorrent } from "../modules/torrents/torrentService.js";

describe("HTTP byte ranges", () => {
  it("accepts valid bounded and open-ended ranges", () => {
    expect(parseByteRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
  });

  it.each([
    "bytes=100-50",
    "bytes=-500",
    "bytes=0-10,20-30",
    "bytes=-1-20",
    "items=0-20",
    "bytes=1000-",
  ])("rejects malformed or unsupported range %s", (range) => {
    expect(parseByteRange(range, 1000)).toBeNull();
  });

  it("serves an open-ended range through end-of-file when uncapped", () => {
    // Downloads rely on this: a browser resuming a large download sends
    // "bytes=N-" and must receive everything that remains, not a window.
    const huge = 54_347_978_748;
    expect(parseByteRange("bytes=0-", huge)).toEqual({ start: 0, end: huge - 1 });
    expect(parseByteRange("bytes=7301444000-", huge)).toEqual({ start: 7301444000, end: huge - 1 });
  });

  it("bounds an open-ended range to the chunk cap when streaming", () => {
    const huge = 54_347_978_748;
    expect(parseByteRange("bytes=0-", huge, STREAM_CHUNK_BYTES)).toEqual({ start: 0, end: STREAM_CHUNK_BYTES - 1 });
    // An explicit end from the client is always honoured over the cap.
    expect(parseByteRange("bytes=0-99", huge, STREAM_CHUNK_BYTES)).toEqual({ start: 0, end: 99 });
    // The cap never runs past the end of a small file.
    expect(parseByteRange("bytes=900-", 1000, STREAM_CHUNK_BYTES)).toEqual({ start: 900, end: 999 });
  });
});

describe("torrent reannounce", () => {
  it("uses the tracker discovery client instead of the announce URL list", () => {
    let calls = 0;
    const torrent = { announce: ["udp://tracker.example"], discovery: { tracker: { announce: () => { calls += 1; } } } };
    expect(reannounceTorrent(torrent)).toBe(true);
    expect(calls).toBe(1);
  });

  it("does not throw when a torrent has no tracker client", () => {
    expect(reannounceTorrent({ announce: ["udp://tracker.example"] })).toBe(false);
  });
});
