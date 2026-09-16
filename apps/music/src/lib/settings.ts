import { api, recentSearches, token } from "./api";

/**
 * Account-wide settings. The player keeps its knobs in memory (and a local
 * copy for instant start-up); this module pulls the account's values after
 * login and pushes changes back, debounced, so every device you sign into
 * behaves the same.
 */
export type AccountSettings = {
  volume?: number;
  crossfade?: number;
  gaplessAlbums?: boolean;
  normalize?: boolean;
  recentSearches?: string[];
};

let applying = false;
let pending: AccountSettings = {};
let timer: number | null = null;
let applyFn: ((s: AccountSettings) => void) | null = null;

/** The player registers how to apply incoming settings (avoids a circular import). */
export function onSettingsApply(fn: (s: AccountSettings) => void) { applyFn = fn; }

/** True while incoming account settings are being applied, so setters do not echo them back. */
export function isApplyingSettings() { return applying; }

export async function loadAccountSettings() {
  if (!token()) return;
  try {
    const s = await api<AccountSettings>("/api/music/settings");
    applying = true;
    try { applyFn?.(s); } finally { applying = false; }
    if (s.recentSearches) { try { localStorage.setItem("jy.recentSearches", JSON.stringify(s.recentSearches)); } catch { /* ignore */ } }
  } catch { /* offline: keep the local copy */ }
}

/** Queue a change; several quick changes (a volume drag) collapse into one request. */
export function saveSetting(patch: AccountSettings) {
  if (applying || !token()) return;
  pending = { ...pending, ...patch };
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const body = pending; pending = {}; timer = null;
    api("/api/music/settings", { method: "PUT", body: JSON.stringify(body) }).catch(() => undefined);
  }, 800);
}

export function syncRecentSearches() { saveSetting({ recentSearches: recentSearches() }); }
