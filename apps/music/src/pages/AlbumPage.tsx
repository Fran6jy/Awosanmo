import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, fmtLong, type Album, type Track } from "../lib/api";
import { playQueue, toggle, toggleShuffle, usePlayer } from "../lib/player";
import { CollectionHeader } from "../components/CollectionHeader";
import { TrackList } from "../components/TrackList";
import { AlbumCard, Shelf } from "../components/Cards";

type AlbumFull = Album & { tracks: Track[] };
type ArtistFull = { albums: Album[] };

export function AlbumPage() {
  const { id } = useParams();
  const s = usePlayer();
  const album = useQuery({ queryKey: ["music", "album", id], queryFn: () => api<AlbumFull>(`/api/music/albums/${id}`), enabled: Boolean(id) });
  const more = useQuery({ queryKey: ["music", "artist", album.data?.artistId], queryFn: () => api<ArtistFull>(`/api/music/artists/${album.data!.artistId}`), enabled: Boolean(album.data?.artistId) });
  const a = album.data;
  if (!a) return <div className="py-20 text-center text-muted">Loading…</div>;

  const context = { kind: "album" as const, name: a.title };
  const isThis = s.context?.name === a.title && s.queue.length > 0;
  const isSingle = a.trackCount === 1;
  const others = (more.data?.albums ?? []).filter((x) => x.id !== a.id).slice(0, 6);

  return (
    <div>
      <CollectionHeader kind={isSingle ? "Single" : "Album"} title={a.title} art={a.art} seed={a.id} contextName={a.title}
        subtitle={<><Link to={`/artist/${a.artistId}`} className="font-semibold text-cream hover:underline">{a.artist}</Link>{a.year ? ` · ${a.year}` : ""} · {a.trackCount} song{a.trackCount === 1 ? "" : "s"}, {fmtLong(a.duration)}</>}
        onPlay={() => (isThis ? void toggle() : void playQueue(a.tracks, 0, context))}
        onShuffle={() => { if (!s.shuffle) toggleShuffle(); void playQueue(a.tracks, 0, context); }} />
      <TrackList tracks={a.tracks} context={context} showAlbum={false} showArt={false} />
      {others.length > 0 && <Shelf title={`More by ${a.artist}`} to={`/artist/${a.artistId}`}>{others.map((x) => <AlbumCard key={x.id} album={x} />)}</Shelf>}
    </div>
  );
}
