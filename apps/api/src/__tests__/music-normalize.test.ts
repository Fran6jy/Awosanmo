import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeGenre, parseFilename, sortKey, toTrackRecord, UNKNOWN_ARTIST } from "../modules/music/normalize.js";

const ROOT = path.join("C:", "Users", "fran6", "Music");
const under = (folder: string, name: string) => path.join(ROOT, folder, name);

describe("filename parsing (real library patterns)", () => {
  it("strips a leading track number and keeps the title", () => {
    expect(parseFilename("01 Boa Me (feat. Ed Sheeran & Mugeez).mp3"))
      .toEqual({ trackNo: 1, artist: null, title: "Boa Me (feat. Ed Sheeran & Mugeez)" });
    expect(parseFilename("04. Designer (feat. Joeboy).mp3"))
      .toEqual({ trackNo: 4, artist: null, title: "Designer (feat. Joeboy)" });
  });

  it("splits artist from title only on a spaced hyphen", () => {
    expect(parseFilename("055. Master KG - Jerusalema (feat. Burna Boy) (Remix).mp3"))
      .toEqual({ trackNo: 55, artist: "Master KG", title: "Jerusalema (feat. Burna Boy) (Remix)" });
  });

  it("does not treat bare hyphens inside names as a separator", () => {
    // "M.I-Seven-Days" is one title, not artist "M.I" + title "Seven".
    const r = parseFilename("01-M.I-Seven-Days.mp3");
    expect(r.trackNo).toBe(1);
    expect(r.artist).toBeNull();
    expect(r.title).toBe("M.I-Seven-Days");
  });

  it("turns underscores into spaces and never returns an empty title", () => {
    expect(parseFilename("some_song_name.mp3").title).toBe("some song name");
    // A bare number with no separator after it is the whole title, not a track number.
    expect(parseFilename("01.mp3")).toEqual({ trackNo: null, artist: null, title: "01" });
  });
});

describe("tag merging with fallbacks", () => {
  it("prefers tags when present", () => {
    const r = toTrackRecord(
      { title: "Jerusalema", artist: "Master KG", album: "Jerusalema", genre: ["Afro"], year: 2020, track: { no: 3 }, disk: { no: 1 } },
      under("Afro Latino", "055. whatever.mp3"), ROOT,
    );
    expect(r).toMatchObject({ title: "Jerusalema", artist: "Master KG", albumArtist: "Master KG", album: "Jerusalema", genre: "Afro & Latin", year: 2020, trackNo: 3, discNo: 1, playable: true });
  });

  it("falls back to the filename for a missing artist and title", () => {
    const r = toTrackRecord({}, under("Afro Latino", "055. Master KG - Jerusalema.mp3"), ROOT);
    expect(r.artist).toBe("Master KG");
    expect(r.title).toBe("Jerusalema");
    expect(r.trackNo).toBe(55);
  });

  it("uses an Unknown artist rather than a blank when nothing is available", () => {
    const r = toTrackRecord({}, under("Pop Blues", "01 Boa Me.mp3"), ROOT);
    expect(r.artist).toBe(UNKNOWN_ARTIST);
  });

  it("treats a track with no album tag as a single named after itself", () => {
    // 21% of the library had no album tag; each becomes its own album tile.
    const r = toTrackRecord({ artist: "Jason Derulo" }, under("Pop Blues", "03 If It Ain't Love.mp3"), ROOT);
    expect(r.title).toBe("If It Ain't Love");
    expect(r.album).toBe("If It Ain't Love");
    // ...and a real album tag is still preferred.
    expect(toTrackRecord({ album: "Everything Is 4" }, under("Pop Blues", "x.mp3"), ROOT).album).toBe("Everything Is 4");
  });

  it("takes the genre from the top-level folder when the tag is missing", () => {
    // 43% of the library has no genre tag; the folder it lives in is the genre.
    expect(toTrackRecord({}, under("Country", "x.mp3"), ROOT).genre).toBe("Country");
    expect(toTrackRecord({}, under("Funk R n B Hiphop", "x.mp3"), ROOT).genre).toBe("Hip-Hop & R&B");
    // ...but a real tag still wins (and is normalised too).
    expect(toTrackRecord({ genre: ["Blues"] }, under("Country", "x.mp3"), ROOT).genre).toBe("Blues & Jazz");
  });

  it("has no folder genre for a file sitting at the library root", () => {
    expect(toTrackRecord({}, path.join(ROOT, "loose.mp3"), ROOT).genre).toBeNull();
  });

  it("album artist defaults to the track artist", () => {
    expect(toTrackRecord({ artist: "Burna Boy" }, under("Afro Latino", "x.mp3"), ROOT).albumArtist).toBe("Burna Boy");
  });

  it("flags formats browsers cannot decode", () => {
    expect(toTrackRecord({}, under("Christian", "hymn.wma"), ROOT).playable).toBe(false);
    expect(toTrackRecord({}, under("Christian", "hymn.m4a"), ROOT).playable).toBe(true);
    expect(toTrackRecord({}, under("Christian", "hymn.opus"), ROOT).playable).toBe(true);
  });

  it("ignores zero or negative track and year values", () => {
    const r = toTrackRecord({ year: 0, track: { no: 0 } }, under("EDM", "07 Beat.mp3"), ROOT);
    expect(r.year).toBeNull();
    expect(r.trackNo).toBe(7); // fell through to the filename
  });
});

describe("genre shelves", () => {
  it("collapses the spellings found in this library onto one shelf each", () => {
    // These four were separate rows after the first real scan.
    for (const g of ["Funk R n B Hiphop", "Hip-Hop", "Rap/Hip Hop", "R&B", "Hip Hop", "RnB"]) {
      expect(normalizeGenre(g), g).toBe("Hip-Hop & R&B");
    }
    expect(normalizeGenre("Pop Blues")).toBe("Pop");
    expect(normalizeGenre("Pop")).toBe("Pop");
    expect(normalizeGenre("EDM")).toBe("Electronic");
    expect(normalizeGenre("Afro Latino")).toBe("Afro & Latin");
    expect(normalizeGenre("Punk Rock")).toBe("Rock");
    expect(normalizeGenre("Soundtrack Classical")).toBe("Soundtrack & Classical");
    expect(normalizeGenre("Christian")).toBe("Christian & Gospel");
  });

  it("passes unknown genres through and drops blanks", () => {
    expect(normalizeGenre("Dinner")).toBe("Dinner");
    expect(normalizeGenre("AI Music")).toBe("AI Music");
    expect(normalizeGenre("")).toBeNull();
    expect(normalizeGenre(undefined)).toBeNull();
  });
});

describe("sort keys", () => {
  it("groups case and leading articles together", () => {
    expect(sortKey("The Weeknd")).toBe("weeknd");
    expect(sortKey("the weeknd")).toBe("weeknd");
    expect(sortKey("A Tribe Called Quest")).toBe("tribe called quest");
    expect(sortKey("  Burna  Boy ")).toBe("burna boy");
  });
});
