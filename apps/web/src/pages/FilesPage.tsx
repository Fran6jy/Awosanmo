import { useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Eye, FileArchive, FileText, Film, Folder, FolderOpen, FolderPlus, FolderInput, Home, Image as ImageIcon, Link2, Music, Pencil, Search, Trash2, Upload, X } from "lucide-react";
import { Shell } from "../components/Shell";
import { API_URL, api, token, uploadFile, uploadTorrentFile, downloadZip } from "../lib/api";
import { pushToast } from "../components/Toast";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { formatBytes, formatDuration } from "../lib/format";
import { canPreview, previewKind } from "../lib/fileTypes";

type FileRow = {
  id: string; name: string; path: string; size: number; media_kind: string; streamable: number;
  duration?: number | null; width?: number | null; height?: number | null; codec_video?: string | null; probe_status?: string;
};
type FolderRow = { id: string; name: string; parent_id: string | null };
type FolderList = { folders: FolderRow[]; breadcrumb: FolderRow[] };

export function FilesPage() {
  const authed = !!token();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState("root");
  const [renaming, setRenaming] = useState<FileRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const searching = query.trim().length > 0;

  const files = useQuery({
    queryKey: ["files", query, folderId],
    queryFn: () => api<FileRow[]>(`/api/files?${searching ? `q=${encodeURIComponent(query)}` : `folderId=${folderId}`}`),
    refetchInterval: 5000,
    enabled: authed,
  });
  const folders = useQuery({
    queryKey: ["folders", folderId],
    queryFn: () => api<FolderList>(`/api/folders?parent=${folderId}`),
    enabled: authed && !searching,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["files"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
  };

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api<FileRow>(`/api/files/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => { setRenaming(null); invalidate(); },
    onError: (e: Error) => pushToast({ type: "error", title: "Rename failed", body: e.message.slice(0, 140) }),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/files/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api<{ deleted: number }>("/api/files/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: (res) => { setSelected(new Set()); invalidate(); pushToast({ type: "success", title: `Deleted ${res.deleted} file${res.deleted === 1 ? "" : "s"}` }); },
  });
  const createFolder = useMutation({
    mutationFn: (name: string) => api<FolderRow>("/api/folders", { method: "POST", body: JSON.stringify({ name, parentId: folderId === "root" ? null : folderId }) }),
    onSuccess: () => { invalidate(); pushToast({ type: "success", title: "Folder created" }); },
    onError: (e: Error) => pushToast({ type: "error", title: "Could not create folder", body: e.message.slice(0, 140) }),
  });
  const renameFolderM = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => { invalidate(); pushToast({ type: "success", title: "Folder renamed" }); },
  });
  const deleteFolder = useMutation({
    mutationFn: (id: string) => api(`/api/folders/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); pushToast({ type: "info", title: "Folder removed", body: "Its files returned to the library root." }); },
  });
  const move = useMutation({
    mutationFn: ({ ids, target }: { ids: string[]; target: string | null }) => api<{ moved: number }>("/api/files/move", { method: "POST", body: JSON.stringify({ ids, folderId: target }) }),
    onSuccess: (res) => { setSelected(new Set()); setMoveIds(null); invalidate(); pushToast({ type: "success", title: `Moved ${res.moved} file${res.moved === 1 ? "" : "s"}` }); },
  });

  async function copyDownloadLink(id: string) {
    try {
      const { downloadToken } = await api<{ downloadToken: string }>(`/api/download-token/${id}`, { method: "POST" });
      const url = `${location.origin}${API_URL}/api/download/${id}?dt=${encodeURIComponent(downloadToken)}`;
      try {
        await navigator.clipboard.writeText(url);
        pushToast({ type: "success", title: "Download link copied", body: "Valid for 1 hour." });
      } catch {
        // Clipboard needs a secure context (HTTPS); fall back to a prompt.
        window.prompt("Copy this download link (valid 1 hour):", url);
      }
    } catch (e) {
      pushToast({ type: "error", title: "Could not create link", body: (e as Error).message.slice(0, 120) });
    }
  }

  function openFileMenu(e: React.MouseEvent, file: FileRow) {
    e.preventDefault();
    const items: MenuItem[] = [];
    if (canPreview(file)) items.push({ label: "Open", icon: Eye, onClick: () => nav(`/view/${file.id}`) });
    items.push(
      { label: "Download", icon: Download, onClick: () => void downloadOne(file.id) },
      { label: "Copy download link", icon: Link2, onClick: () => void copyDownloadLink(file.id) },
      "divider",
      { label: "Rename", icon: Pencil, onClick: () => setRenaming(file) },
      { label: "Move to folder…", icon: FolderInput, onClick: () => setMoveIds([file.id]) },
      "divider",
      { label: "Delete", icon: Trash2, danger: true, onClick: () => remove.mutate(file.id) },
    );
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  function openFolderMenu(e: React.MouseEvent, folder: FolderRow) {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Open", icon: FolderOpen, onClick: () => setFolderId(folder.id) },
        { label: "Rename", icon: Pencil, onClick: () => { const n = prompt("Rename folder", folder.name); if (n?.trim()) renameFolderM.mutate({ id: folder.id, name: n.trim() }); } },
        "divider",
        { label: "Delete", icon: Trash2, danger: true, onClick: () => { if (confirm(`Delete folder "${folder.name}"? Its files return to the library root.`)) deleteFolder.mutate(folder.id); } },
      ],
    });
  }

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
        if (isTorrent) { await uploadTorrentFile(file); pushToast({ type: "success", title: "Torrent added", body: file.name }); qc.invalidateQueries({ queryKey: ["torrents"] }); }
        else { await uploadFile(file, (f) => setUploadPct(Math.round(f * 100))); pushToast({ type: "success", title: "Upload complete", body: file.name }); }
        invalidate();
      } catch (e) {
        pushToast({ type: "error", title: "Upload failed", body: (e as Error).message.slice(0, 140) });
      } finally { setUploadPct(null); }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  const rows = useMemo(() => files.data ?? [], [files.data]);
  const subfolders = folders.data?.folders ?? [];
  const breadcrumb = folders.data?.breadcrumb ?? [];
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  if (!authed) return <Navigate to="/login" replace />;

  return (
    <Shell>
      <section className="rounded-2xl p-5 glass">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-mono text-xs font-bold uppercase text-stream">Library</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">All files</h1>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block sm:w-72">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all files" className="min-h-12 w-full rounded-xl border border-line bg-white pl-11 pr-4 text-slate-950 outline-none focus:ring-2 focus:ring-stream" />
            </label>
            <button type="button" onClick={() => { const n = prompt("New folder name"); if (n?.trim()) createFolder.mutate(n.trim()); }} disabled={searching} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40">
              <FolderPlus className="h-4 w-4" /> New folder
            </button>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploadPct !== null} title="Upload any file, or a .torrent to add it to the swarm" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 font-bold text-white transition hover:bg-slate-800 disabled:opacity-50">
              <Upload className="h-4 w-4" />{uploadPct === null ? "Upload" : `${uploadPct}%`}
            </button>
            <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
          </div>
        </div>
        {uploadPct !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-stream transition-all" style={{ width: `${uploadPct}%` }} /></div>}

        {/* Breadcrumb */}
        {!searching && (
          <nav className="mt-4 flex flex-wrap items-center gap-1 text-sm text-slate-400">
            <button onClick={() => setFolderId("root")} className="flex items-center gap-1 rounded-lg px-2 py-1 transition hover:bg-slate-100 hover:text-slate-950"><Home className="h-4 w-4" /> Library</button>
            {breadcrumb.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <ChevronRight className="h-4 w-4" />
                <button onClick={() => setFolderId(f.id)} className="rounded-lg px-2 py-1 transition hover:bg-slate-100 hover:text-slate-950">{f.name}</button>
              </span>
            ))}
          </nav>
        )}
      </section>

      {/* Bulk action bar */}
      {rows.length > 0 && (
        <section className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 glass">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((f) => f.id)))} className="h-4 w-4 accent-emerald-400" />
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </label>
          {selected.size > 0 && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => downloadZip(Array.from(selected)).catch((e) => pushToast({ type: "error", title: "ZIP failed", body: (e as Error).message.slice(0, 120) }))} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:bg-slate-100"><FileArchive className="h-4 w-4" /> Download ZIP</button>
              <button onClick={() => setMoveIds(Array.from(selected))} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:bg-slate-100"><FolderInput className="h-4 w-4" /> Move</button>
              <button onClick={() => bulkDelete.mutate(Array.from(selected))} disabled={bulkDelete.isPending} className="flex min-h-10 items-center gap-2 rounded-lg border border-red-400/40 px-3 text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"><Trash2 className="h-4 w-4" /> Delete</button>
              <button onClick={() => setSelected(new Set())} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-500 transition hover:bg-slate-100"><X className="h-4 w-4" /> Clear</button>
            </div>
          )}
        </section>
      )}

      <section className="mt-4 overflow-hidden rounded-2xl glass">
        <div className="hidden min-w-0 grid-cols-[44px_minmax(0,1fr)_120px_120px_160px] items-center border-b border-line bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 md:grid">
          <span />
          <span>Name</span>
          <span>Type</span>
          <span>Size</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="divide-y divide-slate-100">
          {/* Subfolders */}
          {!searching && subfolders.map((f) => (
            <article key={f.id} onContextMenu={(e) => openFolderMenu(e, f)} className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-slate-50 md:grid-cols-[44px_minmax(0,1fr)_120px_120px_160px]">
              <span />
              <button onClick={() => setFolderId(f.id)} className="flex min-w-0 items-center gap-3 text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><Folder className="h-5 w-5" /></span>
                <span className="truncate font-semibold text-slate-900">{f.name}</span>
              </button>
              <span className="hidden text-sm text-slate-500 md:block">Folder</span>
              <span className="hidden text-sm text-slate-400 md:block">--</span>
              <button onClick={() => { if (confirm(`Delete folder "${f.name}"? Its files return to the library root.`)) deleteFolder.mutate(f.id); }} className="ml-auto grid h-10 w-10 place-items-center rounded-lg text-red-500 transition hover:bg-red-50" aria-label="Delete folder"><Trash2 className="h-4 w-4" /></button>
            </article>
          ))}
          {/* Files */}
          {rows.map((file) => (
            <article key={file.id} onContextMenu={(e) => openFileMenu(e, file)} className={`grid min-w-0 gap-3 px-4 py-3 transition md:grid-cols-[44px_minmax(0,1fr)_120px_120px_160px] md:items-center ${selected.has(file.id) ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
              <input type="checkbox" checked={selected.has(file.id)} onChange={() => toggle(file.id)} className="h-4 w-4 self-center accent-emerald-400" aria-label={`Select ${file.name}`} />
              <div className="flex min-w-0 items-center gap-3">
                <FileGlyph file={file} />
                <div className="min-w-0">
                  {canPreview(file) ? <Link to={`/view/${file.id}`} className="block truncate font-semibold text-slate-900 transition hover:text-stream">{file.name}</Link> : <p className="truncate font-semibold text-slate-900">{file.name}</p>}
                  <p className="mt-1 truncate text-xs text-slate-500">{[file.width && file.height ? `${file.width}x${file.height}` : null, file.codec_video?.toUpperCase(), formatDuration(file.duration), file.probe_status].filter(Boolean).join(" · ") || file.path}</p>
                </div>
              </div>
              <span className="hidden text-sm capitalize text-slate-500 md:block">{previewKind(file)}</span>
              <span className="hidden font-mono text-sm text-slate-600 md:block">{formatBytes(file.size)}</span>
              <div className="flex flex-wrap gap-1 md:justify-end">
                {canPreview(file) ? <Link to={`/view/${file.id}`} className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-stream" aria-label="Open"><Eye className="h-4 w-4" /></Link> : null}
                <button onClick={() => void downloadOne(file.id)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-stream" aria-label="Download"><Download className="h-4 w-4" /></button>
                <button onClick={() => setRenaming(file)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-stream" aria-label="Rename"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove.mutate(file.id)} className="grid h-10 w-10 place-items-center rounded-lg text-red-500 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
          {!rows.length && !subfolders.length ? <div className="p-10 text-center text-slate-500">{searching ? "No files match your search." : "This folder is empty. Upload files or a .torrent, or create a folder."}</div> : null}
        </div>
      </section>

      {/* Right-click context menu */}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}

      {/* Move modal */}
      {moveIds ? <MovePicker onClose={() => setMoveIds(null)} onPick={(target) => move.mutate({ ids: moveIds, target })} /> : null}

      {/* Rename modal */}
      {renaming ? (
        <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); rename.mutate({ id: renaming.id, name: String(form.get("name") ?? "") }); }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl p-5 glass">
            <h2 className="text-xl font-bold">Rename file</h2>
            <input name="name" defaultValue={renaming.name} className="mt-4 min-h-12 w-full rounded-xl border border-line bg-white px-4 text-slate-950 outline-none focus:ring-2 focus:ring-stream" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="min-h-11 rounded-xl border border-line px-4 transition hover:bg-slate-100">Cancel</button>
              <button className="min-h-11 rounded-xl bg-slate-950 px-4 font-bold text-white transition hover:bg-slate-800">Save</button>
            </div>
          </div>
        </form>
      ) : null}
    </Shell>
  );
}

function FileGlyph({ file }: { file: FileRow }) {
  const kind = previewKind(file);
  const base = "grid h-10 w-10 shrink-0 place-items-center rounded-xl";
  if (kind === "video") return <span className={`${base} bg-emerald-100 text-emerald-700`}><Film className="h-5 w-5" /></span>;
  if (kind === "audio") return <span className={`${base} bg-purple-100 text-purple-700`}><Music className="h-5 w-5" /></span>;
  if (kind === "image") return <span className={`${base} bg-sky-100 text-sky-700`}><ImageIcon className="h-5 w-5" /></span>;
  if (kind === "pdf" || kind === "epub" || kind === "text") return <span className={`${base} bg-rose-100 text-rose-700`}><FileText className="h-5 w-5" /></span>;
  return <span className={`${base} bg-slate-100 text-slate-600`}><FileArchive className="h-5 w-5" /></span>;
}

function MovePicker({ onClose, onPick }: { onClose: () => void; onPick: (target: string | null) => void }) {
  const all = useQuery({ queryKey: ["folders", "all"], queryFn: () => api<FolderList>("/api/folders?all=1") });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl p-5 glass">
        <h2 className="text-xl font-bold">Move to folder</h2>
        <div className="mt-4 max-h-72 space-y-1 overflow-auto">
          <button onClick={() => onPick(null)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10"><Home className="h-4 w-4" /> Library root</button>
          {(all.data?.folders ?? []).map((f) => (
            <button key={f.id} onClick={() => onPick(f.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10"><Folder className="h-4 w-4 text-violet-300" /> {f.name}</button>
          ))}
          {!all.data?.folders.length ? <p className="px-3 py-2 text-sm text-slate-400">No folders yet. Create one first.</p> : null}
        </div>
        <div className="mt-4 flex justify-end"><button onClick={onClose} className="min-h-11 rounded-xl border border-line px-4 transition hover:bg-white/10">Cancel</button></div>
      </div>
    </div>
  );
}
