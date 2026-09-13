import { describe, expect, it } from "vitest";
import { choose, cleanName, isJunkName, score, similarity, splitArtistTitle, titleKey, type Candidate } from "../modules/music/enrich.js";

const cand = (o: Partial<Candidate> & { title: string; artist: string; duration: number }): Candidate =>
  ({ provider: "deezer", id: 1, artistId: 1, album: "Album", albumId: 1, cover: null, artistPicture: null, ...o });

describe("name cleaning", () => {
  it("strips download-site junk and video tags", () => {
    expect(cleanName("R2Bees_ft_wande_coal-Kiss_your_handnew[SoundCloudMP3.cc]")).toBe("R2Bees ft wande coal-Kiss your handnew");
    expect(cleanName("Trey+Songz+-+Already+Taken+Naijapals(music.naij.com)")).toBe("Trey Songz - Already Taken");
    expect(cleanName("Avelino (feat. Stormzy _ Skepta) - Energy [Official Video]")).toBe("Avelino (feat. Stormzy Skepta) - Energy");
    expect(cleanName("La Cintura - Alvaro Soler (Letralyrics)")).toBe("La Cintura - Alvaro Soler");
    expect(cleanName("ASAP_Ferg_-_Plain_Jane_Remix_Ft_Nicki_Minaj__NaijaExclusive.net")).toBe("ASAP Ferg - Plain Jane Remix Ft Nicki Minaj");
  });
  it("leaves clean names alone", () => {
    expect(cleanName("Love the Way You Lie")).toBe("Love the Way You Lie");
    expect(cleanName("Boa Me (feat. Ed Sheeran & Mugeez)")).toBe("Boa Me (feat. Ed Sheeran & Mugeez)");
  });
});

describe("junk names", () => {
  it("recognises placeholders and download sites", () => {
    for (const n of ["Unknown Artist", "Unknown Album", "www.tooxclusive.com", "Qoret.com", "Various Artists", "Track 07", "", "   "]) expect(isJunkName(n)).toBe(true);
    for (const n of ["Eminem", "Banky W", "M.I", "Tiwa Savage"]) expect(isJunkName(n)).toBe(false);
  });
});

describe("matching", () => {
  it("compares titles on their core", () => {
    expect(titleKey("Lean On (feat. MØ & DJ Snake)")).toBe("leanon");
    expect(titleKey("Finesse - Remix; feat. Cardi B")).toBe("finesse");
    expect(similarity(titleKey("Jerusalema"), titleKey("Jerusalema (feat. Nomcebo Zikode)"))).toBe(1);
  });

  it("accepts the right record when title, artist and duration agree", () => {
    const local = { title: "Not Afraid", artist: "Eminem", duration: 248 };
    const right = cand({ title: "Not Afraid", artist: "Eminem", duration: 248 });
    const cover = cand({ id: 2, title: "Not Afraid", artist: "Karaoke Hits", duration: 249 });
    expect(score(local, right)).toBeGreaterThan(0.95);
    expect(score(local, cover)).toBe(0);
    expect(choose(local, [cover, right])).toBe(right);
  });

  it("uses duration to keep a same-titled song by another artist away when the local artist is unknown", () => {
    const local = { title: "Halo", artist: "Unknown Artist", duration: 261 };
    const beyonce = cand({ id: 1, title: "Halo", artist: "Beyoncé", duration: 261 });
    const other = cand({ id: 2, title: "Halo", artist: "Someone Else", duration: 199 });
    expect(choose(local, [other, beyonce])).toBe(beyonce);
    // With no duration to lean on and no artist, a bare title is not enough on its own.
    expect(choose({ title: "Halo", artist: null, duration: null }, [other])).toBeNull();
  });

  it("refuses when the title is only vaguely similar", () => {
    expect(choose({ title: "Lagos Party", artist: "Banky W", duration: 281 }, [cand({ title: "Lagos", artist: "Banky W", duration: 281 })])).toBeNull();
  });

  it("recognises the artist when it is only present inside the title", () => {
    // A folder name landed in the artist tag; the filename carries the real artist.
    const local = { title: "Tiwa Savage - Love Me Love Me Love Me", artist: "Afro Latino", duration: 230 };
    const c = cand({ title: "Love Me Love Me Love Me", artist: "Tiwa Savage", duration: 231 });
    expect(choose(local, [c])).toBe(c);
    expect(choose({ title: "Young Money Senile", artist: null, duration: 199 }, [cand({ title: "Senile", artist: "Young Money", duration: 199 })])).not.toBeNull();
  });

  it("forgives a near spelling only when the artist and length are certain", () => {
    const c = cand({ title: "Koni Koni Love", artist: "Klever Jay", duration: 247 });
    expect(choose({ title: "Koni Koni Luv", artist: "Klever Jay Ft. Danny Young", duration: 247 }, [c])).toBe(c);
    expect(choose({ title: "Koni Koni Luv", artist: null, duration: 247 }, [c])).toBeNull();
  });

  it("does not accept a same-titled song from a different artist on a lucky duration alone", () => {
    const sting = cand({ title: "Seven Days", artist: "Sting", duration: 279 });
    expect(choose({ title: "M.I - Seven Days", artist: null, duration: 281 }, [sting])).toBeNull();
    const split = splitArtistTitle("M.I - Seven Days")!;
    expect(split).toEqual({ artist: "M.I", title: "Seven Days" });
    expect(choose({ ...split, duration: 281 }, [sting])).toBeNull();
    expect(choose({ ...split, duration: 281 }, [cand({ title: "Seven Days", artist: "M.I Abaga", duration: 281 })])).not.toBeNull();
  });
});
