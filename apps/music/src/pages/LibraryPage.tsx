import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { api, fmtLong, shareLink, type Album, type Artist, type Playlist, type Share, type Track } from "../lib/api";
import { playQueue } from "../lib/player";
import { AlbumCard, ArtistCard, PlaylistCard } from "../components/Cards";
import { TrackList } from "../components/TrackList";
import { pushToast } from "../components/Toast";
import { Art } from "../components/Art";
import { copyText } from "../components/ShareDialog";

type Status = {
  enabled: boolean; scanning: boolean; lastScan: { at: string; added: number; scanned: number; seconds: number } | null;
  tracks: number; albums: number; artists: number; durationSeconds: number;
  repair: { running: boolean; progress: { done: number; total: number } | null; last: { at: string; matched: number; cleaned: number; unmatched: number; art: number } | null; withArt: number; unknownArtist: number; pending: number; matched: number };
};
const TABS = ["playlists", "albums", "artists", "songs", "shared links"] as const;
const SORTS: Record<string, { key: string; label: string }[]> = {
  albums: [{ key: "added", label: "Recently added" }, { key: "artist", label: "Artist" }, { key: "title", label: "Title" }, { key: "year", label: "Year" }],
  songs: [{ key: "added", label: "Recently added" }, { key: "artist", label: "Artist" }, { key: "title", label: "Title" }],
};

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as typeof TABS[number]) : "playlists";
  const sort = params.get("sort") ?? (tab === "albums" ? "added" : "added");
  const setSort = (s: string) => setParams({ tab, sort: s });
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["music", "status"], queryFn: () => api<Status>("/api/music/status"), refetchInterval: (q) => (q.state.data?.scanning || q.state.data?.repair?.running ? 3000 : false) });
  const repair = useMutation({ mutationFn: (all: boolean) => api(`/api/music/repair${all ? "?all=1" : ""}`, { method: "POST" }), onSuccess: () => { pushToast("Repairing metadata…"); qc.invalidateQueries({ queryKey: ["music", "status"] }); }, onError: (e: Error) => pushToast(e.message.slice(0, 80)) });
  const playlists = useQuery({ queryKey: ["music", "playlists"], queryFn: () => api<Playlist[]>("/api/music/playlists"), enabled: tab === "playlists" });
  const albums = useQuery({ queryKey: ["music", "albums", sort], queryFn: () => api<Album[]>(`/api/music/albums?sort=${sort}&limit=200`), enabled: tab === "albums" });
  const artists = useQuery({ queryKey: ["music", "artists"], queryFn: () => api<Artist[]>("/api/music/artists?limit=500"), enabled: tab === "artists" });
  const songs = useQuery({ queryKey: ["music", "tracks", sort], queryFn: () => api<Track[]>(`/api/music/tracks?sort=${sort}&limit=200`), enabled: tab === "songs" });
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
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => scan.mutate()} disabled={st?.scanning || scan.isPending}
            className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-cream hover:text-cream disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${st?.scanning ? "animate-spin" : ""}`} /> {st?.scanning ? "Scanning…" : "Rescan library"}
          </button>
          {st?.repair && (
            <button type="button" onClick={() => repair.mutate(st.repair.pending === 0)} disabled={st.repair.running || repair.isPending}
              title={st.repair.pending ? `${st.repair.pending} songs not yet checked` : "Every song has been checked — run again from scratch"}
              className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-cream hover:text-cream disabled:opacity-50">
              <Sparkles className={`h-4 w-4 ${st.repair.running ? "animate-pulse text-accent2" : ""}`} />
              {st.repair.running && st.repair.progress ? `Repairing ${st.repair.progress.done}/${st.repair.progress.total}…` : st.repair.pending ? `Repair metadata (${st.repair.pending})` : "Repair metadata again"}
            </button>
          )}
        </div>
      </div>
      {st?.repair && (st.repair.running || st.repair.last) && (
        <p className="mt-2 text-xs text-dim">
          {st.repair.running ? "Looking songs up in the catalogue and fetching artwork — the library updates as it goes." :
            `Last repair: ${st.repair.last!.matched} matched, ${st.repair.last!.cleaned} cleaned, ${st.repair.last!.art} covers added · ${st.repair.withArt.toLocaleString()} of ${st.tracks.toLocaleString()} songs have artwork`}
        </p>
      )}
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" style={{ scrollbarWidth: "none" }}>
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setParams({ tab: t })}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition ${tab === t ? "bg-cream text-ink" : "bg-raised/70 text-cream hover:bg-raised"}`}>{t}</button>
        ))}
      </div>

      {SORTS[tab] && (
        <div className="mt-3 flex items-center gap-2 text-xs text-dim">
          <span>Sort by</span>
          {SORTS[tab].map((o) => (
            <button key={o.key} type="button" onClick={() => setSort(o.key)} className={`rounded-full px-2.5 py-1 font-semibold transition ${sort === o.key ? "bg-raised text-cream" : "hover:text-cream"}`}>{o.label}</button>
          ))}
        </div>
      )}

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
