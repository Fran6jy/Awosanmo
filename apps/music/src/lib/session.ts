import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL, api, token, type Track } from "./api";
import { deviceId } from "./device";

/**
 * The account-wide playback session, as seen from this device. When another
 * device is playing, `remote` describes it and the local player stands down;
 * "Play here" hands the queue over.
 */
export type RemotePlayback = {
  deviceId: string; deviceName: string; track: Track | null; queueIds: string[]; cursor: number;
  shuffle: boolean; repeat: "off" | "all" | "one"; position: number; playing: boolean;
  context: { kind: string; name: string } | null; updatedAt: number; stale: boolean;
};

let remote: RemotePlayback | null = null;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export function useRemotePlayback(): RemotePlayback | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => remote);
}

/** Registered by the player so a takeover elsewhere can pause it without a circular import. */
let onSuperseded: (() => void) | null = null;
export function setSupersededHandler(fn: () => void) { onSuperseded = fn; }

function apply(state: RemotePlayback | null) {
  const wasOurs = remote?.deviceId === deviceId;
  if (!state || state.deviceId === deviceId) {
    // Nothing elsewhere, or it is us: no banner.
    remote = null;
  } else {
    remote = state;
    // Another device just started (or is still) playing: stand down locally.
    if (state.playing && !state.stale) onSuperseded?.();
  }
  if (wasOurs || remote || !state) emit();
}

let socket: Socket | null = null;

export async function startSession() {
  try { apply(await api<RemotePlayback | null>("/api/music/playback")); } catch { /* offline is fine */ }
  socket = io(API_URL || "/", {
    path: "/socket.io", transports: ["websocket", "polling"], reconnection: true,
    reconnectionDelay: 1000, reconnectionDelayMax: 5000, auth: (cb) => cb({ token: token() }),
  });
  socket.on("music:playback", (state: RemotePlayback | null) => apply(state));
  // A dropped socket may have missed a broadcast; resync when it comes back.
  socket.on("connect", () => { api<RemotePlayback | null>("/api/music/playback").then(apply).catch(() => undefined); });
}

export function currentRemote() { return remote; }
