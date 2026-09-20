import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Disc3, Heart, ListEnd, ListPlus, ListStart, Pencil, Play, Radio, RefreshCw, Share2, Shuffle, Trash2, User } from "lucide-react";
import { api, sessionRole, type Playlist, type Track } from "./api";
import { addToQueue, current, dropTrack, playNext, playQueue, playTrack, toggleShuffle, usePlayer, type PlayerState } from "./player";
import { openMenu, openShare, type MenuAnchor, type MenuItem } from "../components/ContextMenu";
import { useLike } from "../components/TrackList";
import { pushToast } from "../components/Toast";
import { Art } from "../components/Art";

/**
 * The items behind every song menu — the same list whether it came from a
 * right-click, a long press, or the "…" button.
 */
export function useTrackMenu() {
  const qc = useQueryClient();
  const like = useLike();
  const playlists = useQuery({ queryKey: ["music", "playlists"], queryFn: () => api<Playlist[]>("/api/music/playlists"), staleTime: 60_000 });

  return useCallback((track: Track, at: MenuAnchor, opts: { within?: Track[]; context?: PlayerState["context"]; onRemove?: () => void } = {}) => {
    const now = current();
    const liked = now?.id === track.id ? now.liked : track.liked;
    const isAdmin = sessionRole() === "admin";
    const addTo = (p: Playlist) => api(`/api/music/playlists/${p.id}/tracks`, { method: "POST", body: JSON.stringify({ trackId: track.id }) })
      .then(() => { qc.invalidateQueries({ queryKey: ["music", "playlists"] }); qc.invalidateQueries({ queryKey: ["music", "playlist", p.id] }); pushToast(`Added to ${p.name}`); })
      .catch(() => pushToast("Could not add to playlist"));
    const radio = () => api<Track[]>(`/api/music/tracks/${track.id}/similar`)
      .then((r) => { if (r.length) { void playQueue([track, ...r], 0, { kind: "radio", name: `${track.title} radio` }); pushToast(`Radio from “${track.title}”`); } else pushToast("Not enough analysed songs yet"); })
      .catch(() => pushToast("Could not start radio"));
    const destroy = () => {
      if (!confirm(`Delete “${track.title}” from the library?\n\nThis removes the file from the server. It cannot be undone.`)) return;
      api(`/api/music/tracks/${track.id}`, { method: "DELETE" })
        .then(() => { dropTrack(track.id); qc.invalidateQueries({ queryKey: ["music"] }); pushToast(`Deleted “${track.title}”`); })
        .catch(() => pushToast("Could not delete the song"));
    };

    const items: MenuItem[] = [
      { label: "Play", icon: <Play />, onSelect: () => playTrack(track, opts.within ?? [track], opts.context ?? null) },
      { label: "Play next", icon: <ListStart />, onSelect: () => { playNext([track]); pushToast("Playing next"); } },
      { label: "Add to queue", icon: <ListEnd />, onSelect: () => { addToQueue([track]); pushToast("Added to queue"); } },
      { label: liked ? "Remove from Liked Songs" : "Add to Liked Songs", icon: <Heart className={liked ? "fill-current text-accent2" : ""} />, onSelect: () => like.mutate({ id: track.id, liked: !liked }) },
      { kind: "divider" },
      { label: "Share", icon: <Share2 />, onSelect: () => openShare({ kind: "track", id: track.id, name: `${track.title} — ${track.artist}` }) },
      { label: "Go to song radio", icon: <Radio />, onSelect: radio },
      { kind: "divider" },
      { kind: "header", label: "Add to playlist" },
      ...(playlists.data ?? []).map((p): MenuItem => ({ label: p.name, icon: <ListPlus />, onSelect: () => void addTo(p) })),
      ...(playlists.data && !playlists.data.length ? [{ kind: "note", label: "No playlists yet" } as MenuItem] : []),
      ...(opts.onRemove ? [{ kind: "divider" } as MenuItem, { label: "Remove from this playlist", icon: <Trash2 />, danger: true, onSelect: opts.onRemove } as MenuItem] : []),
      { kind: "divider" },
      { label: "Go to album", icon: <Disc3 />, to: `/album/${track.albumId}` },
      { label: "Go to artist", icon: <User />, to: `/artist/${track.artistId}` },
      ...(isAdmin ? [{ kind: "divider" } as MenuItem, { label: "Delete from library", icon: <Trash2 />, danger: true, onSelect: destroy } as MenuItem] : []),
    ];
    openMenu(at, items, { title: track.title, subtitle: track.artist, art: <Art src={track.art} seed={track.albumId} alt="" className="h-12 w-12 shrink-0" iconSize={0.5} /> });
  }, [like, playlists.data, qc]);
}

export type Collection = {
  kind: "album" | "playlist" | "artist" | "mix" | "mood" | "genre" | "liked";
  id: string; name: string; subtitle?: string; art?: string | null; artistId?: string;
};

async function loadTracks(c: Collection): Promise<Track[]> {
  switch (c.kind) {
    case "album": return (await api<{ tracks: Track[] }>(`/api/music/albums/${c.id}`)).tracks;
    case "playlist": return (await api<{ tracks: Track[] }>(`/api/music/playlists/${c.id}`)).tracks;
    case "artist": return (await api<{ topTracks: Track[] }>(`/api/music/artists/${c.id}`)).topTracks;
    case "mix": return (await api<{ tracks: Track[] }>(`/api/music/mixes/${encodeURIComponent(c.id)}`)).tracks;
    case "mood": return (await api<{ tracks: Track[] }>(`/api/music/moods/${c.id}`)).tracks;
    case "genre": return (await api<{ tracks: Track[] }>(`/api/music/genres/${encodeURIComponent(c.id)}?limit=200`)).tracks;
    case "liked": return (await api<{ tracks: Track[] }>("/api/music/likes?limit=500")).tracks;
  }
}

