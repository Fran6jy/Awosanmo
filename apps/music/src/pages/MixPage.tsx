import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Mix, type Mood, type Track } from "../lib/api";
import { playQueue, toggle, toggleShuffle, usePlayer } from "../lib/player";
import { CollectionHeader } from "../components/CollectionHeader";
import { TrackList } from "../components/TrackList";

type MixFull = { mix: Mix; tracks: Track[] };
type MoodFull = { mood: Mood; tracks: Track[] };
type Loaded = { head: Mix | Mood; mixKind: Mix["kind"] | null; tracks: Track[] };

async function load(kind: "mix" | "mood", id: string): Promise<Loaded> {
  if (kind === "mix") { const r = await api<MixFull>(`/api/music/mixes/${encodeURIComponent(id)}`); return { head: r.mix, mixKind: r.mix.kind, tracks: r.tracks }; }
  const r = await api<MoodFull>(`/api/music/moods/${encodeURIComponent(id)}`);
  return { head: r.mood, mixKind: null, tracks: r.tracks };
}

/** One page for both moods and mixes: a coloured hero, play/shuffle, the songs. */
export function MixPage({ kind }: { kind: "mix" | "mood" }) {
  const { id = "" } = useParams();
  const s = usePlayer();
  const q = useQuery({ queryKey: ["music", kind, id], queryFn: () => load(kind, id), enabled: Boolean(id), staleTime: 5 * 60_000 });
  const d = q.data;
  if (q.isError) return <div className="py-20 text-center text-muted">This {kind} isn't available right now.</div>;
  if (!d) return <div className="py-20 text-center text-muted">Loading…</div>;
  const head = d.head;
  const context = { kind: "home" as const, name: head.name };
  const isThis = s.context?.name === head.name && s.queue.length > 0;
  const total = d.tracks.reduce((a, t) => a + (t.duration ?? 0), 0);
  const label = kind === "mood" ? "Mood" : d.mixKind === "daily" ? "Daily mix" : d.mixKind === "discover" ? "Discover" : "For right now";

  return (
    <div>
      <CollectionHeader kind={label} title={head.name} art={head.art} seed={head.id} contextName={head.name} colors={head.colors}
        subtitle={<>{head.blurb} · {d.tracks.length} songs, {Math.round(total / 60)} min{kind === "mix" ? " · changes daily" : ""}</>}
        onPlay={() => (isThis ? void toggle() : void playQueue(d.tracks, 0, context))}
        onShuffle={() => { if (!s.shuffle) toggleShuffle(); void playQueue(d.tracks, 0, context); }} />
      <TrackList tracks={d.tracks} context={context} />
    </div>
  );
}
