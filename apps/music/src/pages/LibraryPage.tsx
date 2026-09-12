import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { api, fmtLong, shareLink, type Album, type Artist, type Playlist, type Share, type Track } from "../lib/api";
import { playQueue } from "../lib/player";
import { AlbumCard, ArtistCard, PlaylistCard } from "../components/Cards";
import { TrackList } from "../components/TrackList";
import { pushToast } from "../components/Toast";
import { Art } from "../components/Art";
import { copyText } from "../components/ShareDialog";

type Status = { enabled: boolean; scanning: boolean; lastScan: { at: string; added: number; scanned: number; seconds: number } | null; tracks: number; albums: number; artists: number; durationSeconds: number };
const TABS = ["playlists", "albums", "artists", "songs", "shared links"] as const;

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as typeof TABS[number]) : "playlists";
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["music", "status"], queryFn: () => api<Status>("/api/music/status"), refetchInterval: (q) => (q.state.data?.scanning ? 3000 : false) });
  const playlists = useQuery({ queryKey: ["music", "playlists"], queryFn: () => api<Playlist[]>("/api/music/playlists"), enabled: tab === "playlists" });
  const albums = useQuery({ queryKey: ["music", "albums", "artist"], queryFn: () => api<Album[]>("/api/music/albums?sort=artist&limit=200"), enabled: tab === "albums" });
  const artists = useQuery({ queryKey: ["music", "artists"], queryFn: () => api<Artist[]>("/api/music/artists?limit=500"), enabled: tab === "artists" });
  const songs = useQuery({ queryKey: ["music", "tracks", "artist"], queryFn: () => api<Track[]>("/api/music/tracks?sort=artist&limit=200"), enabled: tab === "songs" });
  const shares = useQuery({ queryKey: ["music", "shares"], queryFn: () => api<Share[]>("/api/music/shares"), enabled: tab === "shared links" });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api/music/shares/${id}`, { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["music", "shares"] }); pushToast("Link revoked"); } });
  const scan = useMutation({ mutationFn: () => api("/api/music/scan", { method: "POST" }), onSuccess: () => { pushToast("Scanning library…"); qc.invalidateQueries({ queryKey: ["music", "status"] }); }, onError: (e: Error) => pushToast(e.message.slice(0, 80)) });

  const st = status.data;
  return (
    <div className="py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Your Library</h1>
          {st && <p className="mt-1 text-sm text-muted">{st.tracks.toLocaleString()} songs · {st.albums.toLocaleString()} albums · {st.artists.toLocaleString()} artists · {fmtLong(st.durationSeconds)}</p>}
        </div>
        <button type="button" onClick={() => scan.mutate()} disabled={st?.scanning || scan.isPending}
          className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-cream hover:text-cream disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${st?.scanning ? "animate-spin" : ""}`} /> {st?.scanning ? "Scanning…" : "Rescan library"}
        </button>
      </div>
      <div className="mt-4 flex gap-2">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setParams({ tab: t })}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition ${tab === t ? "bg-cream text-ink" : "bg-raised/70 text-cream hover:bg-raised"}`}>{t}</button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "playlists" && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {(playlists.data ?? []).map((p) => <PlaylistCard key={p.id} playlist={p} onPlay={() => api<{ tracks: Track[] }>(`/api/music/playlists/${p.id}`).then((x) => playQueue(x.tracks, 0, { kind: "playlist", name: p.name }))} />)}
            {playlists.data && !playlists.data.length && <p className="col-span-full text-sm text-muted">No playlists yet — use the + in the sidebar.</p>}
          </div>
        )}
        {tab === "albums" && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {(albums.data ?? []).map((a) => <AlbumCard key={a.id} album={a} onPlay={() => api<{ tracks: Track[] }>(`/api/music/albums/${a.id}`).then((x) => playQueue(x.tracks, 0, { kind: "album", name: a.title }))} />)}
          </div>
        )}
        {tab === "artists" && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {(artists.data ?? []).map((a) => <ArtistCard key={a.id} artist={a} onPlay={() => api<{ topTracks: Track[] }>(`/api/music/artists/${a.id}`).then((x) => playQueue(x.topTracks, 0, { kind: "artist", name: a.name }))} />)}
          </div>
        )}
        {tab === "songs" && songs.data && <TrackList tracks={songs.data} context={{ kind: "tracks", name: "All songs" }} />}
        {tab === "shared links" && <SharesList shares={shares.data} onRevoke={(id) => revoke.mutate(id)} />}
      </div>
    </div>
  );
}

/** Every link the user has handed out, with what it points at, how often it was opened, and a way to kill it. */
function SharesList({ shares, onRevoke }: { shares: Share[] | undefined; onRevoke: (id: string) => void }) {
  if (!shares) return null;
  if (!shares.length) return <p className="text-sm text-muted">No links yet — use <Link2 className="inline h-4 w-4" /> Share on a song, album or playlist.</p>;
  const now = Date.now();
  return (
    <ul className="divide-y divide-line">
      {shares.map((sh) => {
        const expired = sh.expiresAt !== null && sh.expiresAt < now;
        const status = expired ? "Expired" : sh.expiresAt ? `Expires ${new Date(sh.expiresAt).toLocaleDateString()}` : "Never expires";
        return (
          <li key={sh.id} className="flex items-center gap-3 py-3">
            <Art src={sh.art} seed={sh.targetId} className="h-12 w-12 shrink-0" iconSize={0.5} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-cream">{sh.title} <span className="font-normal text-muted">· {sh.subtitle}</span></p>
              <p className={`truncate text-xs ${expired ? "text-accent2" : "text-dim"}`}>
                <span className="capitalize">{sh.kind}</span> · {sh.trackCount} song{sh.trackCount === 1 ? "" : "s"} · {status} · {sh.allowDownload ? "downloads on" : "listen only"} · opened {sh.views}×
              </p>
            </div>
            {!expired && (
              <button type="button" onClick={async () => pushToast((await copyText(shareLink(sh.id))) ? "Link copied" : "Copy failed")} aria-label="Copy link" title="Copy link"
                className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-cream hover:text-cream">
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            )}
            <button type="button" onClick={() => { if (confirm(`Revoke this link? Anyone who has it will lose access.`)) onRevoke(sh.id); }} aria-label="Revoke link" title="Revoke"
              className="text-dim hover:text-accent2"><Trash2 className="h-4 w-4" /></button>
          </li>
        );
      })}
    </ul>
  );
}
