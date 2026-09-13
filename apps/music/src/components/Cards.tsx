import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { Art } from "./Art";
import type { Album, Artist, Genre, Mix, Mood, Playlist } from "../lib/api";

/** Spotify-style tile: art, two lines, and a maroon play button that rises on hover. */
function Tile({ to, art, seed, title, subtitle, round, onPlay }: {
  to: string; art: string | null; seed: string; title: string; subtitle: string; round?: boolean; onPlay?: () => void;
}) {
  return (
    <Link to={to} className="group relative block rounded-lg bg-surface/60 p-3 transition-colors hover:bg-surface2 focus:outline-none focus:ring-2 focus:ring-accent">
      <div className="relative">
        <Art src={art} seed={seed} alt={title} round={round} className="aspect-square w-full shadow-card" />
        {onPlay && (
          <button
            type="button"
            aria-label={`Play ${title}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlay(); }}
            className="absolute bottom-2 right-2 grid h-11 w-11 translate-y-2 place-items-center rounded-full bg-accent text-cream opacity-0 shadow-glow transition-all group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105 hover:bg-accent2"
          >
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </button>
        )}
      </div>
      <p className="mt-3 truncate font-semibold text-cream">{title}</p>
      <p className="mt-0.5 line-clamp-2 text-sm text-muted">{subtitle}</p>
    </Link>
  );
}

export const AlbumCard = ({ album, onPlay }: { album: Album; onPlay?: () => void }) => (
  <Tile to={`/album/${album.id}`} art={album.art} seed={album.id} title={album.title}
    subtitle={`${album.year ? `${album.year} · ` : ""}${album.artist}`} onPlay={onPlay} />
);

export const ArtistCard = ({ artist, onPlay }: { artist: Artist; onPlay?: () => void }) => (
  <Tile to={`/artist/${artist.id}`} art={artist.image ?? artist.art} seed={artist.id} title={artist.name} subtitle="Artist" round onPlay={onPlay} />
);

export const PlaylistCard = ({ playlist, onPlay }: { playlist: Playlist; onPlay?: () => void }) => (
  <Tile to={`/playlist/${playlist.id}`} art={playlist.art} seed={playlist.id} title={playlist.name}
    subtitle={`${playlist.trackCount} song${playlist.trackCount === 1 ? "" : "s"}`} onPlay={onPlay} />
);

/** Genre tiles are the colourful blocks on Spotify's search page. */
/** Gradient block with a name and an art thumbnail tilted into the corner: genres, moods and mixes share the look. */
function ColourTile({ to, colors, title, subtitle, art, seed, big, onPlay }: {
  to: string; colors: [string, string]; title: string; subtitle: string; art: string | null; seed: string; big?: boolean; onPlay?: () => void;
}) {
  return (
    <Link to={to}
      className={`group relative block overflow-hidden rounded-lg p-4 transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent ${big ? "aspect-square" : "aspect-[1.6]"}`}
      style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }}>
      <p className={`font-extrabold text-cream drop-shadow ${big ? "text-2xl leading-tight" : "text-xl"}`}>{title}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-cream/75">{subtitle}</p>
      {art && <Art src={art} seed={seed} className={`absolute shadow-card ${big ? "-bottom-4 -right-4 h-28 w-28 rotate-[18deg]" : "-bottom-2 -right-2 h-20 w-20 rotate-[20deg]"}`} />}
      {onPlay && (
        <button type="button" aria-label={`Play ${title}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlay(); }}
          className="absolute bottom-3 left-3 grid h-11 w-11 translate-y-2 place-items-center rounded-full bg-cream text-ink opacity-0 shadow-glow transition-all group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105">
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </button>
      )}
    </Link>
  );
}

export function GenreCard({ genre }: { genre: Genre }) {
  const colors = genre.colors ?? [`hsl(${(genre.name.length * 37) % 360} 45% 28%)`, `hsl(${(genre.name.length * 91) % 360} 40% 16%)`];
  return <ColourTile to={`/genre/${encodeURIComponent(genre.name)}`} colors={colors} title={genre.name} subtitle={`${genre.trackCount} songs`} art={genre.art} seed={genre.name} />;
}

export function MoodCard({ mood, onPlay }: { mood: Mood; onPlay?: () => void }) {
  return <ColourTile to={`/mood/${mood.id}`} colors={mood.colors} title={mood.name} subtitle={mood.blurb} art={mood.art} seed={mood.id} onPlay={onPlay} />;
}

export function MixCard({ mix, onPlay }: { mix: Mix; onPlay?: () => void }) {
  return <ColourTile to={`/mix/${encodeURIComponent(mix.id)}`} colors={mix.colors} title={mix.name} subtitle={mix.blurb} art={mix.art} seed={mix.id} big onPlay={onPlay} />;
}

/** Horizontal shelf used on Home. */
export function Shelf({ title, subtitle, to, children }: { title: string; subtitle?: string; to?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-cream">{to ? <Link to={to} className="hover:underline">{title}</Link> : title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {to && <Link to={to} className="text-sm font-semibold text-muted hover:text-cream hover:underline">Show all</Link>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">{children}</div>
    </section>
  );
}
