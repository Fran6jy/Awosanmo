import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, forgetSearches, recentSearches, rememberSearch, type Album, type Artist, type Genre, type Mood, type Track } from "../lib/api";
import { playQueue } from "../lib/player";
import { AlbumCard, ArtistCard, GenreCard, MoodCard, Shelf } from "../components/Cards";
import { TrackList } from "../components/TrackList";

type Results = { tracks: Track[]; albums: Album[]; artists: Artist[] };

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const results = useQuery({ queryKey: ["music", "search", q], queryFn: () => api<Results>(`/api/music/search?q=${encodeURIComponent(q)}`), enabled: q.length > 0, placeholderData: (prev) => prev });
  const genres = useQuery({ queryKey: ["music", "genres"], queryFn: () => api<Genre[]>("/api/music/genres"), enabled: !q });
  const moods = useQuery({ queryKey: ["music", "moods"], queryFn: () => api<Mood[]>("/api/music/moods"), enabled: !q, staleTime: 5 * 60_000 });
  const [recent, setRecent] = useState(recentSearches);
  const r = results.data;
  // A search that found something is worth remembering for next time.
  useEffect(() => { if (q && r && (r.tracks.length || r.albums.length || r.artists.length)) { rememberSearch(q); setRecent(recentSearches()); } }, [q, r]);

  if (!q) {
    return (
      <div className="py-4">
        {recent.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between px-1"><h2 className="text-lg font-bold">Recent searches</h2><button type="button" onClick={() => { forgetSearches(); setRecent([]); }} className="text-xs text-dim hover:text-cream">Clear</button></div>
            <div className="mt-2 flex flex-wrap gap-2">
              {recent.map((t) => <Link key={t} to={`/search?q=${encodeURIComponent(t)}`} className="flex items-center gap-1.5 rounded-full bg-raised/70 px-3 py-1.5 text-sm text-cream hover:bg-raised"><Clock className="h-3.5 w-3.5 text-dim" />{t}</Link>)}
            </div>
          </section>
        )}
        {(moods.data?.length ?? 0) > 0 && (
          <section className="mb-8">
            <h2 className="text-2xl font-extrabold tracking-tight">Browse by mood</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {moods.data!.map((m) => <MoodCard key={m.id} mood={m} onPlay={() => api<{ tracks: Track[] }>(`/api/music/moods/${m.id}`).then((x) => playQueue(x.tracks, 0, { kind: "mood", name: m.name }))} />)}
            </div>
          </section>
        )}
        <h2 className="text-2xl font-extrabold tracking-tight">Browse by genre</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {(genres.data ?? []).map((g) => <GenreCard key={g.name} genre={g} />)}
        </div>
      </div>
    );
  }
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
