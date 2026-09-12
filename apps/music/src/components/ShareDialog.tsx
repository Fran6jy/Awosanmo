import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, Copy, Link2, X } from "lucide-react";
import { api, shareLink, type Share, type ShareKind } from "../lib/api";
import { pushToast } from "./Toast";

/** Copy with a fallback for contexts where the async clipboard is unavailable (plain http, old WebViews). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

const EXPIRY: { label: string; days: number | null }[] = [
  { label: "Never", days: null },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

/**
 * Two-step modal: choose how long the link lives and whether downloads are
 * allowed, then get the link with a copy button. Spotify shares instantly with
 * no options; we ask first because a link that never expires and allows
 * downloads is a bigger decision for a private library.
 */
export function ShareDialog({ kind, id, name, onClose }: { kind: ShareKind; id: string; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [days, setDays] = useState<number | null>(null);
  const [download, setDownload] = useState(true);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => api<Share>("/api/music/shares", { method: "POST", body: JSON.stringify({ kind, id, expiresInDays: days, allowDownload: download }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["music", "shares"] }),
    onError: () => pushToast("Could not create the link"),
  });
  const link = create.data ? shareLink(create.data.id) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    if (!link) return;
    const ok = await copyText(link);
    setCopied(ok);
    pushToast(ok ? "Link copied" : "Copy failed — select the link and copy it");
  }

  const pill = (active: boolean) => `rounded-full px-3 py-1.5 text-sm font-semibold transition ${active ? "bg-cream text-ink" : "bg-raised/70 text-cream hover:bg-raised"}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="share-title"
        className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="share-title" className="text-lg font-bold text-cream">Share {kind}</h2>
            <p className="mt-0.5 truncate text-sm text-muted">{name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-dim hover:text-cream"><X className="h-5 w-5" /></button>
        </div>

        {!link ? (
          <>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-dim">Link expires</p>
            <div className="mt-2 flex gap-2">
              {EXPIRY.map((e) => <button key={e.label} type="button" onClick={() => setDays(e.days)} className={pill(days === e.days)}>{e.label}</button>)}
            </div>
            <label className="mt-5 flex cursor-pointer items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold text-cream">Allow downloads</span>
                <span className="block text-xs text-muted">Visitors can save the original files{kind !== "track" ? ", or everything as a zip" : ""}.</span>
              </span>
              <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} className="h-5 w-5 accent-accent" />
            </label>
            <p className="mt-5 text-xs text-dim">Anyone with the link can listen without an account. You can revoke it any time from Your Library → Shared links.</p>
            <button type="button" onClick={() => create.mutate()} disabled={create.isPending}
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent font-bold text-cream transition hover:bg-accent2 disabled:opacity-60">
              <Link2 className="h-4 w-4" /> {create.isPending ? "Creating…" : "Create link"}
            </button>
          </>
        ) : (
          <>
            <div className="mt-5 flex items-center gap-2 rounded-lg border border-line bg-surface2 p-2">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent px-2 text-sm text-cream outline-none" />
              <button type="button" onClick={copy} className="flex shrink-0 items-center gap-1.5 rounded-full bg-cream px-3 py-1.5 text-xs font-bold text-ink transition hover:scale-105">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-3 text-xs text-dim">
              {days ? `Expires in ${days} days` : "Never expires"} · {download ? "downloads allowed" : "listen only"}
            </p>
            <button type="button" onClick={onClose} className="mt-5 h-11 w-full rounded-full border border-line font-semibold text-cream transition hover:border-cream">Done</button>
          </>
        )}
      </motion.div>
    </div>
  );
}
