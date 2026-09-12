import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { artUrl, fetchShared, fmtTime, shareDownloadUrl, shareStreamUrl, shareZipUrl, type SharedContent } from "../lib/api";
import { Art } from "../components/Art";

/**
 * The page a share link opens: no account, no sidebar, no queue — just the
 * shared collection with its own small player. It deliberately does not touch
 * the main player engine, which is tied to the owner's session.
 */
export function SharePage() {
  const { slug = "" } = useParams();
  const [data, setData] = useState<SharedContent | null | undefined>(undefined);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => { fetchShared(slug).then(setData).catch(() => setData(null)); }, [slug]);
  useEffect(() => { document.title = data ? `${data.title} · JYMusic` : "JYMusic"; }, [data]);

  const tracks = data?.tracks.filter((t) => t.playable) ?? [];
  const current = tracks[cursor];

  // Load the current track into the element; autoplay only after a user gesture started playback.
  useEffect(() => {
    const el = audio.current;
    if (!el || !current) return;
    el.src = shareStreamUrl(slug, current.id);
    setProgress(0);
    if (playing) void el.play().catch(() => setPlaying(false));
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: current.album, artwork: current.art ? [{ src: artUrl(current.art)!, sizes: "512x512" }] : [] });
      navigator.mediaSession.setActionHandler("previoustrack", () => prev());
      navigator.mediaSession.setActionHandler("nexttrack", () => next());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  function playAt(i: number) {
    if (i === cursor && audio.current) {
      if (audio.current.paused) { void audio.current.play(); setPlaying(true); } else { audio.current.pause(); setPlaying(false); }
      return;
    }
    setCursor(i); setPlaying(true);
  }
  const next = () => { if (cursor + 1 < tracks.length) { setCursor(cursor + 1); setPlaying(true); } else setPlaying(false); };
  const prev = () => { if (audio.current && audio.current.currentTime > 3) audio.current.currentTime = 0; else if (cursor > 0) { setCursor(cursor - 1); setPlaying(true); } };

  if (data === undefined) return <Frame><p className="py-20 text-center text-muted">Loading…</p></Frame>;
  if (data === null) {
    return (
      <Frame>
        <div className="py-20 text-center">
          <h1 className="text-2xl font-bold text-cream">This link is no longer available</h1>
          <p className="mt-2 text-sm text-muted">It may have expired or been revoked by whoever shared it.</p>
        </div>
      </Frame>
    );
  }

  const total = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  const pct = duration ? (progress / duration) * 100 : 0;

  return (
    <Frame sharedBy={data.sharedBy}>
      <audio ref={audio} preload="metadata"
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={next} />

      <div className="-mx-4 bg-gradient-to-b from-accent/40 via-surface2/60 to-transparent px-4 pb-6 pt-8 sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
          <Art src={data.art} seed={data.id} alt={data.title} className="h-44 w-44 shrink-0 shadow-card sm:h-56 sm:w-56" iconSize={0.4} />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider">{data.kind === "track" ? "Song" : data.kind}</p>
            <h1 className="mt-1 break-words text-3xl font-extrabold tracking-tight sm:text-5xl">{data.title}</h1>
            <p className="mt-3 text-sm text-muted">{data.subtitle}{tracks.length > 1 ? ` · ${tracks.length} songs, ${fmtTime(total)}` : ""}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 py-4">
        <button type="button" onClick={() => playAt(cursor)} disabled={!current} aria-label={playing ? "Pause" : "Play"}
          className="grid h-14 w-14 place-items-center rounded-full bg-accent text-cream shadow-glow transition hover:scale-105 hover:bg-accent2 disabled:opacity-40">
          {playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="ml-1 h-6 w-6 fill-current" />}
        </button>
        {data.allowDownload && (
          tracks.length > 1
            ? <a href={shareZipUrl(slug)} className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-cream hover:text-cream"><Download className="h-4 w-4" /> Download all (zip)</a>
            : current && <a href={shareDownloadUrl(slug, current.id)} className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-cream hover:text-cream"><Download className="h-4 w-4" /> Download</a>
        )}
      </div>

      <ul className="mt-2 divide-y divide-line">
        {tracks.map((t, i) => {
          const active = i === cursor;
          return (
            <li key={t.id} className={`group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-surface2 ${active ? "bg-surface2/60" : ""}`}>
              <button type="button" onClick={() => playAt(i)} aria-label={active && playing ? "Pause" : "Play"} className="grid w-8 shrink-0 place-items-center text-sm tabular-nums text-dim">
                {active && playing ? <Volume2 className="h-4 w-4 text-accent2" /> : <><span className="group-hover:hidden">{i + 1}</span><Play className="hidden h-4 w-4 fill-current text-cream group-hover:block" /></>}
              </button>
              {data.kind !== "album" && <Art src={t.art} seed={t.albumId} className="h-10 w-10 shrink-0" iconSize={0.5} />}
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-semibold ${active ? "text-accent2" : "text-cream"}`}>{t.title}</p>
                <p className="truncate text-xs text-muted">{t.artist}{data.kind !== "album" ? ` · ${t.album}` : ""}</p>
              </div>
              <span className="text-xs tabular-nums text-muted">{fmtTime(t.duration)}</span>
              {data.allowDownload && <a href={shareDownloadUrl(slug, t.id)} aria-label={`Download ${t.title}`} title="Download" className="text-dim hover:text-cream"><Download className="h-4 w-4" /></a>}
            </li>
          );
        })}
      </ul>
      {tracks.length === 0 && <p className="py-10 text-center text-sm text-muted">Nothing playable here.</p>}

      {/* mini player */}
      {current && (
        <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="h-0.5 w-full bg-raised"><div className="h-full bg-accent2" style={{ width: `${pct}%` }} /></div>
          <div className="mx-auto flex h-[72px] max-w-3xl items-center gap-3 px-4">
            <Art src={current.art} seed={current.albumId} className="h-12 w-12 shrink-0" iconSize={0.5} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-cream">{current.title}</p>
              <p className="truncate text-xs text-muted">{current.artist} · {fmtTime(progress)} / {fmtTime(duration)}</p>
            </div>
            <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(progress, duration || 1)} aria-label="Seek"
              onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value); }}
              className="slider hidden w-48 sm:block" style={{ background: `linear-gradient(to right, var(--slider-fill) ${pct}%, #3a2d2d ${pct}%)` }} />
            <button type="button" onClick={prev} aria-label="Previous" className="text-muted hover:text-cream"><SkipBack className="h-5 w-5 fill-current" /></button>
            <button type="button" onClick={() => playAt(cursor)} aria-label={playing ? "Pause" : "Play"} className="grid h-10 w-10 place-items-center rounded-full bg-cream text-ink">
              {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
            </button>
            <button type="button" onClick={next} aria-label="Next" className="text-muted hover:text-cream"><SkipForward className="h-5 w-5 fill-current" /></button>
          </div>
        </footer>
      )}
    </Frame>
  );
}

function Frame({ children, sharedBy }: { children: React.ReactNode; sharedBy?: string }) {
  return (
    <div className="min-h-screen bg-ink pb-28 text-cream">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2"><img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" /><span className="text-lg font-extrabold tracking-tight">JYMusic</span></Link>
        {sharedBy && <p className="text-xs text-dim">Shared by <span className="text-muted">{sharedBy}</span></p>}
      </header>
      <main className="mx-auto max-w-3xl px-4 sm:px-6">{children}</main>
    </div>
  );
}
