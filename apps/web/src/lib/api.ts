// In production the API serves the built frontend from the same origin, so an
// empty base makes requests relative (works behind nginx / any host). In dev the
// Vite server (:5173) and API (:4000) are separate origins, so fall back to the
// local API. Override explicitly with VITE_API_URL for a split deployment.
export const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

export function token() {
  return localStorage.getItem("awosanmo_token");
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
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined as T;
  return res.json() as Promise<T>;
}
