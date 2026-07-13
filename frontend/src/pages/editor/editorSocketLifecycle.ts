import type { Socket } from "socket.io-client";
import type { EditorConnectionState } from "./status";

export const getEditorSocketUrl = () =>
  import.meta.env.VITE_API_URL === "/api"
    ? window.location.origin
    : import.meta.env.VITE_API_URL ||
      import.meta.env.VITE_DEV_BACKEND_URL ||
      "http://localhost:8000";

export const bindSocketConnectionState = (
  socket: Socket,
  setConnectionState: (state: EditorConnectionState) => void,
) => {
  setConnectionState(socket.connected ? "online" : "connecting");
  const onConnect = () => setConnectionState("online");
  const onDisconnect = (reason: string) =>
    setConnectionState(
      reason === "io client disconnect" ? "offline" : "reconnecting",
    );
  const onConnectError = () =>
    setConnectionState(navigator.onLine ? "reconnecting" : "offline");
  const onReconnectAttempt = () => setConnectionState("reconnecting");
  const onReconnectFailed = () => setConnectionState("offline");
  const onBrowserOffline = () => setConnectionState("offline");
  const onBrowserOnline = () =>
    setConnectionState(socket.connected ? "online" : "reconnecting");
  const onDevConnect = () => {
    (window as any).__EXCALIDASH_SOCKET_STATUS__ = { connected: true };
  };
  const onDevDisconnect = () => {
    (window as any).__EXCALIDASH_SOCKET_STATUS__ = { connected: false };
  };

  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("connect_error", onConnectError);
  socket.io.on("reconnect_attempt", onReconnectAttempt);
  socket.io.on("reconnect_failed", onReconnectFailed);
  window.addEventListener("offline", onBrowserOffline);
  window.addEventListener("online", onBrowserOnline);
  if (import.meta.env.DEV) {
    (window as any).__EXCALIDASH_SOCKET_STATUS__ = {
      connected: socket.connected,
    };
    socket.on("connect", onDevConnect);
    socket.on("disconnect", onDevDisconnect);
  }

  return () => {
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("connect_error", onConnectError);
    socket.io.off("reconnect_attempt", onReconnectAttempt);
    socket.io.off("reconnect_failed", onReconnectFailed);
    window.removeEventListener("offline", onBrowserOffline);
    window.removeEventListener("online", onBrowserOnline);
    if (import.meta.env.DEV) {
      socket.off("connect", onDevConnect);
      socket.off("disconnect", onDevDisconnect);
    }
  };
};
