import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Home, Library, LogOut, Plus, Search } from "lucide-react";
import { api, logout, type Playlist } from "../lib/api";
import { Mark, Wordmark } from "./Logo";
import { ContextMenuHost } from "./ContextMenu";
import { PlayerBar } from "./PlayerBar";
import { Art } from "./Art";
import { pushToast } from "./Toast";

export function Layout({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [q, setQ] = useState(new URLSearchParams(location.search).get("q") ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // The shell is fixed-height and only <main> scrolls (so the iOS keyboard cannot
  // scroll the header away); that means we reset the scroll position ourselves on navigation.
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [location.pathname]);
  const playlists = useQuery({ queryKey: ["music", "playlists"], queryFn: () => api<Playlist[]>("/api/music/playlists") });
  const create = useMutation({
    mutationFn: () => api<Playlist>("/api/music/playlists", { method: "POST", body: JSON.stringify({ name: `My Playlist #${(playlists.data?.length ?? 0) + 1}` }) }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["music", "playlists"] }); pushToast("Playlist created"); nav(`/playlist/${p.id}`); },
  });

  // Search as you type; "/" focuses the box from anywhere.
  useEffect(() => {
    const id = setTimeout(() => {
      const trimmed = q.trim();
      if (trimmed) nav(`/search?q=${encodeURIComponent(trimmed)}`, { replace: location.pathname === "/search" });
      else if (location.pathname === "/search") nav("/search", { replace: true });
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navItem = "flex items-center gap-4 rounded-md px-3 py-2 font-semibold text-muted transition hover:text-cream";
  const active = ({ isActive }: { isActive: boolean }) => `${navItem} ${isActive ? "text-cream" : ""}`;

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-ink text-cream">
      {/* sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col gap-2 p-2 pb-[96px] md:flex">
        <nav className="rounded-lg bg-panel p-3">
          <Link to="/" className="mb-4 flex items-center px-3 pt-1" aria-label="JYMusic home">
            <Wordmark />
          </Link>
          <NavLink to="/" end className={active}><Home className="h-6 w-6" /> Home</NavLink>
          <NavLink to="/search" className={active}><Search className="h-6 w-6" /> Search</NavLink>
          <NavLink to="/library" className={active}><Library className="h-6 w-6" /> Your Library</NavLink>
        </nav>
        <section className="flex min-h-0 flex-1 flex-col rounded-lg bg-panel p-3">
          <div className="flex items-center justify-between px-3">
            <span className="text-sm font-semibold text-muted">Playlists</span>
            <button type="button" onClick={() => create.mutate()} aria-label="Create playlist" className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-raised hover:text-cream"><Plus className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
            <NavLink to="/liked" className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 ${isActive ? "bg-raised/70" : "hover:bg-raised/50"}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-gradient-to-br from-accent to-gold/70"><Heart className="h-4 w-4 fill-current text-cream" /></span>
              <div className="min-w-0"><p className="truncate text-sm font-semibold">Liked Songs</p><p className="text-xs text-muted">Playlist</p></div>
            </NavLink>
            {(playlists.data ?? []).map((p) => (
              <NavLink key={p.id} to={`/playlist/${p.id}`} className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 ${isActive ? "bg-raised/70" : "hover:bg-raised/50"}`}>
                <Art src={p.art} seed={p.id} alt="" className="h-10 w-10 shrink-0" iconSize={0.5} />
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{p.name}</p><p className="text-xs text-muted">Playlist · {p.trackCount} songs</p></div>
              </NavLink>
            ))}
          </div>
          <button type="button" onClick={() => void logout()} className="mt-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-dim hover:text-cream"><LogOut className="h-4 w-4" /> Log out</button>
        </section>
      </aside>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-20 flex shrink-0 items-center gap-3 bg-ink/80 px-4 py-3 backdrop-blur-xl md:px-6" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
          <Link to="/" className="flex items-center md:hidden" aria-label="JYMusic home"><Mark className="h-8 text-accent2" /></Link>
          <label className="relative flex-1 md:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="What do you want to play?" type="search" enterKeyHint="search" autoCorrect="off" autoCapitalize="none"
              onFocus={() => { if (location.pathname !== "/search") nav("/search"); }}
              className="h-11 w-full rounded-full border border-transparent bg-surface2 pl-10 pr-4 text-sm text-cream placeholder:text-dim focus:border-line focus:outline-none focus:ring-2 focus:ring-accent/50" />
          </label>
        </header>
        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-40 md:px-6 md:pb-32" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>{children}</main>
      </div>

      {/* bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-[72px] z-30 grid grid-cols-3 border-t border-line bg-panel/95 backdrop-blur-xl md:hidden" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
        {[["/", Home, "Home"], ["/search", Search, "Search"], ["/library", Library, "Library"]].map(([to, Icon, label]) => (
          <NavLink key={to as string} to={to as string} end={to === "/"} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? "text-cream" : "text-dim"}`}>
            {(() => { const I = Icon as typeof Home; return <I className="h-5 w-5" />; })()}{label as string}
          </NavLink>
        ))}
      </nav>
      <PlayerBar />
      <ContextMenuHost />
    </div>
  );
}
