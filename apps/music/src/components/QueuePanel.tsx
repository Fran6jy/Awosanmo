import { motion } from "framer-motion";
import { Trash2, X } from "lucide-react";
import { clearQueue, jumpTo, removeFromQueue, useCurrent, usePlayer } from "../lib/player";
import { Art } from "./Art";

export function QueuePanel({ onClose }: { onClose: () => void }) {
  const s = usePlayer();
  const now = useCurrent();
  const upcoming = s.order.map((q, i) => ({ track: s.queue[q], orderIndex: i })).slice(s.cursor + 1);

  return (
    <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
      className="fixed bottom-[88px] right-0 top-0 z-30 w-full max-w-sm overflow-y-auto border-l border-line bg-panel/95 p-4 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-cream">Queue</h2>
        <div className="flex gap-2">
          {s.queue.length > 0 && <button type="button" onClick={clearQueue} aria-label="Clear queue" className="text-dim hover:text-cream"><Trash2 className="h-4 w-4" /></button>}
          <button type="button" onClick={onClose} aria-label="Close queue" className="text-dim hover:text-cream"><X className="h-5 w-5" /></button>
        </div>
      </div>
      {s.context && <p className="mt-1 text-xs text-dim">Playing from {s.context.kind}: <span className="text-muted">{s.context.name}</span></p>}

      {now && (
        <>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-dim">Now playing</p>
          <Row art={now.art} seed={now.albumId} title={now.title} artist={now.artist} active />
        </>
      )}
      <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-dim">Next up {upcoming.length ? `(${upcoming.length})` : ""}</p>
      {upcoming.length === 0 && <p className="mt-2 text-sm text-dim">Nothing queued. {s.repeat === "all" ? "The queue will repeat." : ""}</p>}
      <ul className="mt-1">
        {upcoming.map(({ track, orderIndex }) => (
          <li key={`${track.id}-${orderIndex}`} className="group flex items-center gap-1">
            <button type="button" onClick={() => void jumpTo(orderIndex)} className="min-w-0 flex-1 text-left">
              <Row art={track.art} seed={track.albumId} title={track.title} artist={track.artist} />
            </button>
            <button type="button" aria-label="Remove from queue" onClick={() => removeFromQueue(orderIndex)} className="text-dim opacity-0 transition group-hover:opacity-100 hover:text-cream"><X className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
    </motion.aside>
  );
}

function Row({ art, seed, title, artist, active }: { art: string | null; seed: string; title: string; artist: string; active?: boolean }) {
  return (
    <div className={`mt-1 flex items-center gap-3 rounded-md p-2 ${active ? "bg-raised/70" : "hover:bg-raised/50"}`}>
      <Art src={art} seed={seed} alt="" className="h-10 w-10 shrink-0" iconSize={0.5} />
      <div className="min-w-0">
        <p className={`truncate text-sm font-medium ${active ? "text-accent2" : "text-cream"}`}>{title}</p>
        <p className="truncate text-xs text-muted">{artist}</p>
      </div>
    </div>
  );
}
