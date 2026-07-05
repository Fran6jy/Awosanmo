import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { api, token } from "../lib/api";
import { pushToast } from "./Toast";

type Setup = { secret: string; otpauthUrl: string; qrDataUrl: string };

export function TwoFactorSettings() {
  const authed = !!token();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const status = useQuery({
    queryKey: ["2fa-status"],
    queryFn: () => api<{ enabled: boolean }>("/api/2fa/status"),
    enabled: authed,
  });

  const begin = useMutation({
    mutationFn: () => api<Setup>("/api/2fa/setup", { method: "POST" }),
    onSuccess: (data) => setSetup(data),
    onError: (e: Error) => pushToast({ type: "error", title: "Could not start setup", body: e.message.slice(0, 120) }),
  });
  const enable = useMutation({
    mutationFn: () => api("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code }) }),
    onSuccess: () => { setSetup(null); setCode(""); qc.invalidateQueries({ queryKey: ["2fa-status"] }); pushToast({ type: "success", title: "Two-factor enabled" }); },
    onError: () => pushToast({ type: "error", title: "Invalid code", body: "Check your authenticator and try again." }),
  });
  const disable = useMutation({
    mutationFn: () => api("/api/2fa/disable", { method: "POST", body: JSON.stringify({ code: disableCode }) }),
    onSuccess: () => { setDisableCode(""); qc.invalidateQueries({ queryKey: ["2fa-status"] }); pushToast({ type: "info", title: "Two-factor disabled" }); },
    onError: () => pushToast({ type: "error", title: "Invalid code" }),
  });

  const enabled = status.data?.enabled;

  return (
    <section className="rounded-2xl p-5 glass">
      <div className="flex items-center gap-2">
        {enabled ? <ShieldCheck className="h-5 w-5 text-stream" /> : <ShieldOff className="h-5 w-5 text-slate-400" />}
        <h2 className="text-xl font-bold text-white">Two-factor authentication</h2>
        <span className={`ml-auto rounded-full px-3 py-1 text-xs font-bold ${enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-slate-400"}`}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-400">Protect sign-in with a time-based code from Google Authenticator, Authy, or similar.</p>

      {/* Enabled → allow disabling */}
      {enabled ? (
        <form onSubmit={(e) => { e.preventDefault(); disable.mutate(); }} className="mt-4 flex flex-wrap items-center gap-2">
          <input inputMode="numeric" maxLength={6} value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))} placeholder="Current code" className="h-11 w-40 rounded-xl border border-line bg-white/[0.04] px-3 text-center tracking-widest text-white outline-none focus:ring-2 focus:ring-stream" />
          <button disabled={disable.isPending || disableCode.length !== 6} className="h-11 rounded-xl border border-rose-500/40 px-4 font-semibold text-rose-300 transition hover:bg-rose-50 disabled:opacity-50">Disable 2FA</button>
        </form>
      ) : setup ? (
        <div className="mt-4">
          <p className="text-sm text-slate-300">1. Scan this QR in your authenticator app:</p>
          <img src={setup.qrDataUrl} alt="2FA QR code" className="mt-3 h-44 w-44 rounded-xl border border-line bg-white/[0.04] p-2" />
          <p className="mt-2 text-xs text-slate-400">Or enter this key manually: <code className="rounded bg-white/10 px-1 font-mono text-slate-200">{setup.secret}</code></p>
          <form onSubmit={(e) => { e.preventDefault(); enable.mutate(); }} className="mt-4 flex flex-wrap items-center gap-2">
            <p className="w-full text-sm text-slate-300">2. Enter the 6-digit code to confirm:</p>
            <input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" className="h-11 w-40 rounded-xl border border-line bg-white/[0.04] px-3 text-center tracking-widest text-white outline-none focus:ring-2 focus:ring-stream" />
            <button disabled={enable.isPending || code.length !== 6} className="h-11 rounded-xl bg-accent px-4 font-bold text-white transition hover:bg-accent2 disabled:opacity-50">Confirm & enable</button>
            <button type="button" onClick={() => { setSetup(null); setCode(""); }} className="h-11 rounded-xl border border-line px-4 text-slate-300 transition hover:bg-white/10">Cancel</button>
          </form>
        </div>
      ) : (
        <button onClick={() => begin.mutate()} disabled={begin.isPending} className="mt-4 h-11 rounded-xl bg-accent px-5 font-bold text-white transition hover:bg-accent2 disabled:opacity-50">
          {begin.isPending ? "Preparing…" : "Enable 2FA"}
        </button>
      )}
    </section>
  );
}
