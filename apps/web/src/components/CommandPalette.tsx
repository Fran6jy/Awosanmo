import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, File, Film, Gauge, Search, Server } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

type Result = { id: string; type: string; title: string; subtitle: string; href: string };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => api<Result[]>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: open,
    staleTime: 5000
  });
  const rows = useMemo(() => results.data ?? [], [results.data]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 20);
    setActive(0);
  }, [open]);

  function choose(row: Result) {
    navigate(row.href);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white/[0.04] px-4 text-sm font-semibold text-slate-300 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-stream">
        <Search className="h-4 w-4" /> Search <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-xs text-slate-400">Ctrl K</span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/60 px-4 pt-24" onMouseDown={() => setOpen(false)}>
          <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl glass" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-5 w-5 text-stream" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, rows.length - 1)); }
                  if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
                  if (event.key === "Enter" && rows[active]) choose(rows[active]);
                }}
                placeholder="Search torrents, files, videos, or actions"
                className="h-14 flex-1 bg-transparent text-white outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="max-h-[60vh] overflow-auto p-2">
              {rows.map((row, index) => (
                <button key={`${row.type}-${row.id}`} onClick={() => choose(row)} onMouseEnter={() => setActive(index)} className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition ${index === active ? "bg-white/10" : "hover:bg-white/5"}`}>
                  <ResultIcon type={row.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-white">{row.title}</span>
                    <span className="block truncate text-sm text-slate-400">{row.subtitle}</span>
                  </span>
                </button>
              ))}
              {!rows.length ? <div className="p-8 text-center text-slate-400">{query ? "No matches yet." : "Start typing to search."}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ResultIcon({ type }: { type: string }) {
  if (type === "torrent") return <Gauge className="h-5 w-5 text-stream" />;
  if (type === "video") return <Film className="h-5 w-5 text-stream" />;
  if (type === "action") return <Activity className="h-5 w-5 text-violet-300" />;
  if (type === "system") return <Server className="h-5 w-5 text-violet-300" />;
  return <File className="h-5 w-5 text-slate-400" />;
}
