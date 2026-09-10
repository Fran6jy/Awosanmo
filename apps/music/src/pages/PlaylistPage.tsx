import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { api, fmtLong, type Playlist, type Track } from "../lib/api";
import { playQueue, toggle, toggleShuffle, usePlayer } from "../lib/player";
import { CollectionHeader } from "../components/CollectionHeader";
import { TrackList } from "../components/TrackList";
import { pushToast } from "../components/Toast";

type PlaylistFull = Playlist & { tracks: Track[] };

export function PlaylistPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const s = usePlayer();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const playlist = useQuery({ queryKey: ["music", "playlist", id], queryFn: () => api<PlaylistFull>(`/api/music/playlists/${id}`), enabled: Boolean(id) });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["music", "playlist", id] }); qc.invalidateQueries({ queryKey: ["music", "playlists"] }); };
  const rename = useMutation({ mutationFn: () => api(`/api/music/playlists/${id}`, { method: "PUT", body: JSON.stringify({ name }) }), onSuccess: () => { invalidate(); setRenaming(false); } });
  const remove = useMutation({ mutationFn: () => api(`/api/music/playlists/${id}`, { method: "DELETE" }), onSuccess: () => { invalidate(); pushToast("Playlist deleted"); nav("/library"); } });
  const removeTrack = useMutation({ mutationFn: (position: number) => api(`/api/music/playlists/${id}/tracks/${position}`, { method: "DELETE" }), onSuccess: invalidate });

  const p = playlist.data;
  if (!p) return <div className="py-20 text-center text-muted">Loading…</div>;
  const context = { kind: "playlist" as const, name: p.name };
  const isThis = s.context?.name === p.name && s.queue.length > 0;

  return (
    <div>
      <CollectionHeader kind="Playlist" title={p.name} art={p.art} seed={p.id} contextName={p.name}
        subtitle={p.trackCount ? `${p.trackCount} song${p.trackCount === 1 ? "" : "s"}, ${fmtLong(p.duration)}` : "Empty — add songs from the ⋯ menu on any track"}
        onPlay={() => (isThis ? void toggle() : void playQueue(p.tracks, 0, context))}
        onShuffle={() => { if (!s.shuffle) toggleShuffle(); void playQueue(p.tracks, 0, context); }}>
        <button type="button" onClick={() => { setName(p.name); setRenaming(true); }} aria-label="Rename" className="text-dim hover:text-cream"><Pencil className="h-5 w-5" /></button>
        <button type="button" onClick={() => { if (confirm(`Delete “${p.name}”?`)) remove.mutate(); }} aria-label="Delete playlist" className="text-dim hover:text-accent2"><Trash2 className="h-5 w-5" /></button>
      </CollectionHeader>
      {renaming && (
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename.mutate(); }} className="mb-4 flex gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="h-10 flex-1 rounded-md bg-surface2 px-3 text-cream focus:outline-none focus:ring-2 focus:ring-accent" />
          <button className="rounded-full bg-cream px-4 text-sm font-bold text-ink">Save</button>
          <button type="button" onClick={() => setRenaming(false)} className="px-3 text-sm text-muted hover:text-cream">Cancel</button>
        </form>
      )}
      <TrackList tracks={p.tracks} context={context} onRemove={(t) => removeTrack.mutate(t.position ?? 0)} />
    </div>
  );
}

export function LikedPage() {
  const s = usePlayer();
  const liked = useQuery({ queryKey: ["music", "liked"], queryFn: () => api<{ total: number; tracks: Track[] }>("/api/music/likes?limit=500") });
  const d = liked.data;
  if (!d) return <div className="py-20 text-center text-muted">Loading…</div>;
  const context = { kind: "liked" as const, name: "Liked Songs" };
  const isThis = s.context?.name === "Liked Songs" && s.queue.length > 0;
  return (
    <div>
      <CollectionHeader kind="Playlist" title="Liked Songs" art={null} seed="liked-songs" contextName="Liked Songs"
        subtitle={d.total ? `${d.total} song${d.total === 1 ? "" : "s"}` : "Tap the heart on any song to save it here"}
        onPlay={() => (isThis ? void toggle() : void playQueue(d.tracks, 0, context))}
        onShuffle={() => { if (!s.shuffle) toggleShuffle(); void playQueue(d.tracks, 0, context); }} />
      <TrackList tracks={d.tracks} context={context} />
    </div>
  );
}
