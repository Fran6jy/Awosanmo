import path from "node:path";

/** What the scanner records for one audio file after tags and fallbacks are applied. */
export type TrackRecord = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string | null;
  year: number | null;
  trackNo: number | null;
  discNo: number | null;
  playable: boolean;
};

/** Subset of music-metadata's `common` block the scanner relies on. */
export type CommonTags = {
  title?: string;
  artist?: string;
  albumartist?: string;
  album?: string;
  genre?: string[];
  year?: number;
  track?: { no: number | null };
  disk?: { no: number | null };
};

export const UNKNOWN_ARTIST = "Unknown Artist";
export const UNKNOWN_ALBUM = "Unknown Album";

/** Formats browsers decode natively; anything else is indexed but flagged unplayable. */
const PLAYABLE_EXT = new Set([".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wav", ".weba", ".webm"]);

/** Leading track numbers as they appear in ripped filenames: "01 ", "01-", "055. ", "1_". */
const LEADING_TRACK = /^\s*(\d{1,3})\s*[\s._-]+\s*/;

function clean(value: string | undefined | null): string {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** Normalise a name for grouping so "The Weeknd" and "the weeknd" share a row. */
export function sortKey(name: string): string {
  return clean(name).toLowerCase().replace(/^(the|a|an)\s+/, "");
}

/**
 * Pull whatever structure a filename offers when tags are missing.
 * "055. Master KG - Jerusalema (Remix).mp3" -> { trackNo: 55, artist: "Master KG", title: "Jerusalema (Remix)" }
 * Only a spaced " - " separates artist from title; a bare hyphen is far too
 * common inside names ("M.I-Seven-Days") to be trusted as a delimiter.
 */
export function parseFilename(file: string): { trackNo: number | null; artist: string | null; title: string } {
  let stem = clean(path.basename(file, path.extname(file)));
  let trackNo: number | null = null;
  const lead = LEADING_TRACK.exec(stem);
  if (lead) {
    trackNo = Number(lead[1]);
    stem = stem.slice(lead[0].length);
  }
  const split = stem.split(/\s+-\s+/);
  if (split.length >= 2 && split[0].trim() && split.slice(1).join(" - ").trim()) {
    return { trackNo, artist: split[0].trim(), title: split.slice(1).join(" - ").trim() };
  }
  return { trackNo, artist: null, title: stem || path.basename(file) };
}

/**
 * Collapse the many spellings a genre arrives in (tags and folder names
 * disagree constantly) onto one browsable shelf each. Matching is on a
 * lowercased alphanumeric key so "Hip-Hop", "hip hop" and "Rap/Hip Hop" meet.
 * Unrecognised genres pass through untouched rather than being forced.
 */
const GENRE_SHELVES: [RegExp, string][] = [
  [/hip[- ]?hop|\brap\b|funk r n b/, "Hip-Hop & R&B"],
  [/^r ?& ?b$|^rnb$|^r n b$|soul/, "Hip-Hop & R&B"],
  [/afro|latin|reggaeton|dancehall|amapiano|naija|nigeria|highlife|bongo|kwaito|zouk|coup[eé]|african/, "Afro & Latin"],
  [/^pop\b|pop blues/, "Pop"],
  [/country/, "Country"],
  [/edm|electro|dance|house|techno|trance|dubstep/, "Electronic"],
  [/christian|gospel|worship/, "Christian & Gospel"],
  [/rock|punk|metal|alternative|grunge|indie/, "Rock"],
  [/soundtrack|classi(?:cal|que|c)|score|orchestra|film|opera|symphon/, "Soundtrack & Classical"],
  [/christmas|holiday|xmas/, "Christmas"],
  [/blues|jazz/, "Blues & Jazz"],
];

/** Genre tags that say nothing: placeholders, and the download sites that stamp their name into every field. */
const JUNK_GENRE = /^(other|unknown|genre|none|misc|default|various|blues\/other|\d+)$|(?:^|[^a-z])(?:[a-z0-9-]+\.)+(?:com|net|org|cc|ng|me|to|io)\b/i;

export function normalizeGenre(raw: string | null | undefined): string | null {
  const cleaned = clean(raw);
  if (!cleaned || JUNK_GENRE.test(cleaned)) return null;
  const key = cleaned.toLowerCase();
  for (const [pattern, shelf] of GENRE_SHELVES) if (pattern.test(key)) return shelf;
  return cleaned;
}

/**
 * Merge tags with filename and folder fallbacks into a complete record.
 * `rootDir` lets the top-level folder stand in for a missing genre, which is
 * how this library is organised on disk.
 */
export function toTrackRecord(tags: CommonTags, filePath: string, rootDir: string): TrackRecord {
  const fromName = parseFilename(filePath);
  const title = clean(tags.title) || fromName.title;
  const artist = clean(tags.artist) || fromName.artist || UNKNOWN_ARTIST;
  const albumArtist = clean(tags.albumartist) || artist;
  // A track with no album tag is a single: it becomes an album of its own,
  // named after itself, so it gets a proper tile with art instead of being
  // lost in one enormous "Unknown Album" bucket. The album is keyed per
  // artist, so two artists' singles sharing a title never merge.
  const album = clean(tags.album) || title;

  const rel = path.relative(rootDir, filePath);
  // Split on either separator: the scanner runs on Linux but tests run on Windows.
  const topFolder = rel.split(/[\\/]/)[0];
  const folderGenre = topFolder && topFolder !== path.basename(filePath) ? clean(topFolder) : null;
  const genre = normalizeGenre(clean(tags.genre?.[0]) || folderGenre);

  const year = Number.isInteger(tags.year) && (tags.year as number) > 0 ? (tags.year as number) : null;
  const trackNo = tags.track?.no && tags.track.no > 0 ? tags.track.no : fromName.trackNo;
  const discNo = tags.disk?.no && tags.disk.no > 0 ? tags.disk.no : null;

  return {
    title, artist, album, albumArtist, genre, year, trackNo, discNo,
    playable: PLAYABLE_EXT.has(path.extname(filePath).toLowerCase()),
  };
}
