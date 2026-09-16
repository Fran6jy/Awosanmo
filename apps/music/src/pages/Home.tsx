import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Play } from "lucide-react";
import { api, type Album, type Genre, type Mix, type Mood, type Track } from "../lib/api";
import { playQueue } from "../lib/player";
import { Art } from "../components/Art";
import { AlbumCard, GenreCard, MixCard, MoodCard, Shelf } from "../components/Cards";

type HomeData = { recent: Track[]; onRepeat: Track[]; recentAlbums: Album[]; genres: Genre[]; discover: Track[]; mixes: Mix[]; moods: Mood[]; forgotten?: Track[]; onThisDay?: { yearsAgo: number; tracks: Track[] } | null };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Still up?" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Small wide tile: the "jump back in" row at the top of Spotify's home. */
function QuickTile({ track, tracks }: { track: Track; tracks: Track[] }) {
  return (
    <button type="button" onClick={() => playQueue(tracks, tracks.indexOf(track), { kind: "home", name: "Recently played" })}
      className="group flex items-center gap-3 overflow-hidden rounded-md bg-raised/60 pr-3 text-left transition hover:bg-raised">
      <Art src={track.art} seed={track.albumId} alt="" className="h-14 w-14 shrink-0 rounded-l-md rounded-r-none" iconSize={0.5} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{track.title}</span>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-cream opacity-0 shadow-glow transition group-hover:opacity-100"><Play className="ml-0.5 h-4 w-4 fill-current" /></span>
    </button>
  );
}

function TrackTile({ track, tracks, context }: { track: Track; tracks: Track[]; context: string }) {
  return (
    <button type="button" onClick={() => playQueue(tracks, tracks.indexOf(track), { kind: "home", name: context })}
      className="group relative rounded-lg bg-surface/60 p-3 text-left transition hover:bg-surface2">
      <div className="relative">
        <Art src={track.art} seed={track.albumId} alt="" className="aspect-square w-full shadow-card" />
        <span className="absolute bottom-2 right-2 grid h-11 w-11 translate-y-2 place-items-center rounded-full bg-accent text-cream opacity-0 shadow-glow transition-all group-hover:translate-y-0 group-hover:opacity-100"><Play className="ml-0.5 h-5 w-5 fill-current" /></span>
      </div>
      <p className="mt-3 truncate font-semibold">{track.title}</p>
      <p className="mt-0.5 truncate text-sm text-muted">{track.artist}</p>
    </button>
  );
}

const playMix = (m: Mix) => api<{ tracks: Track[] }>(`/api/music/mixes/${encodeURIComponent(m.id)}`).then((r) => playQueue(r.tracks, 0, { kind: "mix", name: m.name }));
const playMood = (m: Mood) => api<{ tracks: Track[] }>(`/api/music/moods/${m.id}`).then((r) => playQueue(r.tracks, 0, { kind: "mood", name: m.name }));

export function Home() {
  const home = useQuery({ queryKey: ["music", "home"], queryFn: () => api<HomeData>("/api/music/home"), staleTime: 30_000 });
  const d = home.data;
  if (!d) return <div className="py-20 text-center text-muted">Loading your library…</div>;
  const empty = !d.recent.length && !d.recentAlbums.length && !d.discover.length;
  const mixes = d.mixes ?? [];
  const moods = d.moods ?? [];

  return (
    <div className="py-4">
      <h1 className="text-3xl font-extrabold tracking-tight">{greeting()}</h1>
      {d.recent.length > 0 && (
        <Link to="/wrapped" className="mt-4 flex items-center gap-4 overflow-hidden rounded-xl p-4 transition hover:brightness-110" style={{ background: "linear-gradient(120deg, #A32638, #3A0F16)" }}>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-cream/15"><BarChart3 className="h-6 w-6 text-cream" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-extrabold text-cream">Your week in music</span>
            <span className="block truncate text-sm text-cream/75">Song, album and artist of the week — and a card to share</span>
          </span>
          <span className="shrink-0 rounded-full bg-cream px-3 py-1.5 text-xs font-bold text-ink">Open</span>
        </Link>
      )}
      {empty && (
        <div className="mt-8 rounded-xl bg-surface p-8 text-center">
          <p className="text-lg font-semibold">Your library is empty</p>
          <p className="mt-1 text-sm text-muted">The scanner runs on start-up and every 30 minutes. If you just uploaded music, give it a moment — or trigger a scan from <Link to="/library" className="text-accent2 underline">Your Library</Link>.</p>
        </div>
      )}
      {d.recent.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {d.recent.slice(0, 6).map((t) => <QuickTile key={t.id} track={t} tracks={d.recent} />)}
        </div>
      )}
      {mixes.length > 0 && (
        <Shelf title="Made for you" subtitle="Built from what you play — fresh every day">
          {mixes.map((m) => <MixCard key={m.id} mix={m} onPlay={() => void playMix(m)} />)}
        </Shelf>
      )}
      {moods.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 px-1"><h2 className="text-2xl font-extrabold tracking-tight">How are you feeling?</h2><p className="text-sm text-muted">Moods measured from the music itself — tempo, energy, brightness</p></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{moods.slice(0, 5).map((m) => <MoodCard key={m.id} mood={m} onPlay={() => void playMood(m)} />)}</div>
        </section>
      )}
      {(d.forgotten?.length ?? 0) >= 4 && (
        <Shelf title="Forgotten favourites" subtitle="You loved these a few months ago — then stopped">
          {d.forgotten!.map((t) => <TrackTile key={t.id} track={t} tracks={d.forgotten!} context="Forgotten favourites" />)}
        </Shelf>
      )}
      {d.onThisDay && (
        <Shelf title={`On this day, ${d.onThisDay.yearsAgo === 1 ? "a year" : `${d.onThisDay.yearsAgo} years`} ago`} subtitle="What you were playing this week back then">
          {d.onThisDay.tracks.map((t) => <TrackTile key={t.id} track={t} tracks={d.onThisDay!.tracks} context="On this day" />)}
        </Shelf>
      )}
      {d.onRepeat.length > 0 && (
        <Shelf title="On repeat" subtitle="What you keep coming back to">
          {d.onRepeat.map((t) => <TrackTile key={t.id} track={t} tracks={d.onRepeat} context="On repeat" />)}
        </Shelf>
      )}
      {d.recentAlbums.length > 0 && (
        <Shelf title="Recently added" to="/library?tab=albums">
          {d.recentAlbums.map((a) => <AlbumCard key={a.id} album={a} onPlay={() => api<{ tracks: Track[] }>(`/api/music/albums/${a.id}`).then((al) => playQueue(al.tracks, 0, { kind: "album", name: a.title }))} />)}
        </Shelf>
      )}
      {mixes.length === 0 && d.discover.length > 0 && (
        <Shelf title="Something different" subtitle="A dozen from across your library">
          {d.discover.map((t) => <TrackTile key={t.id} track={t} tracks={d.discover} context="Something different" />)}
        </Shelf>
      )}
      {d.genres.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 px-1 text-2xl font-extrabold tracking-tight">Browse by genre</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{d.genres.map((g) => <GenreCard key={g.name} genre={g} />)}</div>
        </section>
      )}
    </div>
  );
}
