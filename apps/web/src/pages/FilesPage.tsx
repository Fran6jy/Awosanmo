import { useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Film, Folder, Pencil, Play, Search, Trash2, Upload, X } from "lucide-react";
import { Shell } from "../components/Shell";
import { API_URL, api, token, uploadFile, uploadTorrentFile } from "../lib/api";
import { pushToast } from "../components/Toast";
import { formatBytes, formatDuration } from "../lib/format";

type FileRow = {
  id: string;
  name: string;
  path: string;
  size: number;
  media_kind: string;
  streamable: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  codec_video?: string | null;
  probe_status?: string;
};

export function FilesPage() {
  const authed = !!token();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<FileRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const files = useQuery({
    queryKey: ["files", query],
    queryFn: () => api<FileRow[]>(`/api/files${query ? `?q=${encodeURIComponent(query)}` : ""}`),
    refetchInterval: 5000,
    enabled: authed
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api<FileRow>(`/api/files/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setRenaming(null);
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (e: Error) => pushToast({ type: "error", title: "Rename failed", body: e.message.slice(0, 140) })
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/files/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["files"] })
  });
  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api<{ deleted: number }>("/api/files/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: (res) => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["files"] });
      pushToast({ type: "success", title: `Deleted ${res.deleted} file${res.deleted === 1 ? "" : "s"}` });
    }
  });

  async function downloadOne(id: string) {
    const { downloadToken } = await api<{ downloadToken: string; expiresIn: number }>(`/api/download-token/${id}`, { method: "POST" });
    window.location.href = `${API_URL}/api/download/${id}?dt=${encodeURIComponent(downloadToken)}`;
  }

  async function onUpload(list: FileList | null) {
    if (!list?.length) return;
    for (const file of Array.from(list)) {
      const isTorrent = file.name.toLowerCase().endsWith(".torrent");
      try {
        setUploadPct(0);
        if (isTorrent) {
          await uploadTorrentFile(file);
          pushToast({ type: "success", title: "Torrent added", body: file.name });
          qc.invalidateQueries({ queryKey: ["torrents"] });
        } else {
          await uploadFile(file, (f) => setUploadPct(Math.round(f * 100)));
          pushToast({ type: "success", title: "Upload complete", body: file.name });
        }
        qc.invalidateQueries({ queryKey: ["files"] });
      } catch (e) {
        pushToast({ type: "error", title: "Upload failed", body: (e as Error).message.slice(0, 140) });
      } finally {
        setUploadPct(null);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  const grouped = useMemo(() => files.data ?? [], [files.data]);
  const allSelected = grouped.length > 0 && selected.size === grouped.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(grouped.map((f) => f.id)));
  }

  if (!authed) return <Navigate to="/login" replace />;

  return (
    <Shell>
      <section className="rounded-2xl p-5 glass">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-mono text-sm text-stream">FILES</p>
            <h1 className="mt-1 text-3xl font-bold">Library</h1>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block sm:w-80">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files, folders, codecs" className="min-h-12 w-full rounded-xl border border-line bg-white/5 pl-11 pr-4 outline-none focus:ring-2 focus:ring-stream" />
            </label>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploadPct !== null} title="Upload any file, or a .torrent to add it to the swarm" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-stream px-5 font-bold text-ink transition hover:bg-emerald-300 disabled:opacity-50">
              <Upload className="h-4 w-4" />{uploadPct === null ? "Upload" : `${uploadPct}%`}
            </button>
            <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
          </div>
        </div>
        {uploadPct !== null && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-stream transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        )}
      </section>

      {/* Bulk action bar */}
      {grouped.length > 0 && (
        <section className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 glass">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-emerald-400" />
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </label>
          {selected.size > 0 && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => Array.from(selected).forEach((id) => void downloadOne(id))} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:bg-white/10">
                <Download className="h-4 w-4" /> Download
              </button>
              <button onClick={() => bulkDelete.mutate(Array.from(selected))} disabled={bulkDelete.isPending} className="flex min-h-10 items-center gap-2 rounded-lg border border-red-400/40 px-3 text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-50">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
              <button onClick={() => setSelected(new Set())} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-400 transition hover:bg-white/10">
                <X className="h-4 w-4" /> Clear
              </button>
            </div>
          )}
        </section>
      )}

      <section className="mt-4 rounded-2xl p-3 glass">
        <div className="space-y-2">
          {grouped.map((file) => (
            <article key={file.id} className={`grid gap-3 rounded-xl border p-3 md:grid-cols-[auto_1fr_auto] md:items-center ${selected.has(file.id) ? "border-stream/50 bg-stream/[.06]" : "border-line bg-white/[.03]"}`}>
              <input type="checkbox" checked={selected.has(file.id)} onChange={() => toggle(file.id)} className="h-4 w-4 self-center accent-emerald-400" aria-label={`Select ${file.name}`} />
              <div className="flex min-w-0 items-center gap-3">
                {file.media_kind === "video" ? <Film className="h-5 w-5 shrink-0 text-stream" /> : <Folder className="h-5 w-5 shrink-0 text-violet-300" />}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{file.name}</p>
                  <p className="truncate text-sm text-slate-500">{file.path}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{[formatBytes(file.size), file.width && file.height ? `${file.width}x${file.height}` : null, file.codec_video?.toUpperCase(), formatDuration(file.duration), file.probe_status].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                {file.streamable ? <Link to={`/watch/${file.id}`} className="grid h-10 w-10 place-items-center rounded-lg transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream" aria-label="Play"><Play className="h-4 w-4" /></Link> : null}
                <button onClick={() => void downloadOne(file.id)} className="grid h-10 w-10 place-items-center rounded-lg transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream" aria-label="Download"><Download className="h-4 w-4" /></button>
                <button onClick={() => setRenaming(file)} className="grid h-10 w-10 place-items-center rounded-lg transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream" aria-label="Rename"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove.mutate(file.id)} className="grid h-10 w-10 place-items-center rounded-lg text-red-200 transition hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-300" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
          {!grouped.length ? <div className="rounded-xl border border-line p-8 text-center text-slate-400">No files yet. Use Upload to add files or a .torrent.</div> : null}
        </div>
      </section>

      {renaming ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          rename.mutate({ id: renaming.id, name: String(form.get("name") ?? "") });
        }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl p-5 glass">
            <h2 className="text-xl font-bold">Rename file</h2>
            <input name="name" defaultValue={renaming.name} className="mt-4 min-h-12 w-full rounded-xl border border-line bg-white/5 px-4 outline-none focus:ring-2 focus:ring-stream" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="min-h-11 rounded-xl border border-line px-4 transition hover:bg-white/10">Cancel</button>
              <button className="min-h-11 rounded-xl bg-stream px-4 font-bold text-ink transition hover:bg-emerald-300">Save</button>
            </div>
          </div>
        </form>
      ) : null}
    </Shell>
  );
}
