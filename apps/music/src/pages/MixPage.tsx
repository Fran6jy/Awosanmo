import { useCollectionMenu } from "../lib/menus";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { pushToast } from "../components/Toast";
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
  const qc = useQueryClient();
  const menu = useCollectionMenu();
  const q = useQuery({ queryKey: ["music", kind, id], queryFn: () => load(kind, id), enabled: Boolean(id), staleTime: 5 * 60_000 });
  const refresh = useMutation({
    mutationFn: () => api(`/api/music/mixes/${encodeURIComponent(id)}/refresh`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["music", kind, id] }); pushToast("Dealt a fresh hand"); },
  });
  const d = q.data;
  if (q.isError) return <div className="py-20 text-center text-muted">This {kind} isn't available right now.</div>;
  if (!d) return <div className="py-20 text-center text-muted">Loading…</div>;
  const head = d.head;
  const context = { kind, name: head.name, id };
  const isThis = s.context?.name === head.name && s.queue.length > 0;
  const total = d.tracks.reduce((a, t) => a + (t.duration ?? 0), 0);
  const label = kind === "mood" ? "Mood" : d.mixKind === "daily" ? "Daily mix" : d.mixKind === "discover" ? "Discover" : "For right now";

  return (
    <div>
      <CollectionHeader kind={label} title={head.name} art={head.art} seed={head.id} contextName={head.name} colors={head.colors}
        onMenu={(at) => menu({ kind, id, name: head.name, subtitle: head.blurb, art: head.art }, at)}
        subtitle={<>{head.blurb} · {d.tracks.length} songs, {Math.round(total / 60)} min{kind === "mix" ? " · changes daily" : ""}</>}
        onPlay={() => (isThis ? void toggle() : void playQueue(d.tracks, 0, context))}
        onShuffle={() => { if (!s.shuffle) toggleShuffle(); void playQueue(d.tracks, 0, context); }}>
        <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-label="New selection" title="Deal a fresh selection now"
          className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-muted transition hover:border-cream hover:text-cream disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${refresh.isPending || q.isFetching ? "animate-spin" : ""}`} /> Refresh
        </button>
      </CollectionHeader>
      <p className="-mt-1 mb-2 px-1 text-xs text-dim">Skip a song in its first 20 seconds and it leaves this {kind} for two weeks. Refresh deals a new selection now; it renews on its own every day.</p>
      <TrackList tracks={d.tracks} context={context} />
    </div>
  );
}
