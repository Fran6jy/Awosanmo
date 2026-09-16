import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Flame, Play, Share2, Sparkles } from "lucide-react";
import { renderWrappedCard, shareCard } from "../lib/wrappedCard";
import { pushToast } from "../components/Toast";
import { api, type Track } from "../lib/api";
import { playQueue } from "../lib/player";
import { Art } from "../components/Art";
import { TrackList } from "../components/TrackList";

type Wrapped = {
  from: number; to: number; weekOffset: number;
  plays: number; minutes: number; distinctTracks: number; distinctArtists: number;
  lastWeek: { plays: number; minutes: number };
  songOfWeek: (Track & { plays: number }) | null;
  topSongs: (Track & { plays: number })[];
  albumOfWeek: { id: string; title: string; artist: string; art: string | null; plays: number } | null;
  artistOfWeek: { id: string; name: string; image: string | null; art: string | null; plays: number; minutes: number } | null;
  topArtists: { id: string; name: string; image: string | null; art: string | null; plays: number }[];
  topGenre: { name: string; plays: number; share: number } | null;
  mood: { label: string; blurb: string; tempo: number; energy: number } | null;
  byHour: number[]; byDay: number[];
  discoveries: Track[];
  streakDays: number;
  firstWeekWithPlays: number | null;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const hourLabel = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}am` : `${h - 12}pm`);

/** Big number with a caption; the building block of the page. */
function Stat({ value, label, delta }: { value: string | number; label: string; delta?: number }) {
  return (
    <div className="rounded-xl bg-surface/70 p-4">
      <p className="text-3xl font-extrabold tracking-tight text-cream">{value}</p>
      <p className="text-xs text-muted">{label}{delta !== undefined && delta !== 0 && <span className={delta > 0 ? " text-emerald-400" : " text-accent2"}> {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}% vs last week</span>}</p>
    </div>
  );
}

/** A hero card: gradient, big art, the headline pick of the week. */
function Hero({ kind, title, subtitle, art, seed, round, colors, to, onPlay, extra }: { kind: string; title: string; subtitle: string; art: string | null; seed: string; round?: boolean; colors: [string, string]; to: string; onPlay?: () => void; extra?: string }) {
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

function Bars({ values, labels, title, highlight }: { values: number[]; labels: (i: number) => string; title: string; highlight?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="rounded-xl bg-surface/70 p-4">
      <p className="text-sm font-semibold text-cream">{title}</p>
      {highlight && <p className="text-xs text-muted">{highlight}</p>}
      <div className="mt-3 flex h-24 items-end gap-[3px]">
        {values.map((v, i) => (
          <div key={i} className="group relative flex-1" title={`${labels(i)}: ${v}`}>
            <div className={`w-full rounded-sm ${v === max && v > 0 ? "bg-accent2" : "bg-cream/30"}`} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-dim"><span>{labels(0)}</span><span>{labels(Math.floor(values.length / 2))}</span><span>{labels(values.length - 1)}</span></div>
    </div>
  );
}

export function WrappedPage() {
  const [params, setParams] = useSearchParams();
  const week = Math.max(0, Number(params.get("week") ?? 0) || 0);
  const q = useQuery({ queryKey: ["music", "wrapped", week], queryFn: () => api<Wrapped>(`/api/music/wrapped?week=${week}`), staleTime: 60_000 });
  const [showAll, setShowAll] = useState(false);
  const [sharing, setSharing] = useState(false);
  const w = q.data;
  async function share() {
    if (!w || sharing) return;
    setSharing(true);
    try {
      const blob = await renderWrappedCard({
        rangeLabel: `${fmtDate(w.from)} – ${fmtDate(w.to - 1)}`, minutes: w.minutes, plays: w.plays, streakDays: w.streakDays,
        song: w.songOfWeek ? { title: w.songOfWeek.title, artist: w.songOfWeek.artist, art: w.songOfWeek.art, plays: w.songOfWeek.plays } : null,
        album: w.albumOfWeek ? { title: w.albumOfWeek.title, artist: w.albumOfWeek.artist, art: w.albumOfWeek.art } : null,
        artist: w.artistOfWeek ? { name: w.artistOfWeek.name, image: w.artistOfWeek.image ?? w.artistOfWeek.art } : null,
        mood: w.mood, topGenre: w.topGenre?.name ?? null, topSongs: w.topSongs,
      });
      const how = await shareCard(blob, `jymusic-week-${fmtDate(w.from).replace(/\s/g, "")}.png`);
      if (how === "saved") pushToast("Saved as an image — post it anywhere");
    } catch { pushToast("Could not make the image"); }
    finally { setSharing(false); }
  }
  if (!w) return <div className="py-20 text-center text-muted">Adding it all up…</div>;

  const pct = (now: number, then: number) => (then ? Math.round(((now - then) / then) * 100) : 0);
  const canGoBack = w.firstWeekWithPlays !== null && w.from > w.firstWeekWithPlays;
  const peakHour = w.byHour.indexOf(Math.max(...w.byHour));
  const peakDay = w.byDay.indexOf(Math.max(...w.byDay));
  const empty = w.plays === 0;

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent2">Your week in music</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{week === 0 ? "This week" : week === 1 ? "Last week" : `${fmtDate(w.from)} – ${fmtDate(w.to - 1)}`}</h1>
          <p className="text-sm text-muted">{fmtDate(w.from)} – {fmtDate(w.to - 1)}{w.streakDays > 1 && week === 0 && <span className="ml-2 inline-flex items-center gap-1 text-gold"><Flame className="h-3.5 w-3.5" />{w.streakDays}-day streak</span>}</p>
        </div>
        <div className="flex gap-2">
          {!empty && (
            <button type="button" onClick={() => void share()} disabled={sharing}
              className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-cream transition hover:bg-accent2 disabled:opacity-60">
              <Share2 className="h-4 w-4" /> {sharing ? "Making…" : "Share"}
            </button>
          )}
          <button type="button" disabled={!canGoBack} onClick={() => setParams({ week: String(week + 1) })} aria-label="Previous week" className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:text-cream disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" disabled={week === 0} onClick={() => setParams({ week: String(week - 1) })} aria-label="Next week" className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:text-cream disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
        </div>
      </div>

      {empty ? (
        <div className="mt-8 rounded-xl bg-surface p-8 text-center"><p className="text-lg font-semibold">Nothing played this week yet</p><p className="mt-1 text-sm text-muted">Plays count after 20 seconds of listening. Come back once you've had a listen.</p></div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={w.minutes.toLocaleString()} label="minutes" delta={pct(w.minutes, w.lastWeek.minutes)} />
            <Stat value={w.plays.toLocaleString()} label="plays" delta={pct(w.plays, w.lastWeek.plays)} />
            <Stat value={w.distinctTracks.toLocaleString()} label="different songs" />
            <Stat value={w.distinctArtists.toLocaleString()} label="artists" />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {w.songOfWeek && (
              <Hero kind="Song of the week" title={w.songOfWeek.title} subtitle={w.songOfWeek.artist} art={w.songOfWeek.art} seed={w.songOfWeek.albumId} colors={["#A32638", "#3A0F16"]}
                to={`/album/${w.songOfWeek.albumId}`} extra={`${w.songOfWeek.plays} plays`} onPlay={() => void playQueue(w.topSongs, 0, { kind: "home", name: "Song of the week" })} />
            )}
            {w.albumOfWeek && (
              <Hero kind="Album of the week" title={w.albumOfWeek.title} subtitle={w.albumOfWeek.artist} art={w.albumOfWeek.art} seed={w.albumOfWeek.id} colors={["#B8741F", "#3A250A"]}
                to={`/album/${w.albumOfWeek.id}`} extra={`${w.albumOfWeek.plays} plays across the album`}
                onPlay={() => api<{ tracks: Track[] }>(`/api/music/albums/${w.albumOfWeek!.id}`).then((r) => playQueue(r.tracks, 0, { kind: "album", name: w.albumOfWeek!.title }))} />
            )}
            {w.artistOfWeek && (
              <Hero kind="Artist of the week" title={w.artistOfWeek.name} subtitle={`${w.artistOfWeek.plays} plays · ${w.artistOfWeek.minutes} min`} art={w.artistOfWeek.image ?? w.artistOfWeek.art} seed={w.artistOfWeek.id} round colors={["#5B3FA8", "#1B1236"]}
                to={`/artist/${w.artistOfWeek.id}`}
                onPlay={() => api<{ topTracks: Track[] }>(`/api/music/artists/${w.artistOfWeek!.id}`).then((r) => playQueue(r.topTracks, 0, { kind: "artist", name: w.artistOfWeek!.name }))} />
            )}
            {w.mood && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg, #1F7A8C, #0B2C33)" }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cream/70">Mood of the week</p>
                <p className="mt-4 text-3xl font-extrabold tracking-tight text-cream">{w.mood.label}</p>
                <p className="text-sm text-cream/80">{w.mood.blurb}</p>
                <p className="mt-3 text-xs text-cream/60">Average {w.mood.tempo} BPM · energy {Math.round(w.mood.energy * 100)}/100{w.topGenre ? ` · ${w.topGenre.share}% ${w.topGenre.name}` : ""}</p>
              </motion.div>
            )}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Bars values={w.byHour} labels={hourLabel} title="Your listening clock" highlight={`Peak around ${hourLabel(peakHour)}`} />
            <Bars values={w.byDay} labels={(i) => DAYS[i]} title="By day" highlight={`${DAYS[peakDay]} was the big one`} />
          </div>

          {w.topSongs.length > 1 && (
            <section className="mt-8">
              <div className="flex items-end justify-between px-1"><h2 className="text-2xl font-extrabold tracking-tight">Top songs</h2><button type="button" onClick={() => void playQueue(w.topSongs, 0, { kind: "home", name: "Top songs this week" })} className="text-sm font-semibold text-muted hover:text-cream">Play all</button></div>
              <TrackList tracks={w.topSongs} context={{ kind: "home", name: "Top songs this week" }} showArt />
            </section>
          )}

          {w.topArtists.length > 1 && (
            <section className="mt-8">
              <h2 className="px-1 text-2xl font-extrabold tracking-tight">Top artists</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {w.topArtists.map((a, i) => (
                  <Link key={a.id} to={`/artist/${a.id}`} className="flex items-center gap-3 rounded-lg bg-surface/60 p-3 hover:bg-surface2">
                    <span className="w-4 text-sm font-bold text-dim">{i + 1}</span>
                    <Art src={a.image ?? a.art} seed={a.id} round className="h-12 w-12 shrink-0" iconSize={0.5} />
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{a.name}</p><p className="text-xs text-muted">{a.plays} plays</p></div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {w.discoveries.length > 0 && (
            <section className="mt-8">
              <div className="flex items-end justify-between px-1">
                <div><h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight"><Sparkles className="h-5 w-5 text-gold" />New this week</h2><p className="text-sm text-muted">Songs you played for the very first time</p></div>
                {w.discoveries.length > 5 && <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm font-semibold text-muted hover:text-cream">{showAll ? "Show fewer" : `Show all ${w.discoveries.length}`}</button>}
              </div>
              <TrackList tracks={showAll ? w.discoveries : w.discoveries.slice(0, 5)} context={{ kind: "home", name: "New this week" }} numbered={false} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
