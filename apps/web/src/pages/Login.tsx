import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setTokens } from "../lib/api";

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@awosanmo.local");
  const [password, setPassword] = useState("change-me-now");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const session = await api<{ token: string; refreshToken: string }>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setTokens(session);
      nav("/");
    } catch {
      setError("Invalid credentials");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl p-6 glass">
        <p className="font-mono text-xs font-bold uppercase text-stream">Awosanmo</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">Sign in</h1>
        <label className="mt-6 block text-sm font-semibold" htmlFor="email">Email</label>
        <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-line bg-white px-4 text-slate-950 outline-none focus:ring-2 focus:ring-stream" />
        <label className="mt-4 block text-sm font-semibold" htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-line bg-white px-4 text-slate-950 outline-none focus:ring-2 focus:ring-stream" />
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        <button className="mt-6 h-12 w-full rounded-xl bg-slate-950 font-bold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-stream">Continue</button>
      </form>
    </main>
  );
}
