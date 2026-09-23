import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, Flame, Play, Share2, Sparkles } from "lucide-react";
import { renderYearCard, shareCard } from "../lib/wrappedCard";
import { pushToast } from "../components/Toast";
import { api, type Track } from "../lib/api";
import { playQueue } from "../lib/player";
import { Art } from "../components/Art";
import { TrackList } from "../components/TrackList";

export type YearData = {
  year: number; from: number; to: number;
  plays: number; minutes: number; distinctTracks: number; distinctArtists: number; distinctAlbums: number;
  daysListened: number; daysInYear: number; longestStreak: number;
  lastYear: { plays: number; minutes: number } | null;
  topSongs: (Track & { plays: number })[];
  topArtists: { id: string; name: string; image: string | null; art: string | null; plays: number; minutes: number }[];
  topAlbums: { id: string; title: string; artist: string; art: string | null; plays: number }[];
  topGenres: { name: string; plays: number; share: number }[];
  byMonth: number[];
  bigMonth: { month: number; plays: number } | null;
  bigDay: { at: number; plays: number } | null;
  firstPlay: (Track & { at: number }) | null;
  discovery: (Track & { plays: number; at: number }) | null;
  newToYou: number;
  mood: { label: string; blurb: string; tempo: number; energy: number } | null;
  yearsWithPlays: number[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long" });

/** December is when a year in music is worth putting on the home page. */
export function isYearSeason(now = new Date()): boolean {
  return now.getMonth() === 11;
}

function Stat({ value, label, note }: { value: string | number; label: string; note?: string }) {
  return (
    <div className="rounded-xl bg-surface/70 p-4">
      <p className="text-3xl font-extrabold tracking-tight text-cream">{value}</p>
      <p className="text-xs text-muted">{label}{note && <span className="text-dim"> · {note}</span>}</p>
    </div>
  );
}

function Hero({ kind, title, subtitle, art, seed, round, colors, to, onPlay, extra }: {
  kind: string; title: string; subtitle: string; art: string | null; seed: string; round?: boolean; colors: [string, string]; to: string; onPlay?: () => void; extra?: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl p-5" style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cream/70">{kind}</p>
      <div className="mt-4 flex items-end gap-4">
        <Link to={to} className="shrink-0"><Art src={art} seed={seed} round={round} className="h-28 w-28 shadow-card sm:h-36 sm:w-36" iconSize={0.4} /></Link>
        <div className="min-w-0 flex-1">
          <Link to={to} className="block truncate text-2xl font-extrabold tracking-tight text-cream hover:underline sm:text-3xl">{title}</Link>
          <p className="truncate text-sm text-cream/80">{subtitle}</p>
          {extra && <p className="mt-1 text-xs text-cream/60">{extra}</p>}
        </div>
        {onPlay && <button type="button" onClick={onPlay} aria-label={`Play ${title}`} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-cream text-ink shadow-glow transition hover:scale-105"><Play className="ml-0.5 h-5 w-5 fill-current" /></button>}
      </div>
    </motion.div>
  );
}

/** Your year in music: the same story as the weekly wrapped, twelve months wide. */
export function YearPage() {
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get("year")) || thisYear;
  const [sharing, setSharing] = useState(false);
  const q = useQuery({
    queryKey: ["music", "year", year],
    queryFn: () => api<YearData>(`/api/music/year?year=${year}&tz=${new Date().getTimezoneOffset()}`),
    staleTime: 5 * 60_000,
  });
  const y = q.data;

  async function share() {
    if (!y || sharing) return;
    setSharing(true);
    try {
      const blob = await renderYearCard(y);
      const how = await shareCard(blob, `jymusic-${y.year}.png`);
      if (how === "saved") pushToast("Saved as an image — post it anywhere");
    } catch { pushToast("Could not make the image"); }
    finally { setSharing(false); }
  }

  if (!y) return <div className="py-20 text-center text-muted">Adding up your year…</div>;

  const older = y.yearsWithPlays.filter((v) => v < year);
  const newer = y.yearsWithPlays.filter((v) => v > year);
  const empty = y.plays === 0;
  const hours = Math.round(y.minutes / 60);
  const pct = y.lastYear?.minutes ? Math.round(((y.minutes - y.lastYear.minutes) / y.lastYear.minutes) * 100) : null;
  const maxMonth = Math.max(1, ...y.byMonth);

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent2">Your year in music</p>
          <h1 className="mt-1 text-4xl font-extrabold tracking-tight sm:text-5xl">{y.year}</h1>
          <p className="text-sm text-muted">
            {year === thisYear ? "So far this year" : "1 Jan – 31 Dec"}
            {y.longestStreak > 1 && <span className="ml-2 inline-flex items-center gap-1 text-gold"><Flame className="h-3.5 w-3.5" />{y.longestStreak}-day best streak</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/wrapped" className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-cream hover:text-cream">Your week</Link>
          {!empty && (
            <button type="button" onClick={() => void share()} disabled={sharing}
              className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-cream transition hover:bg-accent2 disabled:opacity-60">
              <Share2 className="h-4 w-4" /> {sharing ? "Making…" : "Share"}
            </button>
          )}
          <button type="button" disabled={!older.length} onClick={() => setParams({ year: String(older[0]) })} aria-label="Earlier year" className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:text-cream disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" disabled={!newer.length} onClick={() => setParams({ year: String(newer[newer.length - 1]) })} aria-label="Later year" className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:text-cream disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
        </div>
      </div>

      {empty ? (
        <div className="mt-8 rounded-xl bg-surface p-8 text-center">
          <p className="text-lg font-semibold">Nothing played in {y.year}</p>
          <p className="mt-1 text-sm text-muted">Pick a year with the arrows, or go back to <Link to="/wrapped" className="text-accent2 hover:underline">your week</Link>.</p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={y.minutes.toLocaleString()} label="minutes" note={`${hours.toLocaleString()} hours`} />
            <Stat value={y.plays.toLocaleString()} label="plays" note={pct !== null ? `${pct > 0 ? "+" : ""}${pct}% vs ${y.year - 1}` : undefined} />
            <Stat value={y.distinctTracks.toLocaleString()} label="different songs" note={`${y.distinctArtists} artists`} />
            <Stat value={y.daysListened.toLocaleString()} label="days with music" note={`of ${y.daysInYear}`} />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {y.topSongs[0] && (
              <Hero kind={`Song of ${y.year}`} title={y.topSongs[0].title} subtitle={y.topSongs[0].artist} art={y.topSongs[0].art} seed={y.topSongs[0].albumId} colors={["#A32638", "#3A0F16"]}
                to={`/album/${y.topSongs[0].albumId}`} extra={`${y.topSongs[0].plays} plays`}
                onPlay={() => void playQueue(y.topSongs, 0, { kind: "home", name: `Top songs of ${y.year}` })} />
            )}
            {y.topArtists[0] && (
              <Hero kind={`Artist of ${y.year}`} title={y.topArtists[0].name} subtitle={`${y.topArtists[0].plays} plays · ${y.topArtists[0].minutes.toLocaleString()} min`} art={y.topArtists[0].image ?? y.topArtists[0].art} seed={y.topArtists[0].id} round colors={["#5B3FA8", "#1B1236"]}
                to={`/artist/${y.topArtists[0].id}`}
                onPlay={() => api<{ topTracks: Track[] }>(`/api/music/artists/${y.topArtists[0].id}`).then((r) => playQueue(r.topTracks, 0, { kind: "artist", name: y.topArtists[0].name }))} />
            )}
            {y.topAlbums[0] && (
              <Hero kind={`Album of ${y.year}`} title={y.topAlbums[0].title} subtitle={y.topAlbums[0].artist} art={y.topAlbums[0].art} seed={y.topAlbums[0].id} colors={["#B8741F", "#3A250A"]}
                to={`/album/${y.topAlbums[0].id}`} extra={`${y.topAlbums[0].plays} plays across the album`}
                onPlay={() => api<{ tracks: Track[] }>(`/api/music/albums/${y.topAlbums[0].id}`).then((r) => playQueue(r.tracks, 0, { kind: "album", name: y.topAlbums[0].title }))} />
            )}
            {y.discovery && (
              <Hero kind="Discovery of the year" title={y.discovery.title} subtitle={y.discovery.artist} art={y.discovery.art} seed={y.discovery.albumId} colors={["#1F7A8C", "#0B2C33"]}
                to={`/album/${y.discovery.albumId}`} extra={`First heard ${fmtDay(y.discovery.at)} · ${y.discovery.plays} plays since`}
                onPlay={() => void playQueue([y.discovery!], 0, { kind: "home", name: "Discovery of the year" })} />
            )}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-surface/70 p-4">
              <p className="text-sm font-semibold text-cream">Your year, month by month</p>
              <p className="text-xs text-muted">{y.bigMonth ? `${MONTHS[y.bigMonth.month]} was your biggest month — ${y.bigMonth.plays} plays` : " "}</p>
              <div className="mt-3 flex h-28 items-end gap-1.5">
                {y.byMonth.map((v, i) => (
                  <div key={i} className="group relative flex-1" title={`${MONTHS[i]}: ${v} plays`}>
                    <div className={`w-full rounded-sm ${v === maxMonth && v > 0 ? "bg-accent2" : "bg-cream/30"}`} style={{ height: `${Math.max(2, (v / maxMonth) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-dim">{MONTHS.map((m) => <span key={m}>{m[0]}</span>)}</div>
            </div>
            <div className="grid gap-4">
              {y.mood && (
                <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg, #1F7A8C, #0B2C33)" }}>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cream/70">Your sound in {y.year}</p>
                  <p className="mt-3 text-3xl font-extrabold tracking-tight text-cream">{y.mood.label}</p>
                  <p className="text-sm text-cream/80">{y.mood.blurb}</p>
                  <p className="mt-2 text-xs text-cream/60">Average {y.mood.tempo} BPM · energy {Math.round(y.mood.energy * 100)}/100{y.topGenres[0] ? ` · ${y.topGenres[0].share}% ${y.topGenres[0].name}` : ""}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {y.bigDay && <Stat value={fmtDay(y.bigDay.at)} label="your biggest day" note={`${y.bigDay.plays} plays`} />}
                <Stat value={y.newToYou.toLocaleString()} label="songs new to you" />
              </div>
            </div>
          </div>

          {y.firstPlay && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 px-1 text-2xl font-extrabold tracking-tight"><CalendarDays className="h-5 w-5 text-gold" />How it started</h2>
              <p className="px-1 text-sm text-muted">The first thing you played in {y.year}, on {fmtDay(y.firstPlay.at)}</p>
              <TrackList tracks={[y.firstPlay]} context={{ kind: "home", name: `First play of ${y.year}` }} numbered={false} />
            </section>
          )}

          {y.topSongs.length > 1 && (
            <section className="mt-8">
              <div className="flex items-end justify-between px-1">
                <h2 className="text-2xl font-extrabold tracking-tight">Top songs of {y.year}</h2>
                <button type="button" onClick={() => void playQueue(y.topSongs, 0, { kind: "home", name: `Top songs of ${y.year}` })} className="text-sm font-semibold text-muted hover:text-cream">Play all</button>
              </div>
              <TrackList tracks={y.topSongs} context={{ kind: "home", name: `Top songs of ${y.year}` }} showArt />
            </section>
          )}

          {y.topArtists.length > 1 && (
            <section className="mt-8">
              <h2 className="px-1 text-2xl font-extrabold tracking-tight">Top artists</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {y.topArtists.map((a, i) => (
                  <Link key={a.id} to={`/artist/${a.id}`} className="flex items-center gap-3 rounded-lg bg-surface/60 p-3 hover:bg-surface2">
                    <span className="w-4 text-sm font-bold text-dim">{i + 1}</span>
                    <Art src={a.image ?? a.art} seed={a.id} round className="h-12 w-12 shrink-0" iconSize={0.5} />
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{a.name}</p><p className="text-xs text-muted">{a.plays} plays</p></div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {y.topAlbums.length > 1 && (
            <section className="mt-8">
              <h2 className="px-1 text-2xl font-extrabold tracking-tight">Top albums</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {y.topAlbums.map((a, i) => (
                  <Link key={a.id} to={`/album/${a.id}`} className="flex items-center gap-3 rounded-lg bg-surface/60 p-3 hover:bg-surface2">
                    <span className="w-4 text-sm font-bold text-dim">{i + 1}</span>
                    <Art src={a.art} seed={a.id} className="h-12 w-12 shrink-0" iconSize={0.5} />
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{a.title}</p><p className="truncate text-xs text-muted">{a.artist}</p></div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {y.topGenres.length > 0 && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 px-1 text-2xl font-extrabold tracking-tight"><Sparkles className="h-5 w-5 text-gold" />What you were into</h2>
              <div className="mt-3 space-y-2">
                {y.topGenres.map((g) => (
                  <Link key={g.name} to={`/genre/${encodeURIComponent(g.name)}`} className="block rounded-lg bg-surface/60 p-3 hover:bg-surface2">
                    <div className="flex items-baseline justify-between text-sm"><span className="font-semibold">{g.name}</span><span className="text-muted">{g.share}% · {g.plays} plays</span></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-cream/10"><div className="h-full rounded-full bg-accent2" style={{ width: `${Math.max(3, g.share)}%` }} /></div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
