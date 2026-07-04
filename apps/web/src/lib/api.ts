// In production the API serves the built frontend from the same origin, so an
// empty base makes requests relative (works behind nginx / any host). In dev the
// Vite server (:5173) and API (:4000) are separate origins, so fall back to the
// local API. Override explicitly with VITE_API_URL for a split deployment.
export const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

export function token() {
  return localStorage.getItem("awosanmo_token");
}

/** Clear the session and bounce to login. Called when the token is rejected. */
function forceLogin() {
  localStorage.removeItem("awosanmo_token");
  if (!location.pathname.startsWith("/login")) location.assign("/login");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...init.headers
    }
  });
  // An expired/invalid token must not fail silently — send the user to log in.
  if ((res.status === 401 || res.status === 403) && !path.startsWith("/api/login")) {
    forceLogin();
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined as T;
  return res.json() as Promise<T>;
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
