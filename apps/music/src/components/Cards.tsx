import { Link } from "react-router-dom";
import { MoreHorizontal, Play } from "lucide-react";
import { Art } from "./Art";
import { anchorTo, pressProps, type MenuAnchor } from "./ContextMenu";
import { useCollectionMenu } from "../lib/menus";
import type { Album, Artist, Genre, Mix, Mood, Playlist } from "../lib/api";

type OnMenu = (at: MenuAnchor) => void;

/** Hover-revealed "…" in a tile's corner; the same menu right-click and press-and-hold open. */
function MoreButton({ onMenu, light }: { onMenu: OnMenu; light?: boolean }) {
  return (
    <button type="button" aria-label="More options" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(anchorTo(e.currentTarget)); }}
      className={`absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full opacity-0 transition group-hover:opacity-100 focus:opacity-100 ${light ? "bg-black/40 text-cream hover:bg-black/60" : "bg-ink/70 text-cream hover:bg-ink"}`}>
      <MoreHorizontal className="h-5 w-5" />
    </button>
  );
}

/** Spotify-style tile: art, two lines, and a maroon play button that rises on hover. */
function Tile({ to, art, seed, title, subtitle, round, onPlay, onMenu }: {
  to: string; art: string | null; seed: string; title: string; subtitle: string; round?: boolean; onPlay?: () => void; onMenu?: OnMenu;
}) {
  return (
    <Link to={to} {...pressProps(onMenu)} className="group relative block rounded-lg bg-surface/60 p-3 transition-colors hover:bg-surface2 focus:outline-none focus:ring-2 focus:ring-accent">
      <div className="relative">
        <Art src={art} seed={seed} alt={title} round={round} className="aspect-square w-full shadow-card" />
        {onMenu && <MoreButton onMenu={onMenu} />}
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

export function AlbumCard({ album, onPlay }: { album: Album; onPlay?: () => void }) {
  const menu = useCollectionMenu();
  return <Tile to={`/album/${album.id}`} art={album.art} seed={album.id} title={album.title}
    subtitle={`${album.year ? `${album.year} · ` : ""}${album.artist}`} onPlay={onPlay}
    onMenu={(at) => menu({ kind: "album", id: album.id, name: album.title, subtitle: album.artist, art: album.art, artistId: album.artistId }, at)} />;
}

export function ArtistCard({ artist, onPlay }: { artist: Artist; onPlay?: () => void }) {
  const menu = useCollectionMenu();
  return <Tile to={`/artist/${artist.id}`} art={artist.image ?? artist.art} seed={artist.id} title={artist.name} subtitle="Artist" round onPlay={onPlay}
    onMenu={(at) => menu({ kind: "artist", id: artist.id, name: artist.name, subtitle: "Artist", art: artist.image ?? artist.art }, at)} />;
}

export function PlaylistCard({ playlist, onPlay }: { playlist: Playlist; onPlay?: () => void }) {
  const menu = useCollectionMenu();
  return <Tile to={`/playlist/${playlist.id}`} art={playlist.art} seed={playlist.id} title={playlist.name}
    subtitle={`${playlist.trackCount} song${playlist.trackCount === 1 ? "" : "s"}`} onPlay={onPlay}
    onMenu={(at) => menu({ kind: "playlist", id: playlist.id, name: playlist.name, subtitle: `${playlist.trackCount} songs`, art: playlist.art }, at)} />;
}

/** Genre tiles are the colourful blocks on Spotify's search page. */
/** Gradient block with a name and an art thumbnail tilted into the corner: genres, moods and mixes share the look. */
function ColourTile({ to, colors, title, subtitle, art, seed, big, onPlay, onMenu }: {
  to: string; colors: [string, string]; title: string; subtitle: string; art: string | null; seed: string; big?: boolean; onPlay?: () => void; onMenu?: OnMenu;
}) {
  return (
    <Link to={to} {...pressProps(onMenu)}
      className={`group relative block overflow-hidden rounded-lg p-4 transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent ${big ? "aspect-square" : "aspect-[1.6]"}`}
      style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }}>
      <p className={`font-extrabold text-cream drop-shadow ${big ? "text-2xl leading-tight" : "text-xl"}`}>{title}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-cream/75">{subtitle}</p>
      {art && <Art src={art} seed={seed} className={`absolute shadow-card ${big ? "-bottom-4 -right-4 h-28 w-28 rotate-[18deg]" : "-bottom-2 -right-2 h-20 w-20 rotate-[20deg]"}`} />}
      {onMenu && <MoreButton onMenu={onMenu} light />}
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
  const menu = useCollectionMenu();
  const colors = genre.colors ?? [`hsl(${(genre.name.length * 37) % 360} 45% 28%)`, `hsl(${(genre.name.length * 91) % 360} 40% 16%)`];
  return <ColourTile to={`/genre/${encodeURIComponent(genre.name)}`} colors={colors} title={genre.name} subtitle={`${genre.trackCount} songs`} art={genre.art} seed={genre.name}
    onMenu={(at) => menu({ kind: "genre", id: genre.name, name: genre.name, subtitle: `${genre.trackCount} songs`, art: genre.art }, at)} />;
}

export function MoodCard({ mood, onPlay }: { mood: Mood; onPlay?: () => void }) {
  const menu = useCollectionMenu();
  return <ColourTile to={`/mood/${mood.id}`} colors={mood.colors} title={mood.name} subtitle={mood.blurb} art={mood.art} seed={mood.id} onPlay={onPlay}
    onMenu={(at) => menu({ kind: "mood", id: mood.id, name: mood.name, subtitle: mood.blurb, art: mood.art }, at)} />;
}

export function MixCard({ mix, onPlay }: { mix: Mix; onPlay?: () => void }) {
  const menu = useCollectionMenu();
  return <ColourTile to={`/mix/${encodeURIComponent(mix.id)}`} colors={mix.colors} title={mix.name} subtitle={mix.blurb} art={mix.art} seed={mix.id} big onPlay={onPlay}
    onMenu={(at) => menu({ kind: "mix", id: mix.id, name: mix.name, subtitle: mix.blurb, art: mix.art }, at)} />;
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
