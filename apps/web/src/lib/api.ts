export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

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
