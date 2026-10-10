import { useState } from "react";
import { createPortal } from "react-dom";
import { Files, HardDrive, LayoutGrid, LogOut, Server, Upload, X } from "lucide-react";
import { Logo } from "./Logo";
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
import { requestTorrentFileSelection, TorrentFilePickerHost } from "./TorrentFilePicker";

type StorageStats = { used: number; available: number; total: number; user?: { used: number; quota: number; available: number; unlimited: boolean } };
type AddTorrentResponse = { id: string; reused?: boolean; selectionRequired?: boolean };

function AddMagnet() {
  const [open, setOpen] = useState(false);
  const [magnet, setMagnet] = useState("");
  const qc = useQueryClient();
  const nav = useNavigate();
  const add = useMutation({
    mutationFn: () => api<AddTorrentResponse>("/api/torrents", { method: "POST", body: JSON.stringify({ magnetUri: magnet.trim() }) }),
    onSuccess: (result) => {
      setMagnet("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["torrents"] });
      pushToast({
        type: "success",
        title: result.reused ? "Torrent found" : "Magnet accepted",
        body: result.selectionRequired ? "Choose which files you want to download." : "Using the existing torrent entry."
      });
      if (result.selectionRequired) requestTorrentFileSelection(result.id);
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
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-white shadow-sm transition hover:bg-accent2 focus:outline-none focus:ring-2 focus:ring-stream sm:px-5"
      >
        <Upload className="h-5 w-5" /> <span className="hidden sm:inline">Add magnet</span>
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
  const quota = storage.data?.user;
  const used = quota?.used ?? storage.data?.used ?? 0;
  const total = quota && !quota.unlimited ? quota.quota : storage.data?.total ?? 0;
  const available = quota && !quota.unlimited ? quota.available : storage.data?.available ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return (
    <div className="order-last w-full min-w-0 rounded-xl border border-line bg-white/5 px-3 py-2 sm:order-none sm:w-52 md:w-64">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-300">
        <span className="inline-flex items-center gap-2 font-medium"><HardDrive className="h-4 w-4 text-accent2" /> Storage</span>
        <span className="shrink-0 font-mono text-slate-400">{formatBytes(used)} / {quota?.unlimited ? "unlimited" : formatBytes(total)}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-400/25">
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-violet transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 truncate text-xs text-slate-400">{storage.isLoading ? "Checking disk..." : quota?.unlimited ? `${formatBytes(storage.data?.available ?? 0)} disk free` : `${formatBytes(available)} quota free`}</p>
    </div>
  );
}

const NAV: { icon: typeof Files; href: string; label: string }[] = [
  { icon: LayoutGrid, href: "/", label: "Dashboard" },
  { icon: Files, href: "/files", label: "Files" },
  { icon: Server, href: "/system", label: "System" },
];

function AppHeader() {
  const { pathname } = useLocation();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link to="/" className="brand-lockup" aria-label="Awosanmo home">
          <Logo className="h-9 w-9" rounded="rounded-[10px]" />
          <span>Awosanmo</span>
        </Link>
        <nav className="primary-nav" aria-label="Primary navigation">
          {NAV.map(({ href, label }) => (
            <Link key={href} to={href} className={isActive(href) ? "is-active" : ""}>{label}</Link>
          ))}
        </nav>
        <div className="header-actions">
          <StorageQuota />
          <CommandPalette />
          <Wishlist />
          <ThemeToggle />
          <AddMagnet />
          <button onClick={() => logout()} className="icon-btn" aria-label="Log out" title="Log out"><LogOut className="h-5 w-5" /></button>
        </div>
      </div>
    </header>
  );
}

function MobileNav() {
  const { pathname } = useLocation();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-white/10 bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      {NAV.map(({ icon: Icon, href, label }) => {
        const active = isActive(href);
        return (
          <Link key={href} to={href} className={`flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${active ? "text-accent2" : "text-slate-400"}`}>
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
      <button onClick={() => logout()} className="flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-400 transition active:text-rose-400" aria-label="Log out">
        <LogOut className="h-5 w-5" />
        Log out
      </button>
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="awosanmo-app min-h-screen overflow-x-hidden">
      <AppHeader />
      <MobileNav />
      <TorrentFilePickerHost />
      <main className="app-content min-w-0 px-4 pb-24 pt-8 sm:px-6 lg:mx-auto lg:max-w-[1480px] lg:px-10 lg:pb-16 lg:pt-12">
        {children}
      </main>
    </div>
  );
}
