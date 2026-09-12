import { useSyncExternalStore } from "react";
import { api, artUrl, getMusicToken, streamUrl, type Track } from "./api";
import { deviceId, deviceName } from "./device";
import { currentRemote, setSupersededHandler, type RemotePlayback } from "./session";

/**
 * The player engine: one <audio> element, a queue, and a tiny external store
 * so any component can subscribe without prop drilling. Everything the bottom
 * bar, the queue panel and the lock-screen controls show comes from here.
 */
export type Repeat = "off" | "all" | "one";

export type PlayerState = {
  queue: Track[];
  /** Order the queue is played in (indices into `queue`); differs when shuffled. */
  order: number[];
  /** Position within `order`. */
  cursor: number;
  playing: boolean;
  shuffle: boolean;
  repeat: Repeat;
  progress: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** Where the queue came from, for "playing from Album X" in the bar. */
  context: { kind: "album" | "artist" | "playlist" | "liked" | "genre" | "search" | "home" | "tracks"; name: string } | null;
};

const audio = new Audio();
audio.preload = "auto";

let state: PlayerState = {
  queue: [], order: [], cursor: -1, playing: false, shuffle: false, repeat: "off",
  progress: 0, duration: 0,
  volume: Number(localStorage.getItem("jy.volume") ?? 0.9), muted: false, context: null,
};
audio.volume = state.volume;

const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function set(patch: Partial<PlayerState>) { state = { ...state, ...patch }; emit(); }

export function usePlayer(): PlayerState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

export function current(): Track | null {
  if (state.cursor < 0 || state.cursor >= state.order.length) return null;
  return state.queue[state.order[state.cursor]] ?? null;
}
export function useCurrent(): Track | null {
  usePlayer();
  return current();
}

// ---------- play accounting ----------
// A play is counted once a track has been heard for 20 seconds (or finished),
// close to Spotify's own threshold, so skipping through the queue is not "listening".
let playCounted = false;
let listenedSeconds = 0;
let lastTick = 0;
function resetPlayAccounting() { playCounted = false; listenedSeconds = 0; lastTick = audio.currentTime; }
function countPlayIfDue(force = false) {
  const t = current();
  if (!t || playCounted) return;
  if (force || listenedSeconds >= 20) {
    playCounted = true;
    api("/api/music/plays", { method: "POST", body: JSON.stringify({ trackId: t.id }) }).catch(() => undefined);
  }
}

// ---------- account-wide session: one active device ----------
// `active` means this tab owns the session. Only the owner reports, so a tab
// that was just superseded cannot overwrite the new device's state with its
// own pause. A user gesture to play always claims the session.
let active = false;
let yielding = false;
let lastReport = 0;

function report(force = false) {
  if (!active) return;
  const now = Date.now();
  if (!force && now - lastReport < 4_000) return;
  lastReport = now;
  const t = current();
  api("/api/music/playback", {
    method: "PUT",
    body: JSON.stringify({
      deviceId, deviceName,
      trackId: t?.id ?? null,
      queueIds: state.order.map((i) => state.queue[i].id),
      cursor: state.cursor,
      shuffle: state.shuffle, repeat: state.repeat,
      position: audio.currentTime || 0,
      playing: !audio.paused && !!t,
      context: state.context,
    }),
  }).catch(() => undefined);
}

function claim() { active = true; }

/** Another device started playing: pause here without reporting it. */
setSupersededHandler(() => {
  if (!active && audio.paused) return;
  active = false;
  yielding = true;
  audio.pause();
  yielding = false;
});

/** Continue the session on this device from where the other one is. */
export async function takeOver(r: RemotePlayback = currentRemote()!) {
  if (!r) return;
  const tracks = r.queueIds.length
    ? await api<Track[]>("/api/music/tracks/batch", { method: "POST", body: JSON.stringify({ ids: r.queueIds }) })
    : (r.track ? [r.track] : []);
  if (!tracks.length) return;
  const cursor = Math.max(0, Math.min(r.cursor, tracks.length - 1));
  // The remote queue arrives already in play order, so order is the identity.
  set({ queue: tracks, order: tracks.map((_, i) => i), cursor, shuffle: r.shuffle, repeat: r.repeat, context: r.context as PlayerState["context"] });
  claim();
  await load(tracks[cursor], true);
  if (r.position > 0) seek(r.position);
  report(true);
}

