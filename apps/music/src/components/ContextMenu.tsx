import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import { ShareDialog } from "./ShareDialog";
import type { ShareKind } from "../lib/api";

/**
 * One context menu for the whole app. Anything can open it — a right-click,
 * a press-and-hold on touch, or a "…" button — with a list of items. On a
 * mouse it is a popover at the pointer; on touch it is a bottom sheet.
 */
export type MenuItem =
  | { kind?: "item"; label: string; icon?: React.ReactNode; onSelect?: () => void; to?: string; danger?: boolean }
  | { kind: "divider" }
  | { kind: "header"; label: string }
  | { kind: "note"; label: string };

export type MenuHead = { title: string; subtitle?: string; art?: React.ReactNode };
export type MenuAnchor = { x: number; y: number; sheet?: boolean };
type MenuState = { x: number; y: number; sheet: boolean; head?: MenuHead; items: MenuItem[]; openedAt: number } | null;
type ShareReq = { kind: ShareKind; id: string; name: string } | null;

let menu: MenuState = null;
let share: ShareReq = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const coarse = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export function openMenu(at: MenuAnchor, items: MenuItem[], head?: MenuHead) {
  menu = { x: at.x, y: at.y, sheet: at.sheet ?? coarse(), items, head, openedAt: Date.now() };
  emit();
}
export function closeMenu() { if (menu) { menu = null; emit(); } }
export function openShare(req: NonNullable<ShareReq>) { share = req; emit(); }

/** Anchor a menu to a button: below it, right-aligned to its edge. */
export function anchorTo(el: Element): MenuAnchor {
  const r = el.getBoundingClientRect();
  return { x: r.right, y: r.bottom + 4 };
}

// ---------- press-and-hold / right-click trigger ----------
// Only one finger can be holding at a time, so the pending press lives at
// module level; the handlers themselves are stateless and survive re-renders.
let pending: { timer: number; x: number; y: number } | null = null;
let suppressClicksUntil = 0;
const HOLD_MS = 420;
const SLOP = 10;

function cancelPress() { if (pending) { clearTimeout(pending.timer); pending = null; } }

/** Spread onto any element: right-click (mouse) or press-and-hold (touch) calls `open`. */
export function pressProps(open: ((at: MenuAnchor) => void) | undefined) {
  if (!open) return {};
  return {
    style: { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" } as React.CSSProperties,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      // Android fires contextmenu after a long press; the touch timer may have opened the menu already.
      if (menu && Date.now() - menu.openedAt < 1000) return;
      open({ x: e.clientX, y: e.clientY, sheet: coarse() });
    },
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return cancelPress();
      const t = e.touches[0];
      cancelPress();
      pending = { x: t.clientX, y: t.clientY, timer: window.setTimeout(() => {
        pending = null;
        suppressClicksUntil = Date.now() + 800;
        if (navigator.vibrate) navigator.vibrate(8);
        open({ x: t.clientX, y: t.clientY, sheet: true });
      }, HOLD_MS) };
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!pending) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - pending.x) > SLOP || Math.abs(t.clientY - pending.y) > SLOP) cancelPress();
    },
    onTouchEnd: cancelPress,
    onTouchCancel: cancelPress,
  };
}

// ---------- host ----------
export function ContextMenuHost() {
  const state = useSyncExternalStore(subscribe, () => menu, () => null);
  const shareReq = useSyncExternalStore(subscribe, () => share, () => null);
  const loc = useLocation();

  // A page change, Escape, or scrolling underneath a popover all dismiss it.
  useEffect(() => { closeMenu(); }, [loc.pathname]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    // The click that ends a long press (and the click a link would fire) must not go through.
    const click = (e: MouseEvent) => { if (Date.now() < suppressClicksUntil) { e.preventDefault(); e.stopPropagation(); } };
    document.addEventListener("keydown", key);
    document.addEventListener("click", click, true);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("click", click, true); };
  }, []);
  useEffect(() => {
    if (!state || state.sheet) return;
    const onScroll = () => closeMenu();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [state]);

  return (
    <>
      {state && (state.sheet ? <Sheet state={state} /> : <Popover state={state} />)}
      {shareReq && <ShareDialog kind={shareReq.kind} id={shareReq.id} name={shareReq.name} onClose={() => { share = null; emit(); }} />}
    </>
  );
}

function Items({ items, big }: { items: MenuItem[]; big: boolean }) {
  const row = big ? "px-4 py-3 text-base" : "px-3 py-2 text-sm";
  return (
    <>
      {items.map((it, i) => {
        if (it.kind === "divider") return <div key={i} className="my-1 border-t border-line" />;
        if (it.kind === "header") return <p key={i} className={`${big ? "px-4" : "px-3"} pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-dim`}>{it.label}</p>;
        if (it.kind === "note") return <p key={i} className={`${big ? "px-4" : "px-3"} py-2 text-xs text-dim`}>{it.label}</p>;
        const cls = `flex w-full items-center gap-3 rounded-md text-left ${row} hover:bg-surface2 active:bg-surface2 ${it.danger ? "text-accent2" : "text-cream"}`;
        const icon = it.icon ? <span className={`shrink-0 ${it.danger ? "" : "text-dim"} [&>svg]:h-4 [&>svg]:w-4`}>{it.icon}</span> : null;
        if (it.to) return <Link key={i} to={it.to} onClick={closeMenu} className={cls}>{icon}<span className="min-w-0 flex-1 truncate">{it.label}</span></Link>;
        return <button key={i} type="button" onClick={() => { closeMenu(); it.onSelect?.(); }} className={cls}>{icon}<span className="min-w-0 flex-1 truncate">{it.label}</span></button>;
      })}
    </>
  );
}

function Popover({ state }: { state: NonNullable<MenuState> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, pad = 8;
    let left = state.x, top = state.y;
    if (left + w > innerWidth - pad) left = Math.max(pad, state.x - w);
    if (top + h > innerHeight - pad) top = Math.max(pad, innerHeight - pad - h);
    setPos({ left, top });
  }, [state]);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
      <div ref={ref} role="menu" className="fixed z-50 max-h-[80vh] w-60 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-card" style={pos}>
        <Items items={state.items} big={false} />
      </div>
    </>
  );
}

function Sheet({ state }: { state: NonNullable<MenuState> }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" onClick={closeMenu} />
      <div role="menu" className="sheet-in fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-line bg-panel shadow-card"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />
        {state.head && (
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            {state.head.art}
            <div className="min-w-0">
              <p className="truncate font-semibold text-cream">{state.head.title}</p>
              {state.head.subtitle && <p className="truncate text-sm text-muted">{state.head.subtitle}</p>}
            </div>
          </div>
        )}
        <div className="p-2"><Items items={state.items} big /></div>
      </div>
    </>
  );
}
