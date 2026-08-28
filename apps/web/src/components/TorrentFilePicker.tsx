import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, File, Film, LoaderCircle, Music, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../lib/api";
import { formatBytes } from "../lib/format";
import { pushToast } from "./Toast";

type TorrentFile = {
  id: string;
  path: string;
  size: number;
  media_kind: string | null;
};

type TorrentDetail = {
  id: string;
  name: string;
  status: string;
  files: TorrentFile[];
};

const PICKER_EVENT = "awosanmo:select-torrent";

export function requestTorrentFileSelection(id: string) {
  window.dispatchEvent(new CustomEvent(PICKER_EVENT, { detail: { id } }));
}

export function TorrentFilePickerHost() {
  const [torrentId, setTorrentId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setTorrentId((event as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener(PICKER_EVENT, open);
    return () => window.removeEventListener(PICKER_EVENT, open);
  }, []);
  const close = useCallback(() => setTorrentId(null), []);
  return <TorrentFilePicker torrentId={torrentId} onClose={close} />;
}

function TorrentFilePicker({ torrentId, onClose }: { torrentId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const initializedFor = useRef<string | null>(null);
  const detail = useQuery({
    queryKey: ["torrent-picker", torrentId],
    queryFn: () => api<TorrentDetail>(`/api/torrents/${torrentId}`),
    enabled: Boolean(torrentId),
    refetchInterval: (query) => query.state.data?.files.length ? false : 1000,
  });

  // Only wipe the working state for a torrent we have not set up yet. Reopening
  // the same one restores the choices already made, so a submit that fails does
  // not force the user to pick everything again.
  useEffect(() => {
    if (!torrentId || initializedFor.current === torrentId) return;
    setSearch("");
    setSelected(new Set());
  }, [torrentId]);

  useEffect(() => {
    if (!torrentId || !detail.data?.files.length || initializedFor.current === torrentId) return;
    setSelected(new Set(detail.data.files.map((file) => file.id)));
    initializedFor.current = torrentId;
  }, [detail.data?.files, torrentId]);

  useEffect(() => {
    if (!torrentId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", escape);
    };
  }, [onClose, torrentId]);

  const files = detail.data?.files ?? [];
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files;
  }, [files, search]);
  const selectedBytes = useMemo(() => files.reduce((sum, file) => selected.has(file.id) ? sum + file.size : sum, 0), [files, selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((file) => selected.has(file.id));

  const confirm = useMutation({
    mutationFn: ({ id, fileIds }: { id: string; fileIds: string[] }) => api<{ selectedFiles: number; selectedBytes: number }>(`/api/torrents/${id}/selection`, {
      method: "POST",
      body: JSON.stringify({ fileIds }),
    }),
    onSuccess: (result) => {
      initializedFor.current = null;
      qc.invalidateQueries({ queryKey: ["torrents"] });
      qc.invalidateQueries({ queryKey: ["files"] });
      qc.invalidateQueries({ queryKey: ["storage"] });
      pushToast({ type: "success", title: "Download started", body: `${result.selectedFiles} file${result.selectedFiles === 1 ? "" : "s"} · ${formatBytes(result.selectedBytes)}` });
    },
    onError: (error: Error, variables) => {
      pushToast({ type: "error", title: "Could not start download", body: error.message.slice(0, 160) });
      // The picker was closed optimistically on submit; reopen it so the choice
      // is not silently lost and the user can retry.
      requestTorrentFileSelection(variables.id);
    },
  });

  function submitSelection() {
    if (!torrentId || !selected.size || confirm.isPending) return;
    confirm.mutate({ id: torrentId, fileIds: [...selected] });
    onClose();
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visible.forEach((file) => next.delete(file.id));
      else visible.forEach((file) => next.add(file.id));
      return next;
    });
  }

  return createPortal(
    <AnimatePresence>
      {torrentId && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="scrim z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" onClick={onClose}>
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="torrent-picker-title"
            initial={{ opacity: 0, y: 18, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.99 }}
            onClick={(event) => event.stopPropagation()}
            className="panel flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-b-none sm:rounded-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-accent2">Choose your download</p>
                <h2 id="torrent-picker-title" className="mt-1 truncate text-xl font-bold text-white">{detail.data?.name ?? "Fetching torrent files…"}</h2>
                <p className="mt-1 text-sm text-slate-400">Only selected files will use storage and download bandwidth.</p>
              </div>
              <button type="button" onClick={onClose} className="icon-btn shrink-0" aria-label="Close file selector"><X className="h-5 w-5" /></button>
            </header>

            {!files.length ? (
              <div className="grid min-h-64 place-items-center px-6 text-center">
                <div>
                  <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-accent2" />
                  <p className="mt-4 font-semibold text-white">Reading torrent metadata</p>
                  <p className="mt-1 text-sm text-slate-400">The file list will appear as soon as a peer or tracker provides it.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                  <label className="relative min-w-0 flex-1">
                    <span className="sr-only">Search torrent files</span>
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files…" className="field min-h-11 pl-10" />
                  </label>
                  <button type="button" onClick={toggleVisible} className="btn-ghost min-h-11 justify-center px-4">
                    <span className={`grid h-5 w-5 place-items-center rounded border ${allVisibleSelected ? "border-accent bg-accent text-white" : "border-slate-500"}`}>{allVisibleSelected ? <Check className="h-3.5 w-3.5" /> : null}</span>
                    {allVisibleSelected ? "Clear shown" : "Select shown"}
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-4">
                  {visible.map((file) => {
                    const Icon = file.media_kind === "video" ? Film : file.media_kind === "audio" ? Music : File;
                    const checked = selected.has(file.id);
                    return (
                      <label key={file.id} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${checked ? "bg-accent/10" : "hover:bg-white/5"}`}>
                        <input type="checkbox" checked={checked} onChange={() => setSelected((current) => { const next = new Set(current); checked ? next.delete(file.id) : next.add(file.id); return next; })} className="h-5 w-5 shrink-0 accent-indigo-500" />
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${checked ? "bg-accent/15 text-accent2" : "bg-white/5 text-slate-400"}`}><Icon className="h-4.5 w-4.5" /></span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200" title={file.path}>{file.path}</span>
                        <span className="shrink-0 text-xs font-medium text-slate-400">{formatBytes(file.size)}</span>
                      </label>
                    );
                  })}
                  {!visible.length && <p className="px-4 py-12 text-center text-sm text-slate-400">No files match that search.</p>}
                </div>
                <footer className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6" style={{ backgroundColor: "var(--app-panel)" }}>
                  <p className="text-sm text-slate-300"><strong className="text-white">{selected.size}</strong> of {files.length} selected <span className="text-slate-500">·</span> <strong className="text-white">{formatBytes(selectedBytes)}</strong></p>
                  <div className="flex gap-2">
                    <button type="button" onClick={onClose} className="btn-ghost min-h-11 flex-1 justify-center px-4 sm:flex-none">Choose later</button>
                    <button type="button" onClick={submitSelection} disabled={!selected.size || confirm.isPending} className="btn-primary min-h-11 flex-1 justify-center px-5 sm:flex-none">
                      {confirm.isPending ? "Starting…" : "Download selected"}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
