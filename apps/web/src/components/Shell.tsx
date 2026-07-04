import { Activity, Cloud, Files, Gauge, HardDrive, Search, Settings, Upload } from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";

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
            <motion.button whileTap={{ scale: .98 }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stream px-5 font-semibold text-ink transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-white">
              <Upload className="h-5 w-5" /> Add magnet
            </motion.button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
