import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "../lib/socket";
import { pushToast } from "./Toast";

type Notification = { type?: "success" | "error" | "info"; title: string; body?: string };

/**
 * Mounts once near the app root. Subscribes to the server's Socket.IO stream and
 * feeds live data straight into the React Query cache, so the UI updates in real
 * time instead of relying solely on polling. Renders nothing.
 */
export function LiveSync() {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    // Full torrent list snapshot (~every 1.5s) — matches GET /api/torrents, so
    // we can drop it directly into the cache with no extra request.
    const onTorrents = (rows: unknown) => qc.setQueryData(["torrents"], rows);

    const invalidateTorrents = () => {
      qc.invalidateQueries({ queryKey: ["torrents"] });
      qc.invalidateQueries({ queryKey: ["files"] });
    };

    const onMetadata = (payload: { id: string; name: string }) => {
      qc.invalidateQueries({ queryKey: ["torrents"] });
      pushToast({ type: "info", title: "Metadata received", body: payload.name });
    };

    const onNotification = (n: Notification) => {
      pushToast({ type: n.type ?? "info", title: n.title, body: n.body });
      // Best-effort desktop notification. Only in a secure context — over plain
      // HTTP the Notification API can throw synchronously, so guard + try/catch.
      try {
        if (window.isSecureContext && typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(n.title, { body: n.body });
        }
      } catch {
        /* notifications unsupported in this context */
      }
      qc.invalidateQueries({ queryKey: ["files"] });
    };

    socket.on("torrents:update", onTorrents);
    socket.on("torrent:metadata", onMetadata);
    socket.on("torrent:paused", invalidateTorrents);
    socket.on("torrent:resumed", invalidateTorrents);
    socket.on("torrent:removed", invalidateTorrents);
    socket.on("notification", onNotification);

    // Ask once for desktop-notification permission (non-blocking). Over plain
    // HTTP some browsers throw synchronously here, which would crash the app, so
    // require a secure context and wrap in try/catch.
    try {
      if (window.isSecureContext && typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => undefined);
      }
    } catch {
      /* notifications unsupported in this context */
    }

    return () => {
      socket.off("torrents:update", onTorrents);
      socket.off("torrent:metadata", onMetadata);
      socket.off("torrent:paused", invalidateTorrents);
      socket.off("torrent:resumed", invalidateTorrents);
      socket.off("torrent:removed", invalidateTorrents);
      socket.off("notification", onNotification);
    };
  }, [qc]);

  return null;
}
