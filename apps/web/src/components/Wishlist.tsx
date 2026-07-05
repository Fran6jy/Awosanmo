import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Download, Star, Trash2, X } from "lucide-react";
import { api, token } from "../lib/api";
import { readClipboardMagnet } from "../lib/clipboard";
import { formatBytes } from "../lib/format";
import { pushToast } from "./Toast";

type WishlistItem = { id: string; name: string; magnet_uri: string; size: number; source: string | null; created_at: string };

export function Wishlist() {
  const authed = !!token();
  const [open, setOpen] = useState(false);
  const [magnet, setMagnet] = useState("");
  const qc = useQueryClient();
  const nav = useNavigate();

  const list = useQuery({
    queryKey: ["wishlist"],
    queryFn: () => api<WishlistItem[]>("/api/wishlist"),
    enabled: authed,
    refetchInterval: 20000,
  });

  const save = useMutation({
    mutationFn: (magnetUri: string) => api<WishlistItem>("/api/wishlist", { method: "POST", body: JSON.stringify({ magnetUri }) }),
    onSuccess: () => { setMagnet(""); qc.invalidateQueries({ queryKey: ["wishlist"] }); pushToast({ type: "success", title: "Saved to wishlist" }); },
    onError: (e: Error) => pushToast({ type: "error", title: "Could not save", body: e.message.slice(0, 120) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/wishlist/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishlist"] }),
  });
  const download = useMutation({
    mutationFn: (id: string) => api(`/api/wishlist/${id}/download`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wishlist"] });
      qc.invalidateQueries({ queryKey: ["torrents"] });
      pushToast({ type: "success", title: "Added to downloads", body: "Fetching metadata…" });
      setOpen(false);
      nav("/");
    },
  });

  async function autoPaste() {
    if (magnet.trim().startsWith("magnet:")) return;
    const next = await readClipboardMagnet();
    if (next) setMagnet(next);
  }

  const items = list.data ?? [];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-stream"
        aria-label="Wishlist"
      >
        <Star className="h-5 w-5" />
        {items.length > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-stream px-1 text-xs font-bold text-slate-950">{items.length}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[90vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/10"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="inline-flex items-center gap-2 font-bold text-slate-900"><Star className="h-4 w-4 text-stream" /> Wishlist</span>
                <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Close"><X className="h-4 w-4" /></button>
              </div>

              <form
                onSubmit={(e) => { e.preventDefault(); if (magnet.trim().startsWith("magnet:")) save.mutate(magnet.trim()); }}
                className="flex gap-2 border-b border-slate-100 p-3"
              >
                <input
                  value={magnet}
                  onChange={(e) => setMagnet(e.target.value)}
                  onFocus={autoPaste}
                  onClick={autoPaste}
                  placeholder="Save a magnet for later…"
                  className="min-h-10 flex-1 rounded-lg border border-line bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-stream"
                />
                <button disabled={save.isPending || !magnet.trim().startsWith("magnet:")} className="min-h-10 shrink-0 rounded-lg bg-slate-950 px-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-40">Save</button>
              </form>

              <div className="max-h-80 overflow-auto">
                {items.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing saved yet. Paste a magnet above to keep it for later.</p>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="border-b border-slate-50 px-4 py-3 last:border-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900" title={item.name}>{item.name}</p>
                        <button onClick={() => remove.mutate(item.id)} className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-rose-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">{[item.size ? formatBytes(item.size) : null, item.source].filter(Boolean).join(" · ") || "Magnet link"}</p>
                      <button
                        onClick={() => download.mutate(item.id)}
                        disabled={download.isPending}
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-stream px-3 py-2 text-sm font-bold text-slate-950 transition hover:brightness-95 disabled:opacity-50"
                      >
                        <Download className="h-4 w-4" /> Add to downloads
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
