import { useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Download, Gauge, Link2, Pause, Play, Plus, RefreshCw, Trash2, Upload, Waves } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { addByUrl, api, token, uploadFile, uploadTorrentFile } from "../lib/api";
import { readClipboardMagnet } from "../lib/clipboard";
import { pushToast } from "../components/Toast";
import { Shell } from "../components/Shell";

type Torrent = { id: string; name: string; progress: number; status: string; download_speed: number; upload_speed: number; size: number };
type AddTorrentResponse = { id: string; reused?: boolean };
type StorageStats = { used: number; available: number; total: number; user?: { used: number } };

const fmt = (bytes = 0) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`;

const statusTone: Record<string, string> = {
  downloading: "text-stream",
  completed: "text-emerald-400",
  paused: "text-amber-400",
  connecting: "text-sky-400",
  resuming: "text-sky-400",
  error: "text-rose-400",
};

export function Dashboard() {
  const authed = !!token();
  const qc = useQueryClient();
  const [magnetUri, setMagnetUri] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const torrents = useQuery({ queryKey: ["torrents"], queryFn: () => api<Torrent[]>("/api/torrents"), refetchInterval: 15000, enabled: authed });
  const storage = useQuery({ queryKey: ["storage"], queryFn: () => api<StorageStats>("/api/storage"), refetchInterval: 8000, enabled: authed });

  const add = useMutation({
    mutationFn: (uri: string) => api<AddTorrentResponse>("/api/torrents", { method: "POST", body: JSON.stringify({ magnetUri: uri }) }),
    onMutate: async (uri) => {
      const tempId = `optimistic-${Date.now()}`;
      await qc.cancelQueries({ queryKey: ["torrents"] });
      const previous = qc.getQueryData<Torrent[]>(["torrents"]);
      qc.setQueryData<Torrent[]>(["torrents"], (rows = []) => [
        {
          id: tempId,
          name: "Fetching metadata",
          progress: 0,
          status: "connecting",
          download_speed: 0,
          upload_speed: 0,
          size: 0
        },
        ...rows
      ]);
      setMagnetUri("");
      pushToast({ type: "success", title: "Magnet accepted", body: "Awosanmo is joining the swarm." });
      return { previous, tempId, uri };
    },
    onSuccess: (result, _uri, context) => {
      qc.setQueryData<Torrent[]>(["torrents"], (rows = []) => rows.filter((row) => row.id !== context?.tempId));
      qc.invalidateQueries({ queryKey: ["torrents"] });
      if (result.reused) pushToast({ type: "success", title: "Already in your library", body: "Using the existing torrent entry." });
    },
    onError: (e: Error, _uri, context) => {
      if (context?.previous) qc.setQueryData(["torrents"], context.previous);
      else qc.invalidateQueries({ queryKey: ["torrents"] });
      setMagnetUri(context?.uri ?? "");
      pushToast({ type: "error", title: "Could not add magnet", body: e.message.slice(0, 140) });
    },
  });
  async function autoPasteMagnet() {
    if (magnetUri.trim().startsWith("magnet:")) return;
    const next = await readClipboardMagnet();
    if (next) setMagnetUri(next);
  }

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  async function onUpload(list: FileList | null) {
    if (!list?.length) return;
    for (const file of Array.from(list)) {
      const isTorrent = file.name.toLowerCase().endsWith(".torrent");
      try {
        setUploadPct(0);
        if (isTorrent) { await uploadTorrentFile(file); pushToast({ type: "success", title: "Torrent added", body: file.name }); }
        else { await uploadFile(file, (f) => setUploadPct(Math.round(f * 100))); pushToast({ type: "success", title: "Upload complete", body: file.name }); }
        qc.invalidateQueries({ queryKey: ["files"] });
        qc.invalidateQueries({ queryKey: ["torrents"] });
      } catch (e) {
        pushToast({ type: "error", title: isTorrent ? "Could not add torrent" : "Upload failed", body: (e as Error).message.slice(0, 140) });
      } finally { setUploadPct(null); }
    }
    if (fileInput.current) fileInput.current.value = "";
  }
  const addUrl = useMutation({
    mutationFn: (url: string) => addByUrl(url),
    onSuccess: () => {
      setRemoteUrl("");
      pushToast({ type: "success", title: "URL added", body: "The file was saved to your library." });
      qc.invalidateQueries({ queryKey: ["files"] });
      qc.invalidateQueries({ queryKey: ["storage"] });
    },
    onError: (e: Error) => pushToast({ type: "error", title: "Could not add URL", body: e.message.slice(0, 140) })
  });
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "pause" | "resume" | "reannounce" | "delete" }) =>
      kind === "delete" ? api(`/api/torrents/${id}?destroy=false`, { method: "DELETE" }) : api(`/api/torrents/${id}/${kind}`, { method: "POST" }),
    onMutate: async ({ id, kind }) => {
      await qc.cancelQueries({ queryKey: ["torrents"] });
      const previous = qc.getQueryData<Torrent[]>(["torrents"]);
      if (kind === "pause" || kind === "resume") {
        qc.setQueryData<Torrent[]>(["torrents"], (rows = []) => rows.map((row) =>
          row.id === id
            ? { ...row, status: kind === "pause" ? "paused" : "downloading", download_speed: kind === "pause" ? 0 : row.download_speed, upload_speed: kind === "pause" ? 0 : row.upload_speed }
            : row
        ));
      }
      if (kind === "delete") qc.setQueryData<Torrent[]>(["torrents"], (rows = []) => rows.filter((row) => row.id !== id));
      return { previous };
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["torrents"] }); qc.invalidateQueries({ queryKey: ["files"] }); },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(["torrents"], context.previous);
    },
  });

  const stats = useMemo(() => {
    const rows = torrents.data ?? [];
    return {
      active: rows.filter((r) => r.status === "downloading").length,
      down: rows.reduce((s, r) => s + r.download_speed, 0),
      up: rows.reduce((s, r) => s + r.upload_speed, 0),
      stored: storage.data?.user?.used ?? storage.data?.used ?? rows.reduce((s, r) => s + r.size * r.progress, 0),
    };
  }, [storage.data?.used, storage.data?.user?.used, torrents.data]);
  const visibleTorrents = useMemo(
    () => (torrents.data ?? []).filter((t) => !t.id.startsWith("local-uploads") && t.status !== "completed"),
    [torrents.data]
  );

  if (!authed) return <Navigate to="/login" replace />;

  const cards: [string, string | number, LucideIcon, string][] = [
    ["Active downloads", stats.active, Gauge, "text-accent2 bg-accent/15"],
    ["Download", fmt(stats.down) + "/s", Download, "text-stream bg-stream/15"],
    ["Upload", fmt(stats.up) + "/s", ArrowUpRight, "text-violet bg-violet/15"],
    ["Stored", fmt(stats.stored), Waves, "text-sky-400 bg-sky-400/15"],
  ];

  return (
    <Shell>
      {/* Stat cards */}
      <section className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, Icon, tone], i) => (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            key={label} className="glass min-w-0 rounded-2xl p-5"
          >
            <div className="flex items-center gap-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span>
              <span className="truncate text-sm font-medium text-slate-400">{label}</span>
            </div>
            <p className="mt-4 text-3xl font-extrabold tracking-tight text-white">{value}</p>
          </motion.div>
        ))}
      </section>

      {/* Command bar */}
      <section className="glass mt-4 min-w-0 rounded-2xl p-4">
        <form onSubmit={(e) => { e.preventDefault(); const uri = magnetUri.trim(); if (uri.startsWith("magnet:")) add.mutate(uri); }} className="flex flex-col gap-3 md:flex-row">
          <label className="sr-only" htmlFor="magnet">Magnet link</label>
          <div className="relative flex-1">
            <Plus className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input id="magnet" value={magnetUri} onFocus={autoPasteMagnet} onClick={autoPasteMagnet} onChange={(e) => setMagnetUri(e.target.value)} placeholder="Paste a magnet link to start downloading…" className="field pl-11" />
          </div>
          <button disabled={add.isPending || !magnetUri.trim().startsWith("magnet:")} className="btn-primary min-h-12 px-6">{add.isPending ? "Adding…" : "Join swarm"}</button>
          <button type="button" title="Upload any file, or a .torrent to add it to the swarm" onClick={() => fileInput.current?.click()} disabled={uploadPct !== null} className="btn-ghost min-h-12 px-5">
            <Upload className="h-4 w-4" />{uploadPct === null ? "Upload" : `${uploadPct}%`}
          </button>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
        </form>
        {uploadPct !== null && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-stream transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); const url = remoteUrl.trim(); if (url) addUrl.mutate(url); }} className="mt-3 flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="Add a direct HTTPS file URL…" className="field pl-11" />
          </div>
          <button disabled={addUrl.isPending || !remoteUrl.trim()} className="btn-ghost min-h-12 px-5">{addUrl.isPending ? "Adding…" : "Add URL"}</button>
        </form>
      </section>

      {/* Torrents */}
      <section className="glass mt-4 min-w-0 rounded-2xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Downloads</h2>
          <span className="chip">{visibleTorrents.length} active</span>
        </div>
        <div className="space-y-2.5">
          {visibleTorrents.map((torrent) => {
            const pct = Math.round(torrent.progress * 100);
            return (
              <article key={torrent.id} className="card card-hover rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/torrents/${torrent.id}`} className="block truncate font-semibold text-white transition hover:text-accent2">{torrent.name}</Link>
                    <p className="mt-0.5 text-sm text-slate-400">
                      <span className={`font-medium ${statusTone[torrent.status] ?? "text-slate-400"}`}>{torrent.status}</span>
                      {" · "}{fmt(torrent.download_speed)}/s{" · "}{pct}%
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {torrent.status !== "completed" && (
                      <>
                        <button aria-label={torrent.status === "paused" ? "Resume" : "Pause"} onClick={() => action.mutate({ id: torrent.id, kind: torrent.status === "paused" ? "resume" : "pause" })} className="icon-btn">
                          {torrent.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        </button>
                        <button aria-label="Reannounce" onClick={() => action.mutate({ id: torrent.id, kind: "reannounce" })} className="icon-btn"><RefreshCw className="h-4 w-4" /></button>
                      </>
                    )}
                    <button aria-label="Delete" onClick={() => action.mutate({ id: torrent.id, kind: "delete" })} className="icon-btn hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className={`h-full rounded-full ${torrent.status === "completed" ? "bg-emerald-400" : "bg-stream"}`} style={{ width: `${pct}%` }} />
                </div>
              </article>
            );
          })}
          {!visibleTorrents.length && (
            <div className="rounded-xl border border-dashed border-white/10 px-6 py-14 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent2"><Download className="h-6 w-6" /></div>
              <p className="mt-4 font-semibold text-white">No active downloads</p>
              <p className="mt-1 text-sm text-slate-400">Paste a magnet link above, or upload a file to get started.</p>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
