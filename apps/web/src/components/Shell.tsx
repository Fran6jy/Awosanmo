import { useState } from "react";
import { Activity, Cloud, Files, Gauge, HardDrive, Search, Settings, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CommandPalette } from "./CommandPalette";
import { api } from "../lib/api";
import { pushToast } from "./Toast";

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

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stream px-5 font-semibold text-ink transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-white"
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
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-400">Paste a magnet URI and Awosanmo joins the swarm on your server.</p>
              <input
                autoFocus
                value={magnet}
                onChange={(e) => setMagnet(e.target.value)}
                placeholder="magnet:?xt=urn:btih:…"
                className="mt-4 min-h-12 w-full rounded-xl border border-line bg-white/5 px-4 outline-none focus:ring-2 focus:ring-stream"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-line px-4 transition hover:bg-white/10">Cancel</button>
                <button disabled={add.isPending || !magnet.trim().startsWith("magnet:")} className="min-h-11 rounded-xl bg-stream px-5 font-bold text-ink transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50">
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

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-4 left-4 z-20 hidden w-20 rounded-2xl glass lg:flex lg:flex-col lg:items-center lg:gap-5 lg:py-5">
        <Link to="/" aria-label="Awosanmo dashboard"><Cloud className="h-9 w-9 text-stream" /></Link>
        {[
          [Gauge, "/"],
          [Files, "/files"],
          [Search, "/files"],
          [Activity, "/system"],
          [HardDrive, "/system"],
          [Settings, "/system"]
        ].map(([Icon, href], index) => (
          <Link to={href as string} key={index} className="grid h-11 w-11 place-items-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-stream" aria-label={(Icon as any).name}>
            <Icon className="h-5 w-5" />
          </Link>
        ))}
      </aside>
      <main className="mx-auto max-w-7xl px-4 py-4 lg:pl-32">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl p-4 glass md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-mono text-sm text-stream">AWOSANMO PRIVATE CLOUD</p>
            <h1 className="text-2xl font-bold tracking-normal md:text-3xl">Streams, downloads, and storage in one calm control room.</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <CommandPalette />
            <AddMagnet />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
