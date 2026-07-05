import { io, type Socket } from "socket.io-client";
import { API_URL, token } from "./api";

let socket: Socket | null = null;

/**
 * Lazily create a single shared Socket.IO connection. In production API_URL is
 * empty, so we connect to the same origin that served the app (works behind the
 * Cloudflare tunnel / nginx). In dev it targets the local API. The access token
 * is sent on the handshake (and refreshed on each reconnect) so the server can
 * scope torrent updates to this user only.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_URL || "/", {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: (cb) => cb({ token: token() }),
    });
  }
  return socket;
}
