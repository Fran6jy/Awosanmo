import { useSyncExternalStore } from "react";
import { api, artUrl, getMusicToken, streamUrl, type Track } from "./api";
import { deviceId, deviceName } from "./device";
import { currentRemote, setSupersededHandler, type RemotePlayback } from "./session";
import { onSettingsApply, saveSetting } from "./settings";

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
  /** Seconds the next song overlaps the end of the current one; 0 = off. */
  crossfade: number;
  /** Let consecutive tracks of one album run straight into each other instead of crossfading. */
  gaplessAlbums: boolean;
  /** Level songs against each other using their measured loudness. */
  normalize: boolean;
  /** Sleep timer: when playback stops (epoch ms), or null. */
  sleepAt: number | null;
  /** Where the queue came from, for "playing from Album X" in the bar. */
  context: { kind: "album" | "artist" | "playlist" | "liked" | "genre" | "search" | "home" | "tracks" | "mix" | "mood" | "radio"; name: string } | null;
};

// Two decks: the one playing, and a standby that the next track is preloaded
// into so it can start under the current one for a crossfade (or instantly on
// "next"). `audio` always points at the deck the listener hears.
const decks = [new Audio(), new Audio()];
for (const d of decks) d.preload = "auto";
let audio = decks[0];
const standby = () => (audio === decks[0] ? decks[1] : decks[0]);

let state: PlayerState = {
  queue: [], order: [], cursor: -1, playing: false, shuffle: false, repeat: "off",
  progress: 0, duration: 0,
  volume: Number(localStorage.getItem("jy.volume") ?? 0.9), muted: false,
  crossfade: Number(localStorage.getItem("jy.crossfade") ?? 0),
  gaplessAlbums: localStorage.getItem("jy.gapless") !== "0",
  normalize: localStorage.getItem("jy.normalize") === "1",
  sleepAt: null,
  context: null,
};
audio.volume = state.volume;

// ---------- volume normalisation ----------
// Every analysed track carries its RMS loudness. We aim loud masters down to a
// common level and lift quiet recordings as far as the element allows, so a
// 90s ballad after a modern master does not need the volume knob.
const TARGET_DBFS = -16;
function trackGain(track: Track | null): number {
  if (!state.normalize || !track || track.loudness === null || track.loudness === undefined) return 1;
  const db = Math.max(-12, Math.min(9, TARGET_DBFS - track.loudness));
  return Math.pow(10, db / 20);
}
/** The element volume for a given track at the user's chosen level. */
function levelFor(track: Track | null): number {
  return Math.max(0, Math.min(1, state.volume * trackGain(track)));
}

/** iOS browsers ignore element volume, which makes a fade impossible there. */
export function crossfadeSupported(): boolean {
  const probe = decks[1];
  probe.volume = 0.5;
  const ok = probe.volume === 0.5;
  probe.volume = state.volume;
  return ok;
}

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
// Both decks are wired; events from the standby deck (a preload finishing, the
// old song ending under a crossfade) are ignored.
for (const el of decks) {
  el.addEventListener("timeupdate", () => {
    if (el !== audio) return;
    const dt = audio.currentTime - lastTick;
    if (dt > 0 && dt < 2) listenedSeconds += dt;
    lastTick = audio.currentTime;
    set({ progress: audio.currentTime, duration: audio.duration || state.duration });
    countPlayIfDue();
    updatePositionState();
    report();
    maybeCrossfade();
  });
  el.addEventListener("durationchange", () => { if (el === audio) set({ duration: audio.duration || 0 }); });
  el.addEventListener("play", () => { if (el !== audio) return; set({ playing: true }); claim(); report(true); });
  el.addEventListener("pause", () => { if (el !== audio) return; set({ playing: false }); if (!yielding) report(true); });
  el.addEventListener("ended", () => { if (el !== audio) return; countPlayIfDue(true); next(true); });
  el.addEventListener("error", () => {
    if (el !== audio) { preloadedFor = null; return; }
    // A broken file should not stall the whole queue: move on after a beat.
    setTimeout(() => next(true), 800);
  });
}

// ---------- crossfade ----------
let preloadedFor: string | null = null;           // track id sitting in the standby deck
let fade: { from: HTMLAudioElement; timer: number } | null = null;

/** The track that will play after the current one under the current repeat/shuffle rules. */
function upcoming(): { cursor: number; track: Track } | null {
  if (!state.order.length || state.repeat === "one") return null;
  let cursor = state.cursor + 1;
  if (cursor >= state.order.length) {
    if (state.repeat !== "all") return null;
    cursor = 0;
  }
  return { cursor, track: state.queue[state.order[cursor]] };
}

