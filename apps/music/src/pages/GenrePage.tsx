import { useCollectionMenu } from "../lib/menus";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Album, type Track } from "../lib/api";
import { playQueue, toggle, toggleShuffle, usePlayer } from "../lib/player";
import { CollectionHeader } from "../components/CollectionHeader";
import { TrackList } from "../components/TrackList";
import { AlbumCard, Shelf } from "../components/Cards";

type GenreFull = { name: string; total: number; albums: Album[]; tracks: Track[] };

export function GenrePage() {
  const { name = "" } = useParams();
  const s = usePlayer();
  const menu = useCollectionMenu();
  const genre = useQuery({ queryKey: ["music", "genre", name], queryFn: () => api<GenreFull>(`/api/music/genres/${encodeURIComponent(name)}?limit=200`), enabled: Boolean(name) });
  const g = genre.data;
  if (!g) return <div className="py-20 text-center text-muted">Loading…</div>;
  const context = { kind: "genre" as const, name: g.name };
  const isThis = s.context?.name === g.name && s.queue.length > 0;
  return (
    <div>
      <CollectionHeader kind="Genre" title={g.name} art={g.albums.find((a) => a.art)?.art ?? null} seed={g.name} contextName={g.name}
        onMenu={(at) => menu({ kind: "genre", id: g.name, name: g.name, subtitle: `${g.total} songs`, art: g.albums.find((a) => a.art)?.art ?? null }, at)}
        subtitle={`${g.total} song${g.total === 1 ? "" : "s"} · ${g.albums.length} album${g.albums.length === 1 ? "" : "s"}`}
        onPlay={() => (isThis ? void toggle() : void playQueue(g.tracks, 0, context))}
        onShuffle={() => { if (!s.shuffle) toggleShuffle(); void playQueue(g.tracks, 0, context); }} />
      {g.albums.length > 0 && <Shelf title="Albums">{g.albums.slice(0, 12).map((a) => <AlbumCard key={a.id} album={a} onPlay={() => api<{ tracks: Track[] }>(`/api/music/albums/${a.id}`).then((x) => playQueue(x.tracks, 0, { kind: "album", name: a.title }))} />)}</Shelf>}
      <section className="mt-8"><h2 className="px-1 text-2xl font-extrabold tracking-tight">Songs</h2><TrackList tracks={g.tracks} context={context} /></section>
    </div>
  );
}
