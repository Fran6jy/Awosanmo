import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Heart, MoreHorizontal, Play, Volume2 } from "lucide-react";
import { api, fmtTime, type Track } from "../lib/api";
import { markLiked, playTrack, useCurrent, usePlayer, type PlayerState } from "../lib/player";
import { useTrackMenu } from "../lib/menus";
import { Art } from "./Art";
import { anchorTo, pressProps } from "./ContextMenu";
import { pushToast } from "./Toast";

/** Shared "like" mutation so every heart in the app stays in sync. */
export function useLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) => api(`/api/music/likes/${id}`, { method: liked ? "PUT" : "DELETE" }),
    onMutate: ({ id, liked }) => markLiked(id, liked),
    onSuccess: (_r, { liked }) => {
      qc.invalidateQueries({ queryKey: ["music"] });
      pushToast(liked ? "Added to Liked Songs" : "Removed from Liked Songs");
    },
    onError: (_e, { id, liked }) => markLiked(id, !liked),
  });
}

export function TrackList({ tracks, context, showAlbum = true, showArt = true, numbered = true, onRemove }: {
  tracks: Track[];
  context: PlayerState["context"];
  showAlbum?: boolean;
  showArt?: boolean;
  numbered?: boolean;
  /** Present on playlist pages: removes by position. */
  onRemove?: (track: Track) => void;
}) {
  const now = useCurrent();
  const { playing } = usePlayer();
  const like = useLike();
  const openMenu = useTrackMenu();

  return (
    <div className="mt-2">
      <div className="hidden grid-cols-[2rem_1fr_1fr_3rem_2.5rem] items-center gap-3 border-b border-line px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-dim sm:grid" style={!showAlbum ? { gridTemplateColumns: "2rem 1fr 3rem 2.5rem" } : undefined}>
        <span className="text-center">#</span>
        <span>Title</span>
        {showAlbum && <span>Album</span>}
        <span className="justify-self-end"><Clock className="h-4 w-4" /></span>
        <span />
      </div>
      <ul className="mt-1">
        {tracks.map((t, i) => {
          const isNow = now?.id === t.id;
          const liked = now?.id === t.id ? now.liked : t.liked;
          return (
            <li key={`${t.id}-${t.position ?? i}`}
              onDoubleClick={() => t.playable && playTrack(t, tracks, context)}
              {...pressProps((at) => openMenu(t, at, { within: tracks, context, onRemove: onRemove ? () => onRemove(t) : undefined }))}
              className={`group relative grid grid-cols-[2rem_1fr_3rem_2.5rem] items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors sm:grid-cols-[2rem_1fr_1fr_3rem_2.5rem] ${isNow ? "bg-raised/70" : "hover:bg-raised/50"} ${!t.playable ? "opacity-50" : ""}`}
              style={!showAlbum ? { gridTemplateColumns: "2rem 1fr 3rem 2.5rem" } : undefined}>
              {/* number / play / now-playing indicator */}
              <button type="button" aria-label={`Play ${t.title}`} disabled={!t.playable}
                onClick={() => playTrack(t, tracks, context)}
                className="grid h-8 w-8 place-items-center justify-self-center text-dim">
                {isNow && playing ? <Volume2 className="h-4 w-4 animate-pulse text-accent2" />
                  : <>
                    <span className={`tabular-nums group-hover:hidden ${isNow ? "text-accent2" : ""}`}>{numbered ? i + 1 : ""}</span>
                    <Play className="hidden h-4 w-4 fill-current text-cream group-hover:block" />
                  </>}
              </button>
              {/* title + artist */}
              <div className="flex min-w-0 items-center gap-3">
                {showArt && <Art src={t.art} seed={t.albumId} alt="" className="h-10 w-10 shrink-0" iconSize={0.5} />}
                <div className="min-w-0">
                  <p className={`truncate font-medium ${isNow ? "text-accent2" : "text-cream"}`}>{t.title}{!t.playable && <span className="ml-2 text-xs text-dim">(unsupported format)</span>}</p>
                  <p className="truncate text-muted"><Link to={`/artist/${t.artistId}`} className="hover:text-cream hover:underline">{t.artist}</Link></p>
                </div>
              </div>
              {showAlbum && <Link to={`/album/${t.albumId}`} className="hidden truncate text-muted hover:text-cream hover:underline sm:block">{t.album}</Link>}
              <span className="justify-self-end tabular-nums text-muted">{fmtTime(t.duration)}</span>
              {/* actions */}
              <div className="flex items-center justify-end gap-1">
                <button type="button" aria-label={liked ? "Unlike" : "Like"} onClick={() => like.mutate({ id: t.id, liked: !liked })}
                  className={`grid h-8 w-8 place-items-center rounded-full transition ${liked ? "text-accent2" : "text-dim opacity-0 group-hover:opacity-100 hover:text-cream"}`}>
                  <Heart className={`h-4 w-4 ${liked ? "fill-current" : ""}`} />
                </button>
                <button type="button" aria-label="More" onClick={(e) => openMenu(t, anchorTo(e.currentTarget), { within: tracks, context, onRemove: onRemove ? () => onRemove(t) : undefined })}
                  className="grid h-8 w-8 place-items-center rounded-full text-dim transition hover:text-cream sm:opacity-0 sm:group-hover:opacity-100">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