/** Consecutive tracks of one album (a live set, a mix) are meant to run together. */
function albumNeighbours(a: Track | null, b: Track): boolean {
  return !!a && a.albumId === b.albumId && (a.discNo ?? 1) === (b.discNo ?? 1)
    && a.trackNo !== null && b.trackNo !== null && b.trackNo === a.trackNo + 1;
}

async function preload(track: Track) {
  if (preloadedFor === track.id) return;
  preloadedFor = track.id;
  const el = standby();
  el.pause();
  el.src = streamUrl(track.id, await getMusicToken());
  el.load();
}

function stopFade() {
  if (!fade) return;
  clearInterval(fade.timer);
  fade.from.pause();
  fade = null;
  audio.volume = levelFor(current());
}

function maybeCrossfade() {
  if (!state.crossfade || fade || audio.paused) return;
  const remaining = audio.duration - audio.currentTime;
  if (!Number.isFinite(remaining)) return;
  const nxt = upcoming();
  if (!nxt || !nxt.track.playable) return;
  if (state.gaplessAlbums && albumNeighbours(current(), nxt.track)) return;
  if (remaining <= state.crossfade + 15) void preload(nxt.track);
  if (remaining <= state.crossfade && preloadedFor === nxt.track.id && standby().readyState >= 2) void startCrossfade(nxt);
}

async function startCrossfade(nxt: { cursor: number; track: Track }) {
  const from = audio;
  const to = standby();
  const outgoing = current();
  to.currentTime = 0;
  to.volume = 0;
  to.muted = from.muted;
  try { await to.play(); } catch { return; } // if the browser refuses, the song simply ends normally
  countPlayIfDue(true);
  // Hand over: from here on the incoming deck is "the player".
  audio = to;
  preloadedFor = null;
  set({ cursor: nxt.cursor, progress: 0, duration: nxt.track.duration ?? 0 });
  resetPlayAccounting();
  updateMediaSession(nxt.track);
  claim();
  report(true);
  // Equal-power curve: the mix stays at constant loudness through the overlap.
  const ms = state.crossfade * 1000;
  const started = performance.now();
  const fromLevel = levelFor(outgoing);
  const toLevel = levelFor(nxt.track);
  const timer = window.setInterval(() => {
    const p = Math.min(1, (performance.now() - started) / ms);
    from.volume = fromLevel * Math.cos(p * Math.PI / 2);
    to.volume = toLevel * Math.sin(p * Math.PI / 2);
    if (p >= 1 && fade?.timer === timer) { clearInterval(timer); from.pause(); fade = null; }
  }, 40);
  fade = { from, timer };
}

export function setCrossfade(seconds: number) {
  const crossfade = Math.max(0, Math.min(12, Math.round(seconds)));
  localStorage.setItem("jy.crossfade", String(crossfade));
  set({ crossfade });
  saveSetting({ crossfade });
}
export function setGaplessAlbums(on: boolean) {
  localStorage.setItem("jy.gapless", on ? "1" : "0");
  set({ gaplessAlbums: on });
  saveSetting({ gaplessAlbums: on });
}

// Incoming account settings (after login / on another device's change) land here without being echoed back.
onSettingsApply((s) => {
  if (typeof s.volume === "number") setVolume(s.volume);
  if (typeof s.crossfade === "number") setCrossfade(s.crossfade);
  if (typeof s.gaplessAlbums === "boolean") setGaplessAlbums(s.gaplessAlbums);
  if (typeof s.normalize === "boolean") setNormalize(s.normalize);
});

async function load(track: Track, autoplay: boolean) {
  stopFade();
  if (preloadedFor === track.id && standby().readyState >= 1) {
    // Already buffered in the standby deck (it was up next): switch decks instead of refetching.
    const old = audio;
    audio = standby();
    old.pause();
    audio.currentTime = 0;
  } else {
    audio.src = streamUrl(track.id, await getMusicToken());
  }
  preloadedFor = null;
  audio.volume = levelFor(track);
  audio.muted = state.muted;
  resetPlayAccounting();
  set({ progress: 0, duration: track.duration ?? 0 });
  updateMediaSession(track);
  if (autoplay) {
    claim();
    try { await audio.play(); } catch { /* autoplay blocked until a gesture */ }
  }
  report(true);
}

/**
 * Smart shuffle. A fair shuffle plays the same artist three times in a row
 * often enough to annoy; this one draws each next song with a weight that
 * drops sharply for an artist heard in the last few picks (and a little for
 * the same album), and rises a little for liked songs. The playing track is
 * pinned to the front so toggling shuffle never changes what is on now.
 */
