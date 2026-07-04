import { useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Film, Folder, MoreHorizontal, Pause, Play, Radio, RefreshCw, Server, Trash2, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { api, token, uploadFile, uploadTorrentFile } from "../lib/api";
import { pushToast } from "../components/Toast";
import { Shell } from "../components/Shell";
import { formatDuration } from "../lib/format";

type Torrent = { id: string; name: string; progress: number; status: string; download_speed: number; upload_speed: number; size: number };
type FileRow = {
  id: string;
  name: string;
  media_kind: string;
  size: number;
  streamable: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  codec_video?: string | null;
  probe_status?: string;
};
type StorageStats = { used: number; available: number; total: number };

const fmt = (bytes = 0) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
type StatCard = [string, string | number, LucideIcon];

export function Dashboard() {
  // NOTE: never early-return before the hooks below. Removing the token on a 401
  // would flip this condition mid-session and change the hook count between
  // renders, which crashes React. Guard after all hooks instead.
  const authed = !!token();
  const qc = useQueryClient();
  const [magnetUri, setMagnetUri] = useState("");
  // Live updates arrive over Socket.IO (see LiveSync); the interval is only a
  // fallback for when the socket is temporarily disconnected.
  const torrents = useQuery({ queryKey: ["torrents"], queryFn: () => api<Torrent[]>("/api/torrents"), refetchInterval: 15000, enabled: authed });
  const files = useQuery({ queryKey: ["files"], queryFn: () => api<FileRow[]>("/api/files"), refetchInterval: 3000, enabled: authed });
  const storage = useQuery({ queryKey: ["storage"], queryFn: () => api<StorageStats>("/api/storage"), refetchInterval: 8000, enabled: authed });
  const add = useMutation({
    mutationFn: () => api("/api/torrents", { method: "POST", body: JSON.stringify({ magnetUri }) }),
    onSuccess: () => {
      setMagnetUri("");
      qc.invalidateQueries({ queryKey: ["torrents"] });
      pushToast({ type: "success", title: "Added to swarm", body: "Fetching metadata…" });
    },
    onError: (e: Error) => pushToast({ type: "error", title: "Could not add magnet", body: e.message.slice(0, 140) })
  });

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  async function onUpload(list: FileList | null) {
    if (!list?.length) return;
    for (const file of Array.from(list)) {
      const isTorrent = file.name.toLowerCase().endsWith(".torrent");
      try {
        setUploadPct(0);
        if (isTorrent) {
          await uploadTorrentFile(file);
          pushToast({ type: "success", title: "Torrent added", body: file.name });
        } else {
          await uploadFile(file, (f) => setUploadPct(Math.round(f * 100)));
          pushToast({ type: "success", title: "Upload complete", body: file.name });
        }
        qc.invalidateQueries({ queryKey: ["files"] });
        qc.invalidateQueries({ queryKey: ["torrents"] });
      } catch (e) {
        pushToast({ type: "error", title: isTorrent ? "Could not add torrent" : "Upload failed", body: (e as Error).message.slice(0, 140) });
      } finally {
        setUploadPct(null);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "pause" | "resume" | "reannounce" | "delete" }) => {
      if (kind === "delete") return api(`/api/torrents/${id}?destroy=false`, { method: "DELETE" });
      return api(`/api/torrents/${id}/${kind}`, { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["torrents"] });
      qc.invalidateQueries({ queryKey: ["files"] });
    }
  });
  const stats = useMemo(() => {
    const rows = torrents.data ?? [];
    return {
      active: rows.filter((row) => row.status === "downloading").length,
      speed: rows.reduce((sum, row) => sum + row.download_speed, 0),
      stored: storage.data?.used ?? rows.reduce((sum, row) => sum + row.size * row.progress, 0)
    };
  }, [storage.data?.used, torrents.data]);

  if (!authed) return <Navigate to="/login" replace />;

  return (
    <Shell>
      <section className="grid gap-4 md:grid-cols-3">
        {([
          ["Active downloads", stats.active, Radio],
          ["Down speed", fmt(stats.speed) + "/s", Download],
          ["Stored locally", fmt(stats.stored), Server]
        ] satisfies StatCard[]).map(([label, value, Icon]) => (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={String(label)} className="rounded-2xl p-5 glass">
            <div className="flex items-center justify-between text-slate-300"><span>{label as string}</span><Icon className="h-5 w-5 text-stream" /></div>
            <p className="mt-4 text-3xl font-bold">{value as string}</p>
          </motion.div>
        ))}
      </section>
      <section className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-2xl p-5 glass">
          <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="flex flex-col gap-3 md:flex-row">
            <label className="sr-only" htmlFor="magnet">Magnet link</label>
            <input id="magnet" value={magnetUri} onChange={(e) => setMagnetUri(e.target.value)} placeholder="Paste magnet link" className="min-h-12 flex-1 rounded-xl border border-line bg-white/5 px-4 outline-none focus:ring-2 focus:ring-stream" />
            <button disabled={add.isPending || !magnetUri.trim().startsWith("magnet:")} className="min-h-12 rounded-xl bg-stream px-5 font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50">Join swarm</button>
            <button type="button" title="Upload any file, or a .torrent to add it to the swarm" onClick={() => fileInput.current?.click()} disabled={uploadPct !== null} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-white/5 px-5 font-semibold transition hover:bg-white/10 disabled:opacity-50">
              <Upload className="h-4 w-4" />{uploadPct === null ? "Upload" : `${uploadPct}%`}
            </button>
            <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
          </form>
          {uploadPct !== null && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-stream transition-all" style={{ width: `${uploadPct}%` }} />
            </div>
          )}
          <div className="mt-5 space-y-3">
            {(torrents.data ?? []).map((torrent) => (
              <article key={torrent.id} className="rounded-xl border border-line bg-white/[.04] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><Link to={`/torrents/${torrent.id}`} className="block truncate font-semibold transition hover:text-stream">{torrent.name}</Link><p className="text-sm text-slate-400">{torrent.status} · {fmt(torrent.download_speed)}/s · {Math.round(torrent.progress * 100)}%</p></div>
                  <div className="flex gap-2">
                    <button aria-label={torrent.status === "paused" ? "Resume" : "Pause"} onClick={() => action.mutate({ id: torrent.id, kind: torrent.status === "paused" ? "resume" : "pause" })} className="h-10 w-10 rounded-lg transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream">
                      {torrent.status === "paused" ? <Play className="mx-auto h-4 w-4" /> : <Pause className="mx-auto h-4 w-4" />}
                    </button>
                    <button aria-label="Reannounce" onClick={() => action.mutate({ id: torrent.id, kind: "reannounce" })} className="h-10 w-10 rounded-lg transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream"><RefreshCw className="mx-auto h-4 w-4" /></button>
                    <button aria-label="Delete" onClick={() => action.mutate({ id: torrent.id, kind: "delete" })} className="h-10 w-10 rounded-lg transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream"><Trash2 className="mx-auto h-4 w-4" /></button>
                  </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-stream" style={{ width: `${Math.round(torrent.progress * 100)}%` }} /></div>
              </article>
            ))}
          </div>
        </div>
        <div className="rounded-2xl p-5 glass">
          <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Recent files</h2><MoreHorizontal className="h-5 w-5 text-slate-400" /></div>
          <div className="mt-4 space-y-2">
            {(files.data ?? []).map((file) => (
              <Link to={file.streamable ? `/watch/${file.id}` : "#"} key={file.id} className="flex min-h-14 items-center gap-3 rounded-xl border border-transparent px-3 transition hover:border-line hover:bg-white/[.05]">
                {file.media_kind === "video" ? <Film className="h-5 w-5 text-stream" /> : <Folder className="h-5 w-5 text-violet-300" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{file.name}</span>
                  {file.streamable ? <span className="block truncate text-xs text-slate-500">{[file.width && file.height ? `${file.width}x${file.height}` : null, file.codec_video?.toUpperCase(), formatDuration(file.duration), file.probe_status].filter(Boolean).join(" · ")}</span> : null}
                </span>
                {file.streamable ? <Play className="h-4 w-4 text-slate-300" /> : <span className="text-sm text-slate-500">{fmt(file.size)}</span>}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </Shell>
  );
}
