import { describe, expect, it } from "vitest";
import { parseByteRange } from "../modules/streaming/streamController.js";

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
});
