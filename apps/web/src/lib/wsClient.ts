import type { ClientToServer, ServerToClient } from "@reflexarena/shared";

export type MessageHandler = (msg: ServerToClient) => void;
export type ErrorHandler = (err: Event | Error) => void;
export type OpenHandler = () => void;
export type CloseHandler = (ev: CloseEvent) => void;

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const DEV = import.meta.env.DEV;

function isServerToClient(val: unknown): val is ServerToClient {
  return (
    typeof val === "object" &&
    val !== null &&
    typeof (val as Record<string, unknown>).type === "string" &&
    "payload" in (val as Record<string, unknown>)
  );
}

export class WSClient {
  private url: string;
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  private messageHandlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private openHandlers: OpenHandler[] = [];
  private closeHandlers: CloseHandler[] = [];

  constructor(url: string) {
    this.url = url;
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this._openSocket();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this._clearReconnectTimer();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  send(msg: ClientToServer): void {
    if (!this.isConnected) {
      if (DEV) console.warn("[WSClient] Cannot send: socket not open");
      return;
    }
    this.socket!.send(JSON.stringify(msg));
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => this._removeHandler(this.messageHandlers, handler);
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.push(handler);
    return () => this._removeHandler(this.errorHandlers, handler);
  }

  onOpen(handler: OpenHandler): () => void {
    this.openHandlers.push(handler);
    return () => this._removeHandler(this.openHandlers, handler);
  }

  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.push(handler);
    return () => this._removeHandler(this.closeHandlers, handler);
  }

  private _openSocket(): void {
    const ws = new WebSocket(this.url);
    this.socket = ws;

    ws.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.openHandlers.forEach((h) => h());
    });

    ws.addEventListener("message", (event) => {
      try {
        const parsed: unknown = JSON.parse(event.data as string);
        if (!isServerToClient(parsed)) {
          if (DEV) console.warn("[WSClient] Unexpected message shape:", parsed);
          return;
        }
        this.messageHandlers.forEach((h) => h(parsed));
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (DEV) console.warn("[WSClient] Failed to parse message:", event.data);
        this.errorHandlers.forEach((h) => h(error));
      }
    });

    ws.addEventListener("error", (event) => {
      if (DEV) console.error("[WSClient] WebSocket error:", event);
      this.errorHandlers.forEach((h) => h(event));
    });

    ws.addEventListener("close", (event) => {
      this.closeHandlers.forEach((h) => h(event));
      if (!this.intentionalClose) {
        this._scheduleReconnect();
      }
    });
  }

  private _scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      if (DEV) console.error("[WSClient] Max reconnection attempts reached. Giving up.");
      return;
    }
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempts]!;
    if (DEV) console.info(`[WSClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this._openSocket();
    }, delay);
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _removeHandler<T>(list: T[], handler: T): void {
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }
}

const WS_URL = (import.meta.env.VITE_API_WS as string) || "ws://localhost:4000/ws";

export const wsClient = new WSClient(WS_URL);

export function createWsClient(url: string): WSClient {
  return new WSClient(url);
}
