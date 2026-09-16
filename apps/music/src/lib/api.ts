// Same-origin in production; the Vite dev server talks to the local API.
export const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

let accessToken: string | null = null;
export function token() { return accessToken; }
/** The role baked into the access token; "admin" may delete songs from the library. */
export function sessionRole(): string | null {
  try { return accessToken ? JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? null : null; } catch { return null; }
}
export function setTokens(t: { token: string }) { accessToken = t.token; }

function forceLogin() {
  accessToken = null;
  if (!location.pathname.startsWith("/login")) location.assign("/login");
}

let refreshInFlight: Promise<boolean> | null = null;
async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/api/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" })
      .then(async (r) => { if (!r.ok) return false; setTokens(await r.json()); return true; })
      .catch(() => false)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export function restoreSession(): Promise<boolean> {
  return accessToken ? Promise.resolve(true) : refreshAccessToken();
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...init.headers },
  });
  const skipAuth = path.startsWith("/api/login") || path.startsWith("/api/refresh");
  if (res.status === 401 && !skipAuth) {
    if (!retried && (await refreshAccessToken())) return api<T>(path, init, true);
    forceLogin();
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return undefined as T;
  return res.json() as Promise<T>;
}

export async function logout() {
  try { await fetch(`${API_URL}/api/logout`, { method: "POST", credentials: "include" }); } catch { /* ignore */ }
  forceLogin();
}

// ---------- music token: lets <audio> authenticate without a bearer header ----------

let musicToken: { value: string; expiresAt: number } | null = null;

export async function getMusicToken(): Promise<string> {
  if (musicToken && musicToken.expiresAt > Date.now() + 60_000) return musicToken.value;
  const r = await api<{ musicToken: string; expiresIn: number }>("/api/music/token", { method: "POST" });
  musicToken = { value: r.musicToken, expiresAt: Date.now() + r.expiresIn * 1000 };
  return r.musicToken;
}

export function streamUrl(trackId: string, mt: string) {
  return `${API_URL}/api/music/stream/${trackId}?mt=${encodeURIComponent(mt)}`;
}

/** Multipart upload of a playlist cover; fetch cannot use api()'s JSON headers here. */
export async function uploadPlaylistCover(playlistId: string, file: File): Promise<{ art: string }> {
  const form = new FormData();
  form.append("cover", file);
  const res = await fetch(`${API_URL}/api/music/playlists/${playlistId}/cover`, {
    method: "POST", body: form, credentials: "include",
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
  });
  if (!res.ok) throw new Error((await res.text()) || "Upload failed");
  return res.json();
}

export function artUrl(name: string | null | undefined) {
  return name ? `${API_URL}/api/music/art/${name}` : null;
}

// ---------- recent searches (per browser) ----------

const RECENT_KEY = "jy.recentSearches";
export function recentSearches(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
}
export function rememberSearch(q: string) {
  const t = q.trim(); if (t.length < 2) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...recentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8))); } catch { /* ignore */ }
}
export function forgetSearches() { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } }

// ---------- share links ----------

export type ShareKind = "track" | "album" | "playlist";
export type Share = {
  id: string; kind: ShareKind; targetId: string; title: string; subtitle: string; art: string | null; trackCount: number;
  allowDownload: boolean; createdAt: number; expiresAt: number | null; views: number;
};
export type SharedContent = { id: string; kind: ShareKind; title: string; subtitle: string; art: string | null; allowDownload: boolean; sharedBy: string; tracks: Track[] };

/** The public page for a share lives in this app, so the link is on whatever host the app is on. */
export const shareLink = (id: string) => `${location.origin}/s/${id}`;
export const shareStreamUrl = (id: string, trackId: string) => `${API_URL}/api/music/s/${id}/stream/${trackId}`;
export const shareDownloadUrl = (id: string, trackId: string) => `${API_URL}/api/music/s/${id}/download/${trackId}`;
export const shareZipUrl = (id: string) => `${API_URL}/api/music/s/${id}/zip`;

/** Public fetch: no session, no refresh dance — a dead link is just a 404. */
export async function fetchShared(id: string): Promise<SharedContent | null> {
  const res = await fetch(`${API_URL}/api/music/s/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ---------- shared types (mirror the API's view shapes) ----------

export type Track = {
  id: string; title: string; artist: string; artistId: string; album: string; albumId: string; albumArtist: string;
  trackNo: number | null; discNo: number | null; duration: number | null; genre: string | null; year: number | null;
  art: string | null; playable: boolean; loudness?: number | null; liked?: boolean; position?: number;
};
export type Album = { id: string; title: string; artist: string; artistId: string; year: number | null; art: string | null; trackCount: number; duration: number };
export type Artist = { id: string; name: string; albumCount: number; trackCount: number; art: string | null; image: string | null };
export type Playlist = { id: string; name: string; trackCount: number; duration: number; art: string | null; customArt: boolean; updatedAt: string };
export type Genre = { name: string; trackCount: number; art: string | null; colors?: [string, string] };
export type Mood = { id: string; name: string; blurb: string; colors: [string, string]; trackCount: number; art: string | null };
export type Mix = { id: string; kind: "daily" | "discover" | "timeofday" | "artist"; name: string; blurb: string; colors: [string, string]; art: string | null; trackCount: number };
export type Lyrics = { synced: { t: number; line: string }[] | null; plain: string | null };

export const fmtTime = (s: number | null | undefined) => {
  if (!s || !Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};
export const fmtLong = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
};
