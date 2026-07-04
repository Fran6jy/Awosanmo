import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Film, Folder, Pencil, Play, Search, Trash2 } from "lucide-react";
import { Shell } from "../components/Shell";
import { API_URL, api, token } from "../lib/api";
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
    }
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/files/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["files"] })
  });
  const download = useMutation({
    mutationFn: async (id: string) => {
      const { downloadToken } = await api<{ downloadToken: string; expiresIn: number }>(`/api/download-token/${id}`, { method: "POST" });
      window.location.href = `${API_URL}/api/download/${id}?dt=${encodeURIComponent(downloadToken)}`;
    }
  });
  const grouped = useMemo(() => files.data ?? [], [files.data]);

  if (!authed) return <Navigate to="/login" replace />;

  return (
    <Shell>
      <section className="rounded-2xl p-5 glass">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-mono text-sm text-stream">FILES</p>
            <h1 className="mt-1 text-3xl font-bold">Library</h1>
          </div>
          <label className="relative block md:w-96">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files, folders, codecs" className="min-h-12 w-full rounded-xl border border-line bg-white/5 pl-11 pr-4 outline-none focus:ring-2 focus:ring-stream" />
          </label>
        </div>
      </section>

      <section className="mt-4 rounded-2xl p-3 glass">
        <div className="space-y-2">
          {grouped.map((file) => (
            <article key={file.id} className="grid gap-3 rounded-xl border border-line bg-white/[.03] p-3 md:grid-cols-[1fr_auto] md:items-center">
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
                <button onClick={() => download.mutate(file.id)} className="grid h-10 w-10 place-items-center rounded-lg transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream" aria-label="Download"><Download className="h-4 w-4" /></button>
                <button onClick={() => setRenaming(file)} className="grid h-10 w-10 place-items-center rounded-lg transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream" aria-label="Rename"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove.mutate(file.id)} className="grid h-10 w-10 place-items-center rounded-lg text-red-200 transition hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-300" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
          {!grouped.length ? <div className="rounded-xl border border-line p-8 text-center text-slate-400">No files found.</div> : null}
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