/** Menus for albums, playlists, artists, mixes, moods and genres: play it, queue it, share it, manage it. */
export function useCollectionMenu() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const s = usePlayer();
  const playlists = useQuery({ queryKey: ["music", "playlists"], queryFn: () => api<Playlist[]>("/api/music/playlists"), staleTime: 60_000 });

  return useCallback((c: Collection, at: MenuAnchor) => {
    const context: PlayerState["context"] = c.kind === "mix" || c.kind === "mood" ? { kind: c.kind, name: c.name, id: c.id } : { kind: c.kind, name: c.name };
    const withTracks = (f: (t: Track[]) => void) => loadTracks(c).then((t) => { if (t.length) f(t); else pushToast("Nothing to play"); }).catch(() => pushToast("Could not load songs"));
    const label = c.kind === "playlist" ? "playlist" : c.kind === "album" ? "album" : c.kind === "artist" ? "top songs" : c.kind === "genre" ? "genre" : c.kind === "liked" ? "Liked Songs" : c.kind;

    const items: MenuItem[] = [
      { label: "Play", icon: <Play />, onSelect: () => void withTracks((t) => playQueue(t, 0, context)) },
      { label: "Shuffle", icon: <Shuffle />, onSelect: () => void withTracks((t) => { if (!s.shuffle) toggleShuffle(); void playQueue(t, 0, context); }) },
      { label: "Play next", icon: <ListStart />, onSelect: () => void withTracks((t) => { playNext(t); pushToast(`Playing ${label} next`); }) },
      { label: "Add to queue", icon: <ListEnd />, onSelect: () => void withTracks((t) => { addToQueue(t); pushToast(`Added ${t.length} songs to queue`); }) },
    ];
    if (c.kind === "album" || c.kind === "playlist") {
      items.push({ kind: "divider" }, { label: "Share", icon: <Share2 />, onSelect: () => openShare({ kind: c.kind as "album" | "playlist", id: c.id, name: c.name }) });
    }
    if (c.kind === "album" || c.kind === "artist" || c.kind === "genre" || c.kind === "mix" || c.kind === "mood") {
      items.push({ kind: "divider" }, { kind: "header", label: `Add ${c.kind === "artist" ? "top songs" : "all"} to playlist` });
      for (const p of playlists.data ?? []) {
        items.push({ label: p.name, icon: <ListPlus />, onSelect: () => void withTracks(async (t) => {
          for (const x of t) await api(`/api/music/playlists/${p.id}/tracks`, { method: "POST", body: JSON.stringify({ trackId: x.id }) }).catch(() => undefined);
          qc.invalidateQueries({ queryKey: ["music", "playlists"] }); qc.invalidateQueries({ queryKey: ["music", "playlist", p.id] });
          pushToast(`Added ${t.length} songs to ${p.name}`);
        }) });
      }
      if (playlists.data && !playlists.data.length) items.push({ kind: "note", label: "No playlists yet" });
    }
    if (c.kind === "album" && c.artistId) items.push({ kind: "divider" }, { label: "Go to artist", icon: <User />, to: `/artist/${c.artistId}` });
    if (c.kind === "mix") {
      items.push({ kind: "divider" }, { label: "Deal a fresh selection", icon: <RefreshCw />, onSelect: () => api(`/api/music/mixes/${encodeURIComponent(c.id)}/refresh`, { method: "POST" })
        .then(() => { qc.invalidateQueries({ queryKey: ["music", "mix", c.id] }); qc.invalidateQueries({ queryKey: ["music", "home"] }); pushToast("Dealt a fresh hand"); }).catch(() => pushToast("Could not refresh")) });
    }
    if (c.kind === "playlist") {
      items.push({ kind: "divider" },
        { label: "Rename", icon: <Pencil />, onSelect: () => {
          const name = prompt("Playlist name", c.name)?.trim();
          if (!name || name === c.name) return;
          api(`/api/music/playlists/${c.id}`, { method: "PUT", body: JSON.stringify({ name }) })
            .then(() => { qc.invalidateQueries({ queryKey: ["music", "playlists"] }); qc.invalidateQueries({ queryKey: ["music", "playlist", c.id] }); pushToast("Renamed"); })
            .catch(() => pushToast("Could not rename"));
        } },
        { label: "Delete playlist", icon: <Trash2 />, danger: true, onSelect: () => {
          if (!confirm(`Delete “${c.name}”?`)) return;
          api(`/api/music/playlists/${c.id}`, { method: "DELETE" })
            .then(() => { qc.invalidateQueries({ queryKey: ["music", "playlists"] }); pushToast("Playlist deleted"); if (location.pathname === `/playlist/${c.id}`) nav("/library"); })
            .catch(() => pushToast("Could not delete"));
        } });
    }
    openMenu(at, items, { title: c.name, subtitle: c.subtitle, art: c.art !== undefined ? <Art src={c.art} seed={c.id} alt="" round={c.kind === "artist"} className="h-12 w-12 shrink-0" iconSize={0.5} /> : undefined });
  }, [nav, playlists.data, qc, s.shuffle]);
}
