import { crossfadeSupported, setCrossfade, setGaplessAlbums, usePlayer } from "../lib/player";

const CROSSFADE_STEPS = [0, 3, 6, 9, 12];

/** Crossfade length and the gapless-album exception; used by the desktop popover and the Now Playing sheet. */
export function CrossfadeControls() {
  const s = usePlayer();
  const supported = crossfadeSupported();
  return (
    <>
      <div>
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
