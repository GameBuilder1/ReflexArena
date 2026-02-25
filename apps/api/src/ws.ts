import type WebSocket from "ws";
import { z } from "zod";
import type { ClientToServer, ServerToClient } from "./types";
import type { ClientToServer, ServerToClient } from "@reflexarena/shared/src/types";

export type AuthedClient = {
  ws: WebSocket;
  userId: string;
  username: string;
  connectedAt: number;
  lastSeqByMatch: Map<string, number>;
};

export function send(ws: WebSocket, msg: ServerToClient) {
  ws.send(JSON.stringify(msg));
}

export function parseClientMessage(raw: unknown): ClientToServer | null {
  try {
    const s = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
    const obj = JSON.parse(s);

    // Loose validation (MVP). We enforce per-type in handlers.
    if (!obj?.type || !obj?.payload) return null;
    return obj as ClientToServer;
  } catch {
    return null;
  }
}

export const AuthSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(3).max(16).regex(/^[A-Za-z0-9_]+$/)
});

export const TapSchema = z.object({
  matchId: z.string().min(1),
  seq: z.number().int().min(1),
  targetId: z.string().min(1),
  clientTs: z.number().int().min(0)
});

export const RematchSchema = z.object({
  matchId: z.string().min(1),
  wantRematch: z.boolean()
});
