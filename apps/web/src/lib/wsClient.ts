import type { ClientToServer, ServerToClient } from "@reflexarena/shared";

export type MessageHandler = (msg: ServerToClient) => void;

export function createWsClient(url: string) {
  const socket = new WebSocket(url);
  const handlers: MessageHandler[] = [];

  socket.addEventListener("message", (event) => {
    try {
      const msg: ServerToClient = JSON.parse(event.data as string);
      handlers.forEach((h) => h(msg));
    } catch {
      console.warn("Received malformed WebSocket message:", event.data);
    }
  });

  function send(msg: ClientToServer) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  function onMessage(handler: MessageHandler) {
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  }

  return { socket, send, onMessage };
}
