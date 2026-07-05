// In production the API serves the built frontend from the same origin, so an
// empty base makes requests relative (works behind nginx / any host). In dev the
// Vite server (:5173) and API (:4000) are separate origins, so fall back to the
// local API. Override explicitly with VITE_API_URL for a split deployment.
export const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

export function token() {
  return localStorage.getItem("awosanmo_token");
}

/** Persist a fresh access (and optional refresh) token pair. */
export function setTokens(t: { token: string; refreshToken?: string }) {
  localStorage.setItem("awosanmo_token", t.token);
  if (t.refreshToken) localStorage.setItem("awosanmo_refresh", t.refreshToken);
}

/** Clear the session and bounce to login. Called when auth can't be recovered. */
function forceLogin() {
  localStorage.removeItem("awosanmo_token");
  localStorage.removeItem("awosanmo_refresh");
  if (!location.pathname.startsWith("/login")) location.assign("/login");
}

// Single-flight refresh: concurrent 401s share one refresh request.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const rt = localStorage.getItem("awosanmo_refresh");
  if (!rt) return false;
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/api/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        setTokens(await r.json());
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...init.headers
    }
  });
  const skipAuth = path.startsWith("/api/login") || path.startsWith("/api/refresh");
  // On 401, try a transparent token refresh once, then retry the request.
  if (res.status === 401 && !skipAuth) {
    if (!retried && (await refreshAccessToken())) return api<T>(path, init, true);
    forceLogin();
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined as T;
  return res.json() as Promise<T>;
}

/** Best-effort server-side logout (revokes the refresh token) + clear session. */
export async function logout() {
  const rt = localStorage.getItem("awosanmo_refresh");
  try {
    if (rt) await fetch(`${API_URL}/api/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) });
  } catch { /* ignore network errors on logout */ }
  forceLogin();
}

/**
 * Upload an arbitrary file with progress. Uses XHR so we get upload progress
 * events (fetch can't report them). Streams from the browser; the server writes
 * straight to disk.
 */
export function uploadFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ id: string; streamable: boolean; media_kind: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/uploads`);
    const t = token();
    if (t) xhr.setRequestHeader("Authorization", `Bearer ${t}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401 || xhr.status === 403) {
        forceLogin();
        reject(new Error("Session expired"));
      } else if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}

/** Request a zip of the given file ids and start the download via navigation. */
export async function downloadZip(ids: string[]): Promise<void> {
  const { zipToken } = await api<{ zipToken: string }>("/api/files/zip-token", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  window.location.href = `${API_URL}/api/zip?token=${encodeURIComponent(zipToken)}`;
}

/** Upload a .torrent file, which the server adds to the swarm. */
export async function uploadTorrentFile(file: File): Promise<{ id: string }> {
  const form = new FormData();
  form.append("torrent", file);
  const res = await fetch(`${API_URL}/api/torrents/upload`, {
    method: "POST",
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    body: form,
  });
  if (res.status === 401 || res.status === 403) {
    forceLogin();
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