function buildOrder(length: number, shuffle: boolean, keepFirst: number | null, tracks: Track[] = state.queue): number[] {
  const idx = Array.from({ length }, (_, i) => i);
  if (!shuffle) return idx;
  const order: number[] = [];
  const remaining = new Set(idx);
  if (keepFirst !== null && remaining.has(keepFirst)) { order.push(keepFirst); remaining.delete(keepFirst); }
  const recentArtists: string[] = [];
  const recentAlbums: string[] = [];
  const window = Math.max(2, Math.min(6, Math.floor(length / 4)));
  while (remaining.size) {
    let total = 0;
    const weights: [number, number][] = [];
    for (const i of remaining) {
      const t = tracks[i];
      let w = 1 + (t?.liked ? 0.35 : 0);
      if (t && recentArtists.includes(t.artistId)) w *= 0.08;
      if (t && recentAlbums.includes(t.albumId)) w *= 0.5;
      total += w; weights.push([i, w]);
    }
    let r = Math.random() * total;
    let pick = weights[weights.length - 1][0];
    for (const [i, w] of weights) { r -= w; if (r <= 0) { pick = i; break; } }
    order.push(pick); remaining.delete(pick);
    const t = tracks[pick];
    if (t) { recentArtists.push(t.artistId); recentAlbums.push(t.albumId); if (recentArtists.length > window) { recentArtists.shift(); recentAlbums.shift(); } }
  }
  return order;
}

// ---------- public controls ----------

/** Replace the queue with `tracks` and start at `startIndex`. */
export async function playQueue(tracks: Track[], startIndex = 0, context: PlayerState["context"] = null) {
  const playable = tracks.filter((t) => t.playable);
  if (!playable.length) return;
  const start = Math.max(0, playable.findIndex((t) => t.id === tracks[startIndex]?.id));
  const order = buildOrder(playable.length, state.shuffle, state.shuffle ? start : null, playable);
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
  if (audio.paused) { try { await audio.play(); } catch { /* ignore */ } } else { stopFade(); audio.pause(); }
}
export function pause() { stopFade(); audio.pause(); }

export async function next(auto = false) {
  if (!state.order.length) return;
  if (state.repeat === "one" && auto) { audio.currentTime = 0; resetPlayAccounting(); void audio.play(); return; }
  let cursor = state.cursor + 1;
  if (cursor >= state.order.length) {
    if (state.repeat === "all") cursor = 0;
    else { stopFade(); audio.pause(); set({ cursor: state.order.length - 1, progress: 0 }); audio.currentTime = 0; return; }
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
  set({ volume, muted: false });
  if (!fade) audio.volume = levelFor(current()); // during a fade the ramp applies the new level itself
  for (const d of decks) d.muted = false;
  localStorage.setItem("jy.volume", String(volume));
  saveSetting({ volume });
}
export function setNormalize(on: boolean) {
  localStorage.setItem("jy.normalize", on ? "1" : "0");
  set({ normalize: on });
  if (!fade) audio.volume = levelFor(current());
  saveSetting({ normalize: on });
}

// ---------- sleep timer ----------
let sleepTimer: number | null = null;
let sleepFade: number | null = null;
/** Stop after `minutes` (0 clears). The last 10 seconds fade out so it never cuts mid-note. */
export function setSleepTimer(minutes: number) {
  if (sleepTimer) { window.clearTimeout(sleepTimer); sleepTimer = null; }
  if (sleepFade) { window.clearInterval(sleepFade); sleepFade = null; if (!fade) audio.volume = levelFor(current()); }
  if (!minutes) { set({ sleepAt: null }); return; }
  const at = Date.now() + minutes * 60_000;
  set({ sleepAt: at });
  sleepTimer = window.setTimeout(() => {
    const started = performance.now();
    const base = audio.volume;
    sleepFade = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / 10_000);
      audio.volume = base * (1 - p);
      if (p >= 1) { window.clearInterval(sleepFade!); sleepFade = null; pause(); audio.volume = levelFor(current()); set({ sleepAt: null }); }
    }, 200);
  }, Math.max(0, minutes * 60_000 - 10_000));
}
export function toggleMute() { const muted = !audio.muted; for (const d of decks) d.muted = muted; set({ muted }); }

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
  if (current?.id === trackId) { stopFade(); audio.pause(); audio.removeAttribute("src"); }
  if (preloadedFor === trackId) { standby().removeAttribute("src"); preloadedFor = null; }
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
  stopFade();
  for (const d of decks) { d.pause(); d.removeAttribute("src"); }
  preloadedFor = null;
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
