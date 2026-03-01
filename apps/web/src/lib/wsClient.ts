import type { ClientToServer, ServerToClient } from "@reflexarena/shared";

export type MessageHandler = (msg: ServerToClient) => void;
export type ErrorHandler = (err: Error) => void;
export type OpenHandler = () => void;
export type CloseHandler = (code: number, reason: string) => void;

const DEFAULT_WS_URL = (import.meta.env.VITE_API_WS as string | undefined) ?? "ws://localhost:4000/ws";
const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const;
const IS_DEV = import.meta.env.DEV as boolean;

function isServerToClient(obj: unknown): obj is ServerToClient {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as Record<string, unknown>).type === "string" &&
    "payload" in (obj as Record<string, unknown>)
  );
}

export class WSClient {
  private url: string;
  private socket: WebSocket | null = null;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitClose = false;

  private messageHandlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private openHandlers: OpenHandler[] = [];
  private closeHandlers: CloseHandler[] = [];

  constructor(url: string = DEFAULT_WS_URL) {
    this.url = url;
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      return;
    }
    this.explicitClose = false;
    this.openSocket();
  }

  disconnect(): void {
    this.explicitClose = true;
    this.clearRetryTimer();
    this.socket?.close();
    this.socket = null;
  }

  send(msg: ClientToServer): void {
    if (!this.isConnected) {
      if (IS_DEV) {
        console.warn("[WSClient] Cannot send message: not connected", msg);
      }
      return;
    }
    this.socket!.send(JSON.stringify(msg));
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => this.removeHandler(this.messageHandlers, handler);
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.push(handler);
    return () => this.removeHandler(this.errorHandlers, handler);
  }

  onOpen(handler: OpenHandler): () => void {
    this.openHandlers.push(handler);
    return () => this.removeHandler(this.openHandlers, handler);
  }

  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.push(handler);
    return () => this.removeHandler(this.closeHandlers, handler);
  }

  private openSocket(): void {
    const ws = new WebSocket(this.url);
    this.socket = ws;

    ws.addEventListener("open", () => {
      this.retryCount = 0;
      this.openHandlers.forEach((h) => h());
    });

    ws.addEventListener("message", (event) => {
      try {
        const obj: unknown = JSON.parse(event.data as string);
        if (!isServerToClient(obj)) {
          throw new Error("Unexpected message shape");
        }
        this.messageHandlers.forEach((h) => h(obj));
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (IS_DEV) {
          console.error("[WSClient] Message parse error:", error, event.data);
        }
        this.errorHandlers.forEach((h) => h(error));
      }
    });

    ws.addEventListener("error", () => {
      const error = new Error("WebSocket connection error");
      if (IS_DEV) {
        console.error("[WSClient] Connection error");
      }
      this.errorHandlers.forEach((h) => h(error));
    });

    ws.addEventListener("close", (event) => {
      this.closeHandlers.forEach((h) => h(event.code, event.reason));
      if (!this.explicitClose) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.retryCount >= MAX_RETRIES) {
      const error = new Error(
        `[WSClient] Max reconnection attempts (${MAX_RETRIES}) exceeded`
      );
      if (IS_DEV) {
        console.error(error.message);
      }
      this.errorHandlers.forEach((h) => h(error));
      return;
    }

    const delayIndex = Math.min(this.retryCount, RETRY_DELAYS_MS.length - 1);
    const delay = RETRY_DELAYS_MS[delayIndex];
    if (IS_DEV) {
      console.info(
        `[WSClient] Reconnecting in ${delay}ms (attempt ${this.retryCount + 1}/${MAX_RETRIES})`
      );
    }

    this.retryTimer = setTimeout(() => {
      this.retryCount++;
      this.openSocket();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private removeHandler<T>(list: T[], handler: T): void {
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }
}

export const wsClient = new WSClient();

export function createWsClient(url: string = DEFAULT_WS_URL): WSClient {
  return new WSClient(url);
}
