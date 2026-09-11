import { Camera, Pause, Play, Shuffle } from "lucide-react";
import { Art } from "./Art";
import { usePlayer } from "../lib/player";

/**
 * The big hero at the top of album / artist / playlist pages: large art on a
 * tinted background, a type label, the title, and a maroon play button.
 */
export function CollectionHeader({ kind, title, subtitle, art, seed, round, onPlay, onShuffle, contextName, children, onChangeArt }: {
  kind: string; title: string; subtitle: React.ReactNode; art: string | null; seed: string; round?: boolean;
  onPlay: () => void; onShuffle?: () => void; contextName: string; children?: React.ReactNode;
  /** When set, the cover becomes clickable and opens an image picker (playlists). */
  onChangeArt?: (file: File) => void;
}) {
  const s = usePlayer();
  const isThis = s.context?.name === contextName && s.playing;
  return (
    <>
      <div className="-mx-4 -mt-3 bg-gradient-to-b from-accent/40 via-surface2/60 to-transparent px-4 pb-6 pt-6 md:-mx-6 md:px-6 md:pt-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
          {onChangeArt ? (
            <label className="group relative h-44 w-44 shrink-0 cursor-pointer sm:h-56 sm:w-56" title="Choose a cover image">
              <Art src={art} seed={seed} alt={title} round={round} className="h-full w-full shadow-card" iconSize={0.4} />
              <span className="absolute inset-0 grid place-items-center rounded-md bg-black/0 text-cream opacity-0 transition group-hover:bg-black/55 group-hover:opacity-100">
                <span className="flex flex-col items-center gap-1 text-sm font-semibold"><Camera className="h-8 w-8" />Choose photo</span>
              </span>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onChangeArt(f); e.target.value = ""; }} />
            </label>
          ) : (
            <Art src={art} seed={seed} alt={title} round={round} className="h-44 w-44 shrink-0 shadow-card sm:h-56 sm:w-56" iconSize={0.4} />
          )}
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider">{kind}</p>
            <h1 className="mt-1 break-words text-3xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">{title}</h1>
            <p className="mt-3 text-sm text-muted">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 py-4">
        <button type="button" onClick={onPlay} aria-label={isThis ? "Pause" : "Play"}
          className="grid h-14 w-14 place-items-center rounded-full bg-accent text-cream shadow-glow transition hover:scale-105 hover:bg-accent2">
          {isThis ? <Pause className="h-6 w-6 fill-current" /> : <Play className="ml-1 h-6 w-6 fill-current" />}
        </button>
        {onShuffle && <button type="button" onClick={onShuffle} aria-label="Shuffle" className="text-muted transition hover:scale-105 hover:text-cream"><Shuffle className="h-7 w-7" /></button>}
        {children}
      </div>
    </>
  );
}