// ---------- audio element wiring ----------
audio.addEventListener("timeupdate", () => {
  const dt = audio.currentTime - lastTick;
  if (dt > 0 && dt < 2) listenedSeconds += dt;
  lastTick = audio.currentTime;
  set({ progress: audio.currentTime, duration: audio.duration || state.duration });
  countPlayIfDue();
  updatePositionState();
  report();
});
audio.addEventListener("durationchange", () => set({ duration: audio.duration || 0 }));
audio.addEventListener("play", () => { set({ playing: true }); claim(); report(true); });
audio.addEventListener("pause", () => { set({ playing: false }); if (!yielding) report(true); });
audio.addEventListener("ended", () => { countPlayIfDue(true); next(true); });
audio.addEventListener("error", () => {
  // A broken file should not stall the whole queue: move on after a beat.
  setTimeout(() => next(true), 800);
});

async function load(track: Track, autoplay: boolean) {
  const mt = await getMusicToken();
  audio.src = streamUrl(track.id, mt);
  resetPlayAccounting();
  set({ progress: 0, duration: track.duration ?? 0 });
  updateMediaSession(track);
  if (autoplay) {
    claim();
    try { await audio.play(); } catch { /* autoplay blocked until a gesture */ }
  }
  report(true);
}

function buildOrder(length: number, shuffle: boolean, keepFirst: number | null): number[] {
  const idx = Array.from({ length }, (_, i) => i);
  if (!shuffle) return idx;
  // Fisher-Yates, then pin the currently playing track to the front so
  // toggling shuffle never changes what is playing right now.
  for (let i = idx.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  if (keepFirst !== null) {
    const at = idx.indexOf(keepFirst);
    if (at > 0) { idx.splice(at, 1); idx.unshift(keepFirst); }
  }
  return idx;
}

// ---------- public controls ----------

/** Replace the queue with `tracks` and start at `startIndex`. */
export async function playQueue(tracks: Track[], startIndex = 0, context: PlayerState["context"] = null) {
  const playable = tracks.filter((t) => t.playable);
  if (!playable.length) return;
  const start = Math.max(0, playable.findIndex((t) => t.id === tracks[startIndex]?.id));
  const order = buildOrder(playable.length, state.shuffle, state.shuffle ? start : null);
  const cursor = state.shuffle ? 0 : start;
  set({ queue: playable, order, cursor, context });
  await load(playable[order[cursor]], true);
}

export function playTrack(track: Track, within: Track[] = [track], context: PlayerState["context"] = null) {
  const i = within.findIndex((t) => t.id === track.id);
  return playQueue(within, i < 0 ? 0 : i, context);
}

export function addToQueue(tracks: Track[]) {
  const playable = tracks.filter((t) => t.playable);
  if (!playable.length) return;
  const queue = [...state.queue, ...playable];
  const added = playable.map((_, i) => state.queue.length + i);
  // Appended tracks play after everything currently ordered, shuffled or not.
  set({ queue, order: [...state.order, ...added] });
  if (state.cursor < 0) { set({ cursor: 0 }); void load(queue[state.order[0]], true); }
}

export function playNext(tracks: Track[]) {
  const playable = tracks.filter((t) => t.playable);
  if (!playable.length) return;
  const queue = [...state.queue, ...playable];
  const added = playable.map((_, i) => state.queue.length + i);
  const order = [...state.order];
  order.splice(state.cursor + 1, 0, ...added);
  set({ queue, order });
  if (state.cursor < 0) { set({ cursor: 0 }); void load(queue[order[0]], true); }
}

export async function toggle() {
  if (!current()) return;
  if (audio.paused) { try { await audio.play(); } catch { /* ignore */ } } else audio.pause();
}
export function pause() { audio.pause(); }

export async function next(auto = false) {
  if (!state.order.length) return;
  if (state.repeat === "one" && auto) { audio.currentTime = 0; resetPlayAccounting(); void audio.play(); return; }
  let cursor = state.cursor + 1;
  if (cursor >= state.order.length) {
    if (state.repeat === "all") cursor = 0;
    else { audio.pause(); set({ cursor: state.order.length - 1, progress: 0 }); audio.currentTime = 0; return; }
  }
  set({ cursor });
  await load(state.queue[state.order[cursor]], true);
}

export async function prev() {
  if (!state.order.length) return;
  // Spotify behaviour: within the first few seconds go back a track, else restart.
  if (audio.currentTime > 3 || state.cursor === 0) { audio.currentTime = 0; resetPlayAccounting(); return; }
  const cursor = state.cursor - 1;
  set({ cursor });
  await load(state.queue[state.order[cursor]], true);
}

export async function jumpTo(orderIndex: number) {
  if (orderIndex < 0 || orderIndex >= state.order.length) return;
  set({ cursor: orderIndex });
  await load(state.queue[state.order[orderIndex]], true);
}

export function seek(seconds: number) {
  audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
  lastTick = audio.currentTime;
  set({ progress: audio.currentTime });
  report(true);
}

export function setVolume(v: number) {
  const volume = Math.max(0, Math.min(1, v));
  audio.volume = volume;
  audio.muted = false;
  localStorage.setItem("jy.volume", String(volume));
  set({ volume, muted: false });
}
export function toggleMute() { audio.muted = !audio.muted; set({ muted: audio.muted }); }

export function toggleShuffle() {
  const shuffle = !state.shuffle;
  const playingIdx = state.cursor >= 0 ? state.order[state.cursor] : null;
  const order = buildOrder(state.queue.length, shuffle, playingIdx);
  const cursor = playingIdx === null ? -1 : order.indexOf(playingIdx);
  set({ shuffle, order, cursor });
}
export function cycleRepeat() {
  const repeat: Repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  set({ repeat });
}

export function removeFromQueue(orderIndex: number) {
  if (orderIndex === state.cursor) return; // keep the playing track
  const queueIdx = state.order[orderIndex];
  const order = state.order.filter((_, i) => i !== orderIndex).map((q) => (q > queueIdx ? q - 1 : q));
  const queue = state.queue.filter((_, i) => i !== queueIdx);
  const cursor = orderIndex < state.cursor ? state.cursor - 1 : state.cursor;
  set({ queue, order, cursor });
}

/** A track was deleted from the library: take every copy out of the queue, stopping if it was the one playing. */
export function dropTrack(trackId: string) {
  if (!state.queue.some((t) => t.id === trackId)) return;
  const current = state.queue[state.order[state.cursor]];
  if (current?.id === trackId) { audio.pause(); audio.removeAttribute("src"); }
  const keep = state.queue.map((t, i) => (t.id === trackId ? -1 : i));
  const remap = new Map<number, number>();
  keep.filter((i) => i >= 0).forEach((old, fresh) => remap.set(old, fresh));
  const queue = state.queue.filter((t) => t.id !== trackId);
  const order = state.order.filter((q) => remap.has(q)).map((q) => remap.get(q)!);
  const removedBefore = state.order.slice(0, state.cursor).filter((q) => !remap.has(q)).length;
  const cursor = current?.id === trackId ? Math.min(state.cursor - removedBefore, order.length - 1) : state.cursor - removedBefore;
  set({ queue, order, cursor, ...(current?.id === trackId ? { playing: false, progress: 0, duration: 0 } : {}) });
}

export function clearQueue() {
  if (active) { active = false; api(`/api/music/playback?deviceId=${encodeURIComponent(deviceId)}`, { method: "DELETE" }).catch(() => undefined); }
  audio.pause();
  audio.removeAttribute("src");
  set({ queue: [], order: [], cursor: -1, playing: false, progress: 0, duration: 0, context: null });
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
}

/** Update a track's liked flag wherever it appears in the queue. */
export function markLiked(trackId: string, liked: boolean) {
  set({ queue: state.queue.map((t) => (t.id === trackId ? { ...t, liked } : t)) });
}

// ---------- lock screen / headphone controls ----------

function updateMediaSession(track: Track) {
  if (!("mediaSession" in navigator)) return;
  const art = artUrl(track.art);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: art ? [{ src: art, sizes: "512x512", type: art.endsWith(".png") ? "image/png" : "image/jpeg" }] : [],
  });
  const h = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  h("play", () => void toggle());
  h("pause", () => void toggle());
  h("previoustrack", () => void prev());
  h("nexttrack", () => void next());
  h("seekto", (d) => { if (typeof d.seekTime === "number") seek(d.seekTime); });
  h("seekbackward", (d) => seek(audio.currentTime - (d.seekOffset ?? 10)));
  h("seekforward", (d) => seek(audio.currentTime + (d.seekOffset ?? 10)));
}
function updatePositionState() {
  if (!("mediaSession" in navigator) || !Number.isFinite(audio.duration)) return;
  try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: audio.currentTime }); } catch { /* ignore */ }
}

// ---------- keyboard ----------
export function installKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
    if (e.code === "Space") { e.preventDefault(); void toggle(); }
    else if (e.key === "ArrowRight" && (e.ctrlKey || e.metaKey)) void next();
    else if (e.key === "ArrowLeft" && (e.ctrlKey || e.metaKey)) void prev();
    else if (e.key === "ArrowUp" && e.shiftKey) setVolume(state.volume + 0.1);
    else if (e.key === "ArrowDown" && e.shiftKey) setVolume(state.volume - 0.1);
    else if (e.key.toLowerCase() === "m") toggleMute();
    else if (e.key.toLowerCase() === "s") toggleShuffle();
    else if (e.key.toLowerCase() === "r") cycleRepeat();
  });
}
