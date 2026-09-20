import { artUrl } from "./api";

/**
 * Renders "my week in music" as a 1080×1920 story image entirely in the
 * browser (no server round-trip, nothing uploaded anywhere), then hands it to
 * the phone's share sheet or saves it as a PNG on desktop.
 */
export type CardData = {
  rangeLabel: string;
  minutes: number; plays: number; streakDays: number;
  song: { title: string; artist: string; art: string | null; plays: number } | null;
  album: { title: string; artist: string; art: string | null } | null;
  artist: { name: string; image: string | null } | null;
  mood: { label: string } | null;
  topGenre: string | null;
  topSongs: { title: string; artist: string }[];
};

const W = 1080, H = 1920;
const FONT = '"Plus Jakarta Sans", Inter, system-ui, sans-serif';

function loadImage(name: string | null): Promise<HTMLImageElement | null> {
  const url = artUrl(name);
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawArt(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, size: number, r: number, seed: string) {
  ctx.save();
  roundRect(ctx, x, y, size, size, r); ctx.clip();
  if (img) {
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, x, y, size, size);
  } else {
    let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, `hsl(${340 + (h % 40) - 20} 45% 26%)`); g.addColorStop(1, `hsl(${20 + ((h >> 8) % 30)} 40% 18%)`);
    ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

/** The tuning-fork mark (see components/Logo.tsx), drawn at `size` px with its top-left at (x, y). */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(size / 104, size / 104); ctx.translate(-12, -14);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 10;
  ctx.stroke(new Path2D("M47 25 55 51a9 9 0 0 0 18 0l8-26"));
  ctx.stroke(new Path2D("M64 60v24c0 8-6 12-12 12"));
  ctx.beginPath(); ctx.ellipse(49, 97, 12.5, 9, (-22 * Math.PI) / 180, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 6; ctx.globalAlpha = 0.85;
  ctx.stroke(new Path2D("M35 24q-7 10 0 20")); ctx.stroke(new Path2D("M93 24q7 10 0 20"));
  ctx.lineWidth = 5; ctx.globalAlpha = 0.55;
  ctx.stroke(new Path2D("M22 20q-11 14 0 28")); ctx.stroke(new Path2D("M106 20q11 14 0 28"));
  ctx.restore();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

export async function renderWrappedCard(d: CardData): Promise<Blob> {
  try { await (document as any).fonts?.load(`800 64px ${FONT}`); await (document as any).fonts?.load(`600 36px ${FONT}`); } catch { /* fallback font */ }
  const [songImg, albumImg, artistImg] = await Promise.all([loadImage(d.song?.art ?? null), loadImage(d.album?.art ?? null), loadImage(d.artist?.image ?? null)]);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background: espresso with a maroon glow behind the hero.
  ctx.fillStyle = "#0D0909"; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(540, 560, 60, 540, 560, 900);
  glow.addColorStop(0, "rgba(163,38,56,.55)"); glow.addColorStop(1, "rgba(163,38,56,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "top";
  ctx.fillStyle = "#C43A4E"; ctx.font = `800 30px ${FONT}`; ctx.letterSpacing = "8px";
  ctx.fillText("MY WEEK IN MUSIC", 90, 110);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#B8A9A3"; ctx.font = `600 34px ${FONT}`;
  ctx.fillText(d.rangeLabel, 90, 158);

  // Hero: song of the week.
  const artSize = 560;
  drawArt(ctx, songImg, (W - artSize) / 2, 250, artSize, 28, d.song?.title ?? "x");
  ctx.textAlign = "center";
  ctx.fillStyle = "#C43A4E"; ctx.font = `800 26px ${FONT}`; ctx.letterSpacing = "6px";
  ctx.fillText("SONG OF THE WEEK", W / 2, 850);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#F5EDE8"; ctx.font = `800 60px ${FONT}`;
  ctx.fillText(fitText(ctx, d.song?.title ?? "Nothing played yet", W - 180), W / 2, 892);
  ctx.fillStyle = "#B8A9A3"; ctx.font = `600 38px ${FONT}`;
  ctx.fillText(fitText(ctx, d.song ? `${d.song.artist} · ${d.song.plays} plays` : "", W - 180), W / 2, 968);
  ctx.textAlign = "left";

  // Three stat tiles.
  const tiles: [string, string][] = [[String(d.minutes.toLocaleString()), "minutes"], [String(d.plays.toLocaleString()), "plays"], [d.streakDays ? `${d.streakDays}` : "—", d.streakDays === 1 ? "day streak" : "day streak"]];
  tiles.forEach(([v, l], i) => {
    const x = 90 + i * 310, y = 1060;
    ctx.fillStyle = "rgba(255,255,255,.07)"; roundRect(ctx, x, y, 280, 150, 22); ctx.fill();
    ctx.fillStyle = "#F5EDE8"; ctx.font = `800 56px ${FONT}`; ctx.fillText(v, x + 28, y + 30);
    ctx.fillStyle = "#B8A9A3"; ctx.font = `600 26px ${FONT}`; ctx.fillText(l, x + 28, y + 100);
  });

  // Album + artist row.
  const rowY = 1250;
  const cell = (x: number, label: string, title: string, sub: string, img: HTMLImageElement | null, seed: string, round: boolean) => {
    ctx.fillStyle = "rgba(255,255,255,.07)"; roundRect(ctx, x, rowY, 435, 230, 22); ctx.fill();
    ctx.save(); if (round) { ctx.beginPath(); ctx.arc(x + 28 + 75, rowY + 40 + 75, 75, 0, Math.PI * 2); ctx.clip(); }
    drawArt(ctx, img, x + 28, rowY + 40, 150, round ? 75 : 18, seed); ctx.restore();
    ctx.fillStyle = "#C43A4E"; ctx.font = `800 20px ${FONT}`; ctx.letterSpacing = "4px"; ctx.fillText(label, x + 205, rowY + 44); ctx.letterSpacing = "0px";
    ctx.fillStyle = "#F5EDE8"; ctx.font = `800 30px ${FONT}`; ctx.fillText(fitText(ctx, title, 205), x + 205, rowY + 84);
    ctx.fillStyle = "#B8A9A3"; ctx.font = `600 22px ${FONT}`; ctx.fillText(fitText(ctx, sub, 205), x + 205, rowY + 130);
  };
  // No album of the week (singles only)? Use the slot for the mood instead of an empty dash.
  if (d.album) cell(90, "ALBUM", d.album.title, d.album.artist, albumImg, d.album.title, false);
  else cell(90, "MOOD", d.mood?.label ?? "—", d.topGenre ?? "", null, "mood", false);
  cell(555, "ARTIST", d.artist?.name ?? "—", d.album ? (d.mood?.label ?? d.topGenre ?? "") : (d.topGenre ?? ""), artistImg, d.artist?.name ?? "b", true);

  // Top 5 list.
  ctx.fillStyle = "#C43A4E"; ctx.font = `800 24px ${FONT}`; ctx.letterSpacing = "5px"; ctx.fillText("TOP SONGS", 90, 1520); ctx.letterSpacing = "0px";
  d.topSongs.slice(0, 5).forEach((t, i) => {
    const y = 1566 + i * 54;
    ctx.fillStyle = "#7A6C67"; ctx.font = `800 30px ${FONT}`; ctx.fillText(String(i + 1), 90, y);
    ctx.fillStyle = "#F5EDE8"; ctx.font = `700 30px ${FONT}`; ctx.fillText(fitText(ctx, t.title, 560), 140, y);
    ctx.fillStyle = "#B8A9A3"; ctx.font = `500 26px ${FONT}`; ctx.textAlign = "right"; ctx.fillText(fitText(ctx, t.artist, 260), W - 90, y + 3); ctx.textAlign = "left";
  });

  // Wordmark: the tuning-fork mark stands in for "JY".
  drawMark(ctx, 84, 1836, 56, "#C43A4E");
  ctx.fillStyle = "#F5EDE8"; ctx.font = `800 28px ${FONT}`; ctx.fillText("Music", 146, 1857);
  ctx.fillStyle = "#7A6C67"; ctx.font = `500 22px ${FONT}`; ctx.textAlign = "right"; ctx.fillText("your music, your server", W - 90, 1861); ctx.textAlign = "left";

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render failed"))), "image/png"));
}

/** Share sheet where there is one (phones), a PNG download elsewhere. Returns how it was delivered. */
export async function shareCard(blob: Blob, filename: string): Promise<"shared" | "saved" | "cancelled"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  // The share sheet is a phone thing; some desktop browsers expose navigator.share and then never resolve it.
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia("(pointer: coarse)").matches;
  if (mobile && nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: "My week in music" }); return "shared"; } catch (e) { if ((e as Error).name === "AbortError") return "cancelled"; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}
