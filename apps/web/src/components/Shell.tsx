import { useState } from "react";
import { Activity, Cloud, Files, Gauge, HardDrive, LogOut, Search, Settings, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CommandPalette } from "./CommandPalette";
import { Wishlist } from "./Wishlist";
import { api, logout, token } from "../lib/api";
import { readClipboardMagnet } from "../lib/clipboard";
import { formatBytes } from "../lib/format";
import { pushToast } from "./Toast";

type StorageStats = { used: number; available: number; total: number };

function AddMagnet() {
  const [open, setOpen] = useState(false);
  const [magnet, setMagnet] = useState("");
  const qc = useQueryClient();
  const nav = useNavigate();
  const add = useMutation({
    mutationFn: () => api("/api/torrents", { method: "POST", body: JSON.stringify({ magnetUri: magnet.trim() }) }),
    onSuccess: () => {
      setMagnet("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["torrents"] });
      pushToast({ type: "success", title: "Added to swarm", body: "Fetching metadata…" });
      nav("/");
    },
    onError: (e: Error) => pushToast({ type: "error", title: "Could not add magnet", body: e.message.slice(0, 140) }),
  });
  const saveForLater = useMutation({
    mutationFn: () => api("/api/wishlist", { method: "POST", body: JSON.stringify({ magnetUri: magnet.trim() }) }),
    onSuccess: () => { setMagnet(""); setOpen(false); qc.invalidateQueries({ queryKey: ["wishlist"] }); pushToast({ type: "success", title: "Saved to wishlist" }); },
    onError: (e: Error) => pushToast({ type: "error", title: "Could not save", body: e.message.slice(0, 140) }),
  });
  async function autoPasteMagnet() {
    if (magnet.trim().startsWith("magnet:")) return;
    const next = await readClipboardMagnet();
    if (next) setMagnet(next);
  }

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-stream"
      >
        <Upload className="h-5 w-5" /> Add magnet
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4"
            onClick={() => setOpen(false)}
          >
            <motion.form
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => { e.preventDefault(); add.mutate(); }}
              className="w-full max-w-lg rounded-2xl p-6 glass"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Add a magnet link</h2>
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-500">Paste a magnet URI and Awosanmo joins the swarm on your server.</p>
              <input
                autoFocus
                value={magnet}
                onChange={(e) => setMagnet(e.target.value)}
                onFocus={autoPasteMagnet}
                onClick={autoPasteMagnet}
                placeholder="magnet:?xt=urn:btih:…"
                className="mt-4 min-h-12 w-full rounded-xl border border-line bg-white px-4 text-slate-950 outline-none focus:ring-2 focus:ring-stream"
              />
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-line px-4 text-slate-700 transition hover:bg-slate-100">Cancel</button>
                <button type="button" onClick={() => saveForLater.mutate()} disabled={saveForLater.isPending || !magnet.trim().startsWith("magnet:")} className="min-h-11 rounded-xl border border-line px-4 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
                  Save for later
                </button>
                <button disabled={add.isPending || !magnet.trim().startsWith("magnet:")} className="min-h-11 rounded-xl bg-slate-950 px-5 font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {add.isPending ? "Adding…" : "Join swarm"}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function StorageQuota() {
  const authed = !!token();
  const storage = useQuery({
    queryKey: ["storage"],
    queryFn: () => api<StorageStats>("/api/storage"),
    refetchInterval: 8000,
    enabled: authed
  });
  const used = storage.data?.used ?? 0;
  const total = storage.data?.total ?? 0;
  const available = storage.data?.available ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return (
    <div className="min-w-0 rounded-xl border border-line bg-slate-50 px-3 py-2 md:w-64">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-2 font-medium"><HardDrive className="h-4 w-4 text-stream" /> Storage</span>
        <span className="shrink-0 font-mono text-slate-500">{formatBytes(used)} / {formatBytes(total)}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-stream transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 truncate text-xs text-slate-500">{storage.isLoading ? "Checking disk..." : `${formatBytes(available)} free`}</p>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <aside className="fixed inset-y-4 left-4 z-20 hidden w-20 rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex lg:flex-col lg:items-center lg:gap-5 lg:py-5">
        <Link to="/" aria-label="Awosanmo dashboard" className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950"><Cloud className="h-7 w-7 text-white" /></Link>
        {[
          [Gauge, "/"],
          [Files, "/files"],
          [Search, "/files"],
          [Activity, "/system"],
          [HardDrive, "/system"],
          [Settings, "/system"]
        ].map(([Icon, href], index) => (
          <Link to={href as string} key={index} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-stream" aria-label={(Icon as any).name}>
            <Icon className="h-5 w-5" />
          </Link>
        ))}
        <button onClick={() => logout()} className="mt-auto grid h-11 w-11 place-items-center rounded-xl text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-300" aria-label="Log out" title="Log out">
          <LogOut className="h-5 w-5" />
        </button>
      </aside>
      <main className="min-w-0 px-4 py-4 lg:ml-28 lg:max-w-[calc(100vw-8rem)] lg:pr-6">
        <header className="mb-5 flex flex-col gap-4 rounded-2xl p-4 glass md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold uppercase text-stream">Awosanmo Private Cloud</p>
            <h1 className="max-w-2xl text-2xl font-extrabold tracking-tight md:text-3xl">Files, torrents, and streaming in one workspace.</h1>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StorageQuota />
            <CommandPalette />
            <Wishlist />
            <AddMagnet />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
