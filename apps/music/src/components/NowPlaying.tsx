import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ChevronDown, Heart, ListMusic, MoreHorizontal, Pause, Play, Repeat, Repeat1, Share2, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { artUrl, fmtTime } from "../lib/api";
import { cycleRepeat, next, prev, seek, toggle, toggleShuffle, useCurrent, usePlayer } from "../lib/player";
import { Art } from "./Art";
import { QueuePanel } from "./QueuePanel";
import { ShareDialog } from "./ShareDialog";
import { CrossfadeControls } from "./CrossfadeControls";
import { useLike } from "./TrackList";

/**
 * Full-screen "Now Playing" — the view a tap on the mini bar opens on a phone
 * (Apple Music / Spotify style). Big artwork over a blurred copy of itself, a
 * scrub bar you can drag, the transport, and everything else that did not fit
 * in the bar: like, share, queue, crossfade. Swipe down or tap the chevron to close.
 */
export function NowPlaying({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = usePlayer();
  const track = useCurrent();
  const like = useLike();
  const [queueOpen, setQueueOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // While dragging the scrub bar, show the finger position rather than the live one.
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    if (!open) { setQueueOpen(false); setMoreOpen(false); }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onDragEnd = (_e: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  const art = track ? artUrl(track.art) : null;
  const pos = scrub ?? s.progress;
  const pct = s.duration ? (pos / s.duration) * 100 : 0;
  const RepeatIcon = s.repeat === "one" ? Repeat1 : Repeat;

  return (
    <AnimatePresence>
      {open && track && (
        <motion.section key="now-playing" role="dialog" aria-modal="true" aria-label="Now playing"
          initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
          drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }} onDragEnd={onDragEnd}
          className="fixed inset-0 z-[45] flex flex-col overflow-hidden bg-ink text-cream"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
          {/* blurred artwork wash */}
          {art && <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 scale-125 bg-cover bg-center opacity-40 blur-3xl saturate-150" style={{ backgroundImage: `url(${art})` }} />}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-ink/30 via-ink/60 to-ink" />

          <header className="flex items-center justify-between px-5 pt-3">
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full text-muted hover:text-cream"><ChevronDown className="h-7 w-7" /></button>
            <div className="min-w-0 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-dim">Playing from {s.context?.kind ?? "library"}</p>
              {s.context && <p className="truncate text-sm font-semibold text-muted">{s.context.name}</p>}
            </div>
            <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-label="More" className="grid h-10 w-10 place-items-center rounded-full text-muted hover:text-cream"><MoreHorizontal className="h-6 w-6" /></button>
          </header>

          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">
            <motion.div key={track.id} initial={{ scale: 0.96, opacity: 0.6 }} animate={{ scale: s.playing ? 1 : 0.9, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="mx-auto aspect-square w-full max-w-[min(82vw,420px)]">
              <Art src={track.art} seed={track.albumId} alt="" className="h-full w-full rounded-xl shadow-card" iconSize={0.4} />
            </motion.div>

            <div className="mt-8 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Link to={`/album/${track.albumId}`} onClick={onClose} className="block truncate text-xl font-extrabold tracking-tight">{track.title}</Link>
                <Link to={`/artist/${track.artistId}`} onClick={onClose} className="block truncate text-base text-muted">{track.artist}</Link>
              </div>
              <button type="button" aria-label={track.liked ? "Unlike" : "Like"} onClick={() => like.mutate({ id: track.id, liked: !track.liked })}
                className={`grid h-10 w-10 shrink-0 place-items-center ${track.liked ? "text-accent2" : "text-muted hover:text-cream"}`}>
                <Heart className={`h-6 w-6 ${track.liked ? "fill-current" : ""}`} />
              </button>
            </div>

            {/* scrub bar */}
            <div className="mt-5">
              <input type="range" min={0} max={s.duration || 1} step={0.1} value={Math.min(pos, s.duration || 1)} aria-label="Seek"
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerUp={() => { if (scrub !== null) { seek(scrub); setScrub(null); } }}
                onKeyUp={() => { if (scrub !== null) { seek(scrub); setScrub(null); } }}
                className="slider slider-lg w-full"
                style={{ background: `linear-gradient(to right, #F5EDE8 ${pct}%, rgba(255,255,255,.18) ${pct}%)` }} />
              <div className="mt-1 flex justify-between text-xs tabular-nums text-muted">
                <span>{fmtTime(pos)}</span><span>-{fmtTime(Math.max(0, s.duration - pos))}</span>
              </div>
            </div>

            {/* transport */}
            <div className="mt-4 flex items-center justify-between">
              <button type="button" aria-label="Shuffle" onClick={toggleShuffle} className={`relative grid h-12 w-12 place-items-center ${s.shuffle ? "text-accent2" : "text-muted"}`}>
                <Shuffle className="h-6 w-6" />{s.shuffle && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent2" />}
              </button>
              <button type="button" aria-label="Previous" onClick={() => void prev()} className="grid h-14 w-14 place-items-center text-cream"><SkipBack className="h-9 w-9 fill-current" /></button>
              <button type="button" aria-label={s.playing ? "Pause" : "Play"} onClick={() => void toggle()}
                className="grid h-[72px] w-[72px] place-items-center rounded-full bg-cream text-ink shadow-glow transition active:scale-95">
                {s.playing ? <Pause className="h-8 w-8 fill-current" /> : <Play className="ml-1 h-8 w-8 fill-current" />}
              </button>
              <button type="button" aria-label="Next" onClick={() => void next()} className="grid h-14 w-14 place-items-center text-cream"><SkipForward className="h-9 w-9 fill-current" /></button>
              <button type="button" aria-label={`Repeat: ${s.repeat}`} onClick={cycleRepeat} className={`relative grid h-12 w-12 place-items-center ${s.repeat !== "off" ? "text-accent2" : "text-muted"}`}>
                <RepeatIcon className="h-6 w-6" />{s.repeat !== "off" && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent2" />}
              </button>
            </div>
          </div>

          <footer className="mx-auto flex w-full max-w-md items-center justify-between px-8 pb-4 pt-2">
            <button type="button" onClick={() => setSharing(true)} aria-label="Share" className="grid h-11 w-11 place-items-center text-muted hover:text-cream"><Share2 className="h-5 w-5" /></button>
            <p className="text-xs text-dim">{s.crossfade ? `Crossfade ${s.crossfade}s` : ""}</p>
            <button type="button" onClick={() => setQueueOpen(true)} aria-label="Queue" className="grid h-11 w-11 place-items-center text-muted hover:text-cream"><ListMusic className="h-5 w-5" /></button>
          </footer>

          {/* "more" sheet: crossfade + gapless, kept out of the main view */}
          <AnimatePresence>
            {moreOpen && (
              <>
                <div className="absolute inset-0 z-10 bg-black/40" onClick={() => setMoreOpen(false)} />
                <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
                  className="absolute inset-x-0 bottom-0 z-20 rounded-t-2xl border-t border-line bg-raised p-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}>
                  <CrossfadeControls />
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} overlay />}
          {sharing && <ShareDialog kind="track" id={track.id} name={`${track.title} — ${track.artist}`} onClose={() => setSharing(false)} />}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
