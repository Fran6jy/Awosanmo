import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setTokens } from "../lib/api";

type Session = { token: string; refreshToken: string };
type LoginResult = Session | { twoFactorRequired: true; ticket: string };

export function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 2FA step
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const path = mode === "login" ? "/api/login" : "/api/register";
      const result = await api<LoginResult>(path, { method: "POST", body: JSON.stringify({ email, password }) });
      if ("twoFactorRequired" in result) {
        setTicket(result.ticket);
      } else {
        setTokens(result);
        nav("/");
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(
        mode === "register"
          ? (/exists/i.test(msg) ? "An account with that email already exists." : "Could not create account. Use a valid email and 8+ char password.")
          : "Invalid email or password.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const session = await api<Session>("/api/login/2fa", { method: "POST", body: JSON.stringify({ ticket, code }) });
      setTokens(session);
      nav("/");
    } catch {
      setError("Invalid or expired code.");
    } finally {
      setBusy(false);
    }
  }

  if (ticket) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <form onSubmit={submitCode} className="w-full max-w-md rounded-2xl p-6 glass">
          <p className="font-mono text-xs font-bold uppercase text-stream">Awosanmo</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">Two-factor code</h1>
          <p className="mt-1 text-sm text-slate-500">Enter the 6-digit code from your authenticator app.</p>
          <input
            autoFocus inputMode="numeric" maxLength={6} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="mt-4 h-14 w-full rounded-xl border border-line bg-white text-center text-2xl tracking-[0.5em] text-slate-950 outline-none focus:ring-2 focus:ring-stream"
            placeholder="000000"
          />
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <button disabled={busy || code.length !== 6} className="mt-6 h-12 w-full rounded-xl bg-slate-950 font-bold text-white transition hover:bg-slate-800 disabled:opacity-60">
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button type="button" onClick={() => { setTicket(null); setCode(""); setError(""); }} className="mt-4 w-full text-center text-sm text-slate-500 transition hover:text-slate-900">Back</button>
        </form>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl p-6 glass">
        <p className="font-mono text-xs font-bold uppercase text-stream">Awosanmo</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">{mode === "login" ? "Sign in" : "Create account"}</h1>
        <p className="mt-1 text-sm text-slate-500">{mode === "login" ? "Access your private cloud." : "Your files stay private to your account."}</p>
        <label className="mt-6 block text-sm font-semibold" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-line bg-white px-4 text-slate-950 outline-none focus:ring-2 focus:ring-stream" />
        <label className="mt-4 block text-sm font-semibold" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-line bg-white px-4 text-slate-950 outline-none focus:ring-2 focus:ring-stream" />
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <button disabled={busy} className="mt-6 h-12 w-full rounded-xl bg-slate-950 font-bold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-stream disabled:opacity-60">
          {busy ? "Please wait…" : mode === "login" ? "Continue" : "Create account"}
        </button>
        <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="mt-4 w-full text-center text-sm text-slate-500 transition hover:text-slate-900">
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}
