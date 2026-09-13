import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Album, type Artist, type Track } from "../lib/api";
import { playQueue, toggle, toggleShuffle, usePlayer } from "../lib/player";
import { CollectionHeader } from "../components/CollectionHeader";
import { TrackList } from "../components/TrackList";
import { AlbumCard, Shelf } from "../components/Cards";

type ArtistFull = Artist & { albums: Album[]; topTracks: Track[] };

export function ArtistPage() {
  const { id } = useParams();
  const s = usePlayer();
  const artist = useQuery({ queryKey: ["music", "artist", id], queryFn: () => api<ArtistFull>(`/api/music/artists/${id}`), enabled: Boolean(id) });
  const a = artist.data;
  if (!a) return <div className="py-20 text-center text-muted">Loading…</div>;

  const context = { kind: "artist" as const, name: a.name };
  const isThis = s.context?.name === a.name && s.queue.length > 0;
  // "Play" on an artist plays everything they have, popular first.
  const playAll = async () => {
    const all: Track[] = [...a.topTracks];
    for (const al of a.albums) {
      const full = await api<{ tracks: Track[] }>(`/api/music/albums/${al.id}`);
      for (const t of full.tracks) if (!all.some((x) => x.id === t.id)) all.push(t);
    }
    return all;
  };
  const albums = a.albums.filter((x) => x.trackCount > 1);
  const singles = a.albums.filter((x) => x.trackCount === 1);

  return (
    <div>
      <CollectionHeader kind="Artist" title={a.name} art={a.image ?? a.art} seed={a.id} round contextName={a.name}
        subtitle={`${a.trackCount} song${a.trackCount === 1 ? "" : "s"} · ${a.albumCount} release${a.albumCount === 1 ? "" : "s"}`}
        onPlay={() => (isThis ? void toggle() : playAll().then((t) => playQueue(t, 0, context)))}
        onShuffle={() => { if (!s.shuffle) toggleShuffle(); playAll().then((t) => playQueue(t, 0, context)); }} />
      <section>
        <h2 className="px-1 text-2xl font-extrabold tracking-tight">Popular</h2>
        <TrackList tracks={a.topTracks} context={context} showAlbum={false} />
      </section>
      {albums.length > 0 && <Shelf title="Albums">{albums.map((x) => <AlbumCard key={x.id} album={x} onPlay={() => api<{ tracks: Track[] }>(`/api/music/albums/${x.id}`).then((al) => playQueue(al.tracks, 0, { kind: "album", name: x.title }))} />)}</Shelf>}
      {singles.length > 0 && <Shelf title="Singles">{singles.map((x) => <AlbumCard key={x.id} album={x} onPlay={() => api<{ tracks: Track[] }>(`/api/music/albums/${x.id}`).then((al) => playQueue(al.tracks, 0, { kind: "album", name: x.title }))} />)}</Shelf>}
    </div>
  );
}
