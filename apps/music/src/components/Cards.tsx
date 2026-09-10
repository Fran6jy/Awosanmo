import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { Art } from "./Art";
import type { Album, Artist, Genre, Playlist } from "../lib/api";

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
  <Tile to={`/artist/${artist.id}`} art={artist.art} seed={artist.id} title={artist.name} subtitle="Artist" round onPlay={onPlay} />
);

export const PlaylistCard = ({ playlist, onPlay }: { playlist: Playlist; onPlay?: () => void }) => (
  <Tile to={`/playlist/${playlist.id}`} art={playlist.art} seed={playlist.id} title={playlist.name}
    subtitle={`${playlist.trackCount} song${playlist.trackCount === 1 ? "" : "s"}`} onPlay={onPlay} />
);

/** Genre tiles are the colourful blocks on Spotify's search page. */
export function GenreCard({ genre }: { genre: Genre }) {
  return (
    <Link to={`/genre/${encodeURIComponent(genre.name)}`}
      className="relative block aspect-[1.6] overflow-hidden rounded-lg p-4 transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent"
      style={{ background: `linear-gradient(135deg, hsl(${(genre.name.length * 37) % 360} 45% 28%), hsl(${(genre.name.length * 91) % 360} 40% 16%))` }}>
      <p className="text-xl font-extrabold text-cream drop-shadow">{genre.name}</p>
      <p className="text-xs text-cream/70">{genre.trackCount} songs</p>
      {genre.art && (
        <Art src={genre.art} seed={genre.name} className="absolute -bottom-2 -right-2 h-20 w-20 rotate-[20deg] shadow-card" />
      )}
    </Link>
  );
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
