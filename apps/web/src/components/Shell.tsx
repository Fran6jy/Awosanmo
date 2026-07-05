import { useState } from "react";
import { createPortal } from "react-dom";
import { Cloud, Files, HardDrive, LayoutGrid, LogOut, Server, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CommandPalette } from "./CommandPalette";
import { Wishlist } from "./Wishlist";
import { api, logout, token } from "../lib/api";
import { readClipboardMagnet } from "../lib/clipboard";
import { formatBytes } from "../lib/format";
import { pushToast } from "./Toast";
import { ThemeToggle } from "./ThemeToggle";

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
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-white shadow-sm transition hover:bg-accent2 focus:outline-none focus:ring-2 focus:ring-stream"
      >
        <Upload className="h-5 w-5" /> Add magnet
      </motion.button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="scrim grid place-items-center px-4"
              onClick={() => setOpen(false)}
            >
              <motion.form
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => { e.preventDefault(); add.mutate(); }}
                className="panel w-full max-w-lg p-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold">Add a magnet link</h2>
                  <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Close">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <p className="mt-1 text-sm text-slate-400">Paste a magnet URI and Awosanmo joins the swarm on your server.</p>
                <input
                  autoFocus
                  value={magnet}
                  onChange={(e) => setMagnet(e.target.value)}
                  onFocus={autoPasteMagnet}
                  onClick={autoPasteMagnet}
                  placeholder="magnet:?xt=urn:btih:…"
                  className="mt-4 min-h-12 w-full rounded-xl border border-line bg-white/[0.04] px-4 text-white outline-none focus:ring-2 focus:ring-stream"
                />
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-line px-4 text-slate-200 transition hover:bg-white/10">Cancel</button>
                  <button type="button" onClick={() => saveForLater.mutate()} disabled={saveForLater.isPending || !magnet.trim().startsWith("magnet:")} className="min-h-11 rounded-xl border border-line px-4 font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
                    Save for later
                  </button>
                  <button disabled={add.isPending || !magnet.trim().startsWith("magnet:")} className="min-h-11 rounded-xl bg-accent px-5 font-bold text-white transition hover:bg-accent2 disabled:cursor-not-allowed disabled:opacity-50">
                    {add.isPending ? "Adding…" : "Join swarm"}
                  </button>
                </div>
              </motion.form>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
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
    <div className="min-w-0 rounded-xl border border-line bg-white/5 px-3 py-2 md:w-64">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-300">
        <span className="inline-flex items-center gap-2 font-medium"><HardDrive className="h-4 w-4 text-stream" /> Storage</span>
        <span className="shrink-0 font-mono text-slate-400">{formatBytes(used)} / {formatBytes(total)}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-stream transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 truncate text-xs text-slate-400">{storage.isLoading ? "Checking disk..." : `${formatBytes(available)} free`}</p>
    </div>
  );
}

const NAV: { icon: typeof Files; href: string; label: string }[] = [
  { icon: LayoutGrid, href: "/", label: "Dashboard" },
  { icon: Files, href: "/files", label: "Files" },
  { icon: Server, href: "/system", label: "System" },
];

function Sidebar() {
  const { pathname } = useLocation();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <aside className="fixed inset-y-4 left-4 z-20 hidden w-[68px] flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] py-4 backdrop-blur-xl lg:flex">
      <Link to="/" aria-label="Awosanmo dashboard" className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-accent to-violet shadow-glow">
        <Cloud className="h-6 w-6 text-white" />
      </Link>
      <nav className="flex flex-1 flex-col items-center gap-1.5">
        {NAV.map(({ icon: Icon, href, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href} to={href} aria-label={label} title={label}
              className={`group relative grid h-11 w-11 place-items-center rounded-xl transition duration-200 focus:outline-none focus:ring-2 focus:ring-accent/40 ${active ? "bg-accent/15 text-accent2" : "text-slate-400 hover:bg-white/10 hover:text-white"}`}
            >
              {active && <span className="absolute -left-4 h-6 w-1 rounded-r-full bg-accent2" />}
              <Icon className="h-5 w-5" />
            </Link>
          );
        })}
      </nav>
      <button onClick={() => logout()} className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 transition duration-200 hover:bg-rose-500/10 hover:text-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40" aria-label="Log out" title="Log out">
        <LogOut className="h-5 w-5" />
      </button>
    </aside>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <Sidebar />
      <main className="min-w-0 px-4 py-4 lg:ml-28 lg:max-w-[calc(100vw-8rem)] lg:pr-6">
        <header className="glass mb-5 flex flex-col gap-4 rounded-2xl p-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-accent2">Awosanmo Private Cloud</p>
            <h1 className="mt-0.5 max-w-2xl text-2xl font-extrabold tracking-tight text-white md:text-[28px]">Your private cloud workspace</h1>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StorageQuota />
            <CommandPalette />
            <Wishlist />
            <ThemeToggle />
            <AddMagnet />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
