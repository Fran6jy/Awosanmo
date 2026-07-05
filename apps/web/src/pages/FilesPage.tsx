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
  const [confirmDel, setConfirmDel] = useState<{ ids: string[]; label: string } | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [dragging, setDragging] = useState(0);
  const dragIds = useRef<string[]>([]);
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
      { label: "Delete", icon: Trash2, danger: true, onClick: () => setConfirmDel({ ids: [file.id], label: file.name }) },
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

  // Drag a file (or the whole selection if the dragged file is selected) onto a folder.
  function onFileDragStart(e: React.DragEvent, file: FileRow) {
    const ids = selected.has(file.id) && selected.size > 0 ? Array.from(selected) : [file.id];
    dragIds.current = ids;
    setDragging(ids.length);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ids.join(","));
    // Custom drag ghost so the user clearly sees what they're moving.
    const ghost = document.createElement("div");
    ghost.textContent = ids.length === 1 ? "Move 1 file" : `Move ${ids.length} files`;
    Object.assign(ghost.style, {
      position: "fixed", top: "-1000px", left: "-1000px", padding: "8px 14px", borderRadius: "10px",
      background: "#6366F1", color: "#fff", fontSize: "13px", fontWeight: "700", fontFamily: "inherit",
      boxShadow: "0 10px 30px rgba(0,0,0,.5)", pointerEvents: "none", zIndex: "9999",
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 14, 14);
    setTimeout(() => ghost.remove(), 0);
  }
  function onFileDragEnd() {
    setDragging(0);
    setDropFolder(null);
    dragIds.current = [];
  }
  // Allow the drop and show the "move" cursor (not the red not-allowed icon).
  function allowFolderDrop(e: React.DragEvent, target: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropFolder(target);
  }
  function onFolderDrop(e: React.DragEvent, target: string | null) {
    e.preventDefault();
    setDropFolder(null);
    setDragging(0);
    const raw = dragIds.current.length ? dragIds.current : (e.dataTransfer.getData("text/plain").split(",").filter(Boolean));
    dragIds.current = [];
    if (raw.length) move.mutate({ ids: raw, target });
  }
  // Run a delete after confirmation (single file via remove, multiple via bulk).
  function runConfirmedDelete() {
    if (!confirmDel) return;
    if (confirmDel.ids.length === 1) remove.mutate(confirmDel.ids[0]!);
    else bulkDelete.mutate(confirmDel.ids);
    setConfirmDel(null);
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
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all files" className="min-h-12 w-full rounded-xl border border-line bg-white/[0.04] pl-11 pr-4 text-white outline-none focus:ring-2 focus:ring-stream" />
            </label>
            <button type="button" onClick={() => { const n = prompt("New folder name"); if (n?.trim()) createFolder.mutate(n.trim()); }} disabled={searching} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-white/[0.04] px-4 font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-40">
              <FolderPlus className="h-4 w-4" /> New folder
            </button>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploadPct !== null} title="Upload any file, or a .torrent to add it to the swarm" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-bold text-white transition hover:bg-accent2 disabled:opacity-50">
              <Upload className="h-4 w-4" />{uploadPct === null ? "Upload" : `${uploadPct}%`}
            </button>
            <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
          </div>
        </div>
        {uploadPct !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-stream transition-all" style={{ width: `${uploadPct}%` }} /></div>}

        {/* Breadcrumb */}
        {!searching && (
          <nav className="mt-4 flex flex-wrap items-center gap-1 text-sm text-slate-400">
            <button
              onClick={() => setFolderId("root")}
              onDragOver={(e) => allowFolderDrop(e, "root")}
              onDragLeave={() => setDropFolder((cur) => (cur === "root" ? null : cur))}
              onDrop={(e) => onFolderDrop(e, null)}
              className={`flex items-center gap-1 rounded-lg px-2 py-1 transition hover:bg-white/10 hover:text-white ${dropFolder === "root" ? "bg-accent/25 text-accent2 ring-2 ring-accent" : dragging ? "text-accent2 ring-1 ring-accent/40" : ""}`}
            ><Home className="h-4 w-4" /> Library</button>
            {breadcrumb.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <ChevronRight className="h-4 w-4" />
                <button onClick={() => setFolderId(f.id)} className="rounded-lg px-2 py-1 transition hover:bg-white/10 hover:text-white">{f.name}</button>
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
              <button onClick={() => downloadZip(Array.from(selected)).catch((e) => pushToast({ type: "error", title: "ZIP failed", body: (e as Error).message.slice(0, 120) }))} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:bg-white/10"><FileArchive className="h-4 w-4" /> Download ZIP</button>
              <button onClick={() => setMoveIds(Array.from(selected))} className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm transition hover:bg-white/10"><FolderInput className="h-4 w-4" /> Move</button>
              <button onClick={() => setConfirmDel({ ids: Array.from(selected), label: `${selected.size} file${selected.size === 1 ? "" : "s"}` })} disabled={bulkDelete.isPending} className="flex min-h-10 items-center gap-2 rounded-lg border border-rose-500/40 px-3 text-sm text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"><Trash2 className="h-4 w-4" /> Delete</button>
              <button onClick={() => setSelected(new Set())} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-400 transition hover:bg-white/10"><X className="h-4 w-4" /> Clear</button>
            </div>
          )}
        </section>
      )}

      <section
        className="mt-4 overflow-hidden rounded-2xl glass"
        onDragOver={(e) => { if (dragging > 0) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
        onDrop={(e) => { if (dragging > 0) { e.preventDefault(); onFileDragEnd(); } }}
      >
        <div className="hidden min-w-0 grid-cols-[44px_minmax(0,1fr)_120px_120px_160px] items-center border-b border-line bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-400 md:grid">
          <span />
          <span>Name</span>
          <span>Type</span>
          <span>Size</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="divide-y divide-white/[0.06]">
          {/* Subfolders */}
          {!searching && subfolders.map((f) => (
            <article
              key={f.id}
              onContextMenu={(e) => openFolderMenu(e, f)}
              onDragOver={(e) => allowFolderDrop(e, f.id)}
              onDragLeave={() => setDropFolder((cur) => (cur === f.id ? null : cur))}
              onDrop={(e) => onFolderDrop(e, f.id)}
              className={`grid min-w-0 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition md:grid-cols-[44px_minmax(0,1fr)_120px_120px_160px] ${dropFolder === f.id ? "bg-accent/25 ring-2 ring-inset ring-accent" : dragging ? "bg-accent/[0.07] ring-1 ring-inset ring-accent/30" : "hover:bg-white/5"}`}
            >
              <span />
              <button onClick={() => setFolderId(f.id)} className="flex min-w-0 items-center gap-3 text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-300"><Folder className="h-5 w-5" /></span>
                <span className="truncate font-semibold text-white">{f.name}{dropFolder === f.id ? <span className="ml-2 text-xs font-medium text-accent2">Drop to move here</span> : null}</span>
              </button>
              <span className="hidden text-sm text-slate-400 md:block">Folder</span>
              <span className="hidden text-sm text-slate-400 md:block">--</span>
              <button onClick={() => { if (confirm(`Delete folder "${f.name}"? Its files return to the library root.`)) deleteFolder.mutate(f.id); }} className="ml-auto grid h-10 w-10 place-items-center rounded-lg text-rose-400 transition hover:bg-rose-500/10" aria-label="Delete folder"><Trash2 className="h-4 w-4" /></button>
            </article>
          ))}
          {/* Files */}
          {rows.map((file) => (
            <article key={file.id} draggable onDragStart={(e) => onFileDragStart(e, file)} onDragEnd={onFileDragEnd} onContextMenu={(e) => openFileMenu(e, file)} className={`flex min-w-0 cursor-grab items-center gap-3 px-3 py-3 transition active:cursor-grabbing sm:px-4 md:grid md:grid-cols-[44px_minmax(0,1fr)_120px_120px_160px] md:items-center ${selected.has(file.id) ? "bg-accent/10" : "hover:bg-white/5"}`}>
              <input type="checkbox" checked={selected.has(file.id)} onChange={() => toggle(file.id)} className="h-4 w-4 shrink-0 self-center accent-emerald-400" aria-label={`Select ${file.name}`} />
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <FileGlyph file={file} />
                <div className="min-w-0">
                  {canPreview(file) ? <Link to={`/view/${file.id}`} className="block truncate font-semibold text-white transition hover:text-stream">{file.name}</Link> : <p className="truncate font-semibold text-white">{file.name}</p>}
                  <p className="mt-1 truncate text-xs text-slate-400">{formatBytes(file.size)} · {fileDetail(file)}</p>
                </div>
              </div>
              <span className="hidden text-sm capitalize text-slate-400 md:block">{previewKind(file)}</span>
              <span className="hidden font-mono text-sm text-slate-300 md:block">{formatBytes(file.size)}</span>
              <div className="flex shrink-0 gap-1 md:justify-end">
                {canPreview(file) ? <Link to={`/view/${file.id}`} className="hidden h-10 w-10 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-stream sm:grid" aria-label="Open"><Eye className="h-4 w-4" /></Link> : null}
                <button onClick={() => void downloadOne(file.id)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-stream" aria-label="Download"><Download className="h-4 w-4" /></button>
                <button onClick={() => setRenaming(file)} className="hidden h-10 w-10 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-stream sm:grid" aria-label="Rename"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => setConfirmDel({ ids: [file.id], label: file.name })} className="grid h-10 w-10 place-items-center rounded-lg text-rose-400 transition hover:bg-rose-500/10 focus:outline-none focus:ring-2 focus:ring-rose-500/40" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
          {!rows.length && !subfolders.length ? <div className="p-10 text-center text-slate-400">{searching ? "No files match your search." : "This folder is empty. Upload files or a .torrent, or create a folder."}</div> : null}
        </div>
      </section>

      {/* Drag hint banner */}
      {dragging > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
          <div className="panel flex items-center gap-2 px-4 py-2.5 text-sm">
            <FolderInput className="h-4 w-4 text-accent2" />
            <span className="font-medium text-white">Drop on a folder{subfolders.length ? "" : " (or the Library breadcrumb)"} to move {dragging === 1 ? "this file" : `${dragging} files`}</span>
          </div>
        </div>
      ) : null}

      {/* Right-click context menu */}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}

      {/* Move modal */}
      {moveIds ? <MovePicker onClose={() => setMoveIds(null)} onPick={(target) => move.mutate({ ids: moveIds, target })} /> : null}

      {/* Delete confirmation */}
      {confirmDel ? (
        <div className="scrim grid place-items-center px-4" onClick={() => setConfirmDel(null)}>
          <div onClick={(e) => e.stopPropagation()} className="panel w-full max-w-md p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-500/15 text-rose-300"><Trash2 className="h-5 w-5" /></span>
              <h2 className="text-lg font-bold text-white">Delete {confirmDel.ids.length === 1 ? "file" : `${confirmDel.ids.length} files`}?</h2>
            </div>
            <p className="mt-3 text-sm text-slate-400">
              <span className="font-medium text-slate-200">{confirmDel.label}</span> will be permanently removed from your storage. This can’t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="btn-ghost min-h-11">Cancel</button>
              <button onClick={runConfirmedDelete} className="btn-danger min-h-11">Delete</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Rename modal */}
      {renaming ? (
        <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); rename.mutate({ id: renaming.id, name: String(form.get("name") ?? "") }); }} className="scrim grid place-items-center px-4">
          <div className="panel w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-white">Rename file</h2>
            <input name="name" defaultValue={renaming.name} autoFocus className="field mt-4" />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="btn-ghost min-h-11">Cancel</button>
              <button className="btn-primary min-h-11 px-5">Save</button>
            </div>
          </div>
        </form>
      ) : null}
    </Shell>
  );
}

