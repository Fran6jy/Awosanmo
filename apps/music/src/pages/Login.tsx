import { Wordmark } from "../components/Logo";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setTokens } from "../lib/api";
import { startSession } from "../lib/session";
import { loadAccountSettings } from "../lib/settings";

type Session = { token: string };
type LoginResult = Session | { twoFactorRequired: true; ticket: string };

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const r = ticket
        ? await api<Session>("/api/login/2fa", { method: "POST", body: JSON.stringify({ ticket, code }) })
        : await api<LoginResult>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if ("twoFactorRequired" in r) setTicket(r.ticket);
      else { setTokens(r); void startSession(); void loadAccountSettings(); nav("/"); }
    } catch { setError(ticket ? "Invalid or expired code." : "Invalid email or password."); }
    finally { setBusy(false); }
  }

  const field = "mt-2 h-12 w-full rounded-md border border-line bg-surface2 px-4 text-cream outline-none focus:ring-2 focus:ring-accent";
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-surface2 to-ink px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-panel p-8 shadow-card">
        <Wordmark size="lg" live />
        <h1 className="mt-6 text-2xl font-bold">{ticket ? "Two-factor code" : "Log in to JYMusic"}</h1>
        {ticket ? (
          <input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" className={`${field} mt-5 text-center text-2xl tracking-[0.5em]`} />
        ) : (
          <>
            <label className="mt-5 block text-sm font-semibold">Email</label>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            <label className="mt-4 block text-sm font-semibold">Password</label>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          </>
        )}
        {error && <p className="mt-3 text-sm text-accent2">{error}</p>}
        <button disabled={busy || (ticket ? code.length !== 6 : !email || !password)} className="mt-6 h-12 w-full rounded-full bg-accent font-bold text-cream transition hover:bg-accent2 disabled:opacity-50">{busy ? "Please wait…" : ticket ? "Verify" : "Log in"}</button>
      </form>
    </main>
  );
}
