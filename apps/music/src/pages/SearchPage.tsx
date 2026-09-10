import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Album, type Artist, type Genre, type Track } from "../lib/api";
import { playQueue } from "../lib/player";
import { AlbumCard, ArtistCard, GenreCard, Shelf } from "../components/Cards";
import { TrackList } from "../components/TrackList";

type Results = { tracks: Track[]; albums: Album[]; artists: Artist[] };

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const results = useQuery({ queryKey: ["music", "search", q], queryFn: () => api<Results>(`/api/music/search?q=${encodeURIComponent(q)}`), enabled: q.length > 0, placeholderData: (prev) => prev });
  const genres = useQuery({ queryKey: ["music", "genres"], queryFn: () => api<Genre[]>("/api/music/genres"), enabled: !q });

  if (!q) {
    return (
      <div className="py-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Browse all</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {(genres.data ?? []).map((g) => <GenreCard key={g.name} genre={g} />)}
        </div>
      </div>
    );
  }
  const r = results.data;
  if (!r) return <div className="py-20 text-center text-muted">Searching…</div>;
  const nothing = !r.tracks.length && !r.albums.length && !r.artists.length;
  if (nothing) return <div className="py-20 text-center"><p className="text-lg font-semibold">No results for “{q}”</p><p className="mt-1 text-sm text-muted">Check the spelling, or try an artist or album name.</p></div>;

  return (
    <div className="py-4">
      {r.tracks.length > 0 && (
        <section>
          <h2 className="px-1 text-2xl font-extrabold tracking-tight">Songs</h2>
          <TrackList tracks={r.tracks.slice(0, 10)} context={{ kind: "search", name: q }} numbered={false} />
        </section>
      )}
      {r.artists.length > 0 && (
        <Shelf title="Artists">{r.artists.map((a) => <ArtistCard key={a.id} artist={a} onPlay={() => api<{ topTracks: Track[] }>(`/api/music/artists/${a.id}`).then((x) => playQueue(x.topTracks, 0, { kind: "artist", name: a.name }))} />)}</Shelf>
      )}
      {r.albums.length > 0 && (
        <Shelf title="Albums">{r.albums.map((a) => <AlbumCard key={a.id} album={a} onPlay={() => api<{ tracks: Track[] }>(`/api/music/albums/${a.id}`).then((x) => playQueue(x.tracks, 0, { kind: "album", name: a.title }))} />)}</Shelf>
      )}
    </div>
  );
}