function fileDetail(file: FileRow) {
  const transcode = previewKind(file) === "video" && needsBrowserTranscode(file.name, file.codec_video) ? "browser transcode" : null;
  return [file.width && file.height ? `${file.width}x${file.height}` : null, file.codec_video?.toUpperCase(), formatDuration(file.duration), transcode]
    .filter(Boolean)
    .join(" · ") || file.path;
}

function needsBrowserTranscode(name: string, codec?: string | null) {
  const ext = name.split(".").pop()?.toLowerCase();
  const normalizedCodec = codec?.toLowerCase();
  return ["mkv", "avi", "flv", "wmv", "mpeg", "mpg"].includes(ext ?? "") || normalizedCodec === "hevc" || normalizedCodec === "h265";
}

function FileGlyph({ file }: { file: FileRow }) {
  const kind = previewKind(file);
  const base = "grid h-10 w-10 shrink-0 place-items-center rounded-xl";
  if (kind === "video") return <span className={`${base} bg-emerald-500/15 text-emerald-300`}><Film className="h-5 w-5" /></span>;
  if (kind === "audio") return <span className={`${base} bg-violet/20 text-violet-300`}><Music className="h-5 w-5" /></span>;
  if (kind === "image") return <span className={`${base} bg-sky-400/15 text-sky-300`}><ImageIcon className="h-5 w-5" /></span>;
  if (kind === "pdf" || kind === "epub" || kind === "text") return <span className={`${base} bg-rose-400/15 text-rose-300`}><FileText className="h-5 w-5" /></span>;
  return <span className={`${base} bg-white/10 text-slate-300`}><FileArchive className="h-5 w-5" /></span>;
}

function MovePicker({ onClose, onPick }: { onClose: () => void; onPick: (target: string | null) => void }) {
  const all = useQuery({ queryKey: ["folders", "all"], queryFn: () => api<FolderList>("/api/folders?all=1") });
  return (
    <div className="scrim grid place-items-center px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="panel w-full max-w-md p-5">
        <h2 className="text-lg font-bold text-white">Move to folder</h2>
        <div className="mt-4 max-h-72 space-y-1 overflow-auto">
          <button onClick={() => onPick(null)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-200 transition hover:bg-white/10"><Home className="h-4 w-4" /> Library root</button>
          {(all.data?.folders ?? []).map((f) => (
            <button key={f.id} onClick={() => onPick(f.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-200 transition hover:bg-white/10"><Folder className="h-4 w-4 text-amber-300" /> {f.name}</button>
          ))}
          {!all.data?.folders.length ? <p className="px-3 py-2 text-sm text-slate-400">No folders yet. Create one first.</p> : null}
        </div>
        <div className="mt-4 flex justify-end"><button onClick={onClose} className="btn-ghost min-h-11">Cancel</button></div>
      </div>
    </div>
  );
}
