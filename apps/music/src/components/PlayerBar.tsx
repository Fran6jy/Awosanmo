import { useState } from "react";
import { Link } from "react-router-dom";
import { Heart, ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Volume1, Volume2, VolumeX } from "lucide-react";
import { fmtTime } from "../lib/api";
import { crossfadeSupported, cycleRepeat, next, prev, seek, setCrossfade, setGaplessAlbums, setVolume, takeOver, toggle, toggleMute, toggleShuffle, useCurrent, usePlayer } from "../lib/player";
import { useRemotePlayback } from "../lib/session";
import { MonitorSpeaker } from "lucide-react";
import { Art } from "./Art";
import { useLike } from "./TrackList";
import { QueuePanel } from "./QueuePanel";

/** A range input styled as a thin bar that turns maroon on hover, like Spotify's. */
function Slider({ value, max, onChange, className = "" }: { value: number; max: number; onChange: (v: number) => void; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <input type="range" min={0} max={max || 1} step={0.1} value={Math.min(value, max || 1)}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`slider ${className}`}
      style={{ background: `linear-gradient(to right, var(--slider-fill) ${pct}%, #3a2d2d ${pct}%)` }} />
  );
}

export function PlayerBar() {
  const s = usePlayer();
  const track = useCurrent();
  const like = useLike();
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const remote = useRemotePlayback();
  const [switching, setSwitching] = useState(false);
  const VolIcon = s.muted || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2;
  // Only a device that is actually playing right now is worth announcing.
  const elsewhere = remote && remote.playing && !remote.stale ? remote : null;

  return (
    <>
      {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
      {settingsOpen && <PlaybackSettings onClose={() => setSettingsOpen(false)} />}
      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {/* Spotify Connect-style banner: the session is live on another device. */}
        {elsewhere && (
          <div className="flex items-center gap-3 bg-accent px-4 py-1.5 text-sm text-cream">
            <MonitorSpeaker className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 truncate">
              <span className="font-bold">Playing on {elsewhere.deviceName}</span>
              {elsewhere.track && <span className="text-cream/85"> · {elsewhere.track.title} — {elsewhere.track.artist}</span>}
            </p>
            <button type="button" disabled={switching}
              onClick={async () => { setSwitching(true); try { await takeOver(elsewhere); } finally { setSwitching(false); } }}
              className="shrink-0 rounded-full bg-cream px-3 py-1 text-xs font-bold text-ink transition hover:scale-105 disabled:opacity-60">
              {switching ? "Switching…" : "Play here"}
            </button>
          </div>
        )}
        {/* mobile: progress strip along the very top of the bar */}
        <div className="h-0.5 w-full bg-raised sm:hidden"><div className="h-full bg-accent2" style={{ width: `${s.duration ? (s.progress / s.duration) * 100 : 0}%` }} /></div>
        <div className="mx-auto grid h-[72px] max-w-screen-2xl grid-cols-[1fr_auto] items-center gap-3 px-3 sm:h-[88px] sm:grid-cols-[1fr_2fr_1fr] sm:px-4">
          {/* now playing */}
          <div className="flex min-w-0 items-center gap-3">
            {track ? (
              <>
                <Art src={track.art} seed={track.albumId} alt="" className="h-12 w-12 shrink-0 shadow-card sm:h-14 sm:w-14" iconSize={0.5} />
                <div className="min-w-0">
                  <Link to={`/album/${track.albumId}`} className="block truncate text-sm font-semibold text-cream hover:underline">{track.title}</Link>
                  <Link to={`/artist/${track.artistId}`} className="block truncate text-xs text-muted hover:text-cream hover:underline">{track.artist}</Link>
                </div>
                <button type="button" aria-label={track.liked ? "Unlike" : "Like"} onClick={() => like.mutate({ id: track.id, liked: !track.liked })}
                  className={`ml-1 hidden shrink-0 sm:block ${track.liked ? "text-accent2" : "text-dim hover:text-cream"}`}>
                  <Heart className={`h-4 w-4 ${track.liked ? "fill-current" : ""}`} />
                </button>
              </>
            ) : <p className="text-sm text-dim">Nothing playing</p>}
          </div>

          {/* transport (desktop) */}
          <div className="hidden flex-col items-center gap-1.5 sm:flex">
            <div className="flex items-center gap-4">
              <button type="button" aria-label="Shuffle" onClick={toggleShuffle} className={`relative ${s.shuffle ? "text-accent2" : "text-dim hover:text-cream"}`}>
                <Shuffle className="h-4 w-4" />{s.shuffle && <span className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent2" />}
              </button>
              <button type="button" aria-label="Previous" onClick={() => void prev()} className="text-muted hover:text-cream"><SkipBack className="h-5 w-5 fill-current" /></button>
              <button type="button" aria-label={s.playing ? "Pause" : "Play"} onClick={() => void toggle()} disabled={!track}
                className="grid h-9 w-9 place-items-center rounded-full bg-cream text-ink transition hover:scale-105 disabled:opacity-40">
                {s.playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
              </button>
              <button type="button" aria-label="Next" onClick={() => void next()} className="text-muted hover:text-cream"><SkipForward className="h-5 w-5 fill-current" /></button>
              <button type="button" aria-label={`Repeat: ${s.repeat}`} onClick={cycleRepeat} className={`relative ${s.repeat !== "off" ? "text-accent2" : "text-dim hover:text-cream"}`}>
                {s.repeat === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                {s.repeat !== "off" && <span className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent2" />}
              </button>
            </div>
            <div className="flex w-full max-w-xl items-center gap-2 text-xs tabular-nums text-muted">
              <span className="w-10 text-right">{fmtTime(s.progress)}</span>
              <Slider value={s.progress} max={s.duration} onChange={seek} className="flex-1" />
              <span className="w-10">{fmtTime(s.duration)}</span>
            </div>
          </div>

          {/* right cluster */}
          <div className="flex items-center justify-end gap-2 sm:gap-3">
            {/* mobile transport */}
            <button type="button" aria-label={track?.liked ? "Unlike" : "Like"} onClick={() => track && like.mutate({ id: track.id, liked: !track.liked })}
              className={`sm:hidden ${track?.liked ? "text-accent2" : "text-dim"}`}><Heart className={`h-5 w-5 ${track?.liked ? "fill-current" : ""}`} /></button>
            <button type="button" aria-label={s.playing ? "Pause" : "Play"} onClick={() => void toggle()} disabled={!track}
              className="grid h-10 w-10 place-items-center rounded-full bg-cream text-ink sm:hidden disabled:opacity-40">
              {s.playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
            </button>
            <button type="button" aria-label="Next" onClick={() => void next()} className="text-muted sm:hidden"><SkipForward className="h-5 w-5 fill-current" /></button>
            {/* desktop extras */}
            <button type="button" aria-label="Queue" onClick={() => setQueueOpen((o) => !o)} className={`hidden sm:block ${queueOpen ? "text-accent2" : "text-dim hover:text-cream"}`}><ListMusic className="h-4 w-4" /></button>
            <button type="button" aria-label="Playback settings" title="Crossfade & playback" onClick={() => setSettingsOpen((o) => !o)}
              className={`${settingsOpen || s.crossfade ? "text-accent2" : "text-dim hover:text-cream"}`}><SlidersHorizontal className="h-4 w-4" /></button>
            <button type="button" aria-label="Mute" onClick={toggleMute} className="hidden text-dim hover:text-cream sm:block"><VolIcon className="h-4 w-4" /></button>
            <Slider value={s.muted ? 0 : s.volume} max={1} onChange={setVolume} className="hidden w-24 sm:block" />
          </div>
        </div>
      </footer>
    </>
  );
}

const CROSSFADE_STEPS = [0, 3, 6, 9, 12];

/** Small popover above the bar: crossfade length and the gapless-album exception. */
function PlaybackSettings({ onClose }: { onClose: () => void }) {
  const s = usePlayer();
  const supported = crossfadeSupported();
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="fixed bottom-[80px] right-3 z-40 w-72 rounded-xl border border-line bg-raised p-4 shadow-card sm:bottom-[96px]" role="dialog" aria-label="Playback settings">
        <p className="text-xs font-semibold uppercase tracking-wider text-dim">Crossfade</p>
        <div className="mt-2 flex gap-1.5">
          {CROSSFADE_STEPS.map((n) => (
            <button key={n} type="button" disabled={!supported && n > 0} onClick={() => setCrossfade(n)}
              className={`flex-1 rounded-full py-1.5 text-xs font-semibold transition disabled:opacity-40 ${s.crossfade === n ? "bg-cream text-ink" : "bg-surface2 text-cream hover:bg-panel"}`}>
              {n === 0 ? "Off" : `${n}s`}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {supported ? "The next song fades in under the end of the current one." : "Not available in this browser — iPhone and iPad browsers do not let web apps change playback volume."}
        </p>
        <label className={`mt-4 flex cursor-pointer items-start justify-between gap-3 ${s.crossfade ? "" : "opacity-50"}`}>
          <span>
            <span className="block text-sm font-semibold text-cream">Keep albums gapless</span>
            <span className="block text-xs text-muted">Consecutive tracks of an album run straight through, so live sets and mixes stay intact.</span>
          </span>
          <input type="checkbox" checked={s.gaplessAlbums} disabled={!s.crossfade} onChange={(e) => setGaplessAlbums(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-accent" />
        </label>
      </div>
    </>
  );
}
