import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { parseEther } from "ethers";
import { z } from "zod";

import { send, parseClientMessage, AuthSchema, TapSchema, RematchSchema, type AuthedClient } from "./ws";
import { MatchEngine, COUNTDOWN_MS, MATCH_DURATION_MS, RECONNECT_WINDOW_MS, REMATCH_WINDOW_MS } from "./matchEngine";
import { MatchmakingQueue } from "./matchmaking";
import { createEscrow, joinEscrow, settleEscrow } from "./avalanche/escrow";
import { startEscrowListener } from "./avalanche/events";
import type { EscrowState } from "./avalanche/types";

const PORT = Number(process.env.API_PORT || 4000);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Connected clients by ws (declared early so HTTP route handlers can broadcast)
const clients = new Map<WebSocket, AuthedClient>(); // ws -> client

// ── In-memory escrow state ────────────────────────────────────────────────────
const escrows = new Map<string, EscrowState>();

// ── Zod schemas for match endpoints ──────────────────────────────────────────
const CreateMatchSchema = z.object({
  matchId: z.string().min(1),
  stakeAvax: z.string().regex(/^\d+(\.\d+)?$/).refine(
    (v) => { const n = Number(v); return n >= 0.001 && n <= 1000; },
    { message: "stakeAvax must be between 0.001 and 1000" }
  ),
  playerAUserId: z.string().min(1),
  playerBUserId: z.string().min(1).optional(),
});

const JoinMatchSchema = z.object({
  matchId: z.string().min(1),
  userId: z.string().min(1),
});

const SettleMatchSchema = z.object({
  matchId: z.string().min(1),
  winnerUserId: z.string().min(1),
});

// ── POST /match/create ────────────────────────────────────────────────────────
app.post("/match/create", async (req, res) => {
  const parsed = CreateMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "BAD_REQUEST", message: parsed.error.message });
    return;
  }
  const { matchId, stakeAvax, playerAUserId, playerBUserId } = parsed.data;

  if (escrows.has(matchId)) {
    const s = escrows.get(matchId)!;
    res.json({ matchId, escrowId: s.escrowId ?? "", txHash: s.createTxHash ?? null, stakeAvax, status: s.status });
    return;
  }

  const contractAddress = process.env.AVALANCHE_ESCROW_ADDRESS ?? "";
  const stakeWei = parseEther(stakeAvax);
  const state: EscrowState = {
    matchId,
    contractAddress,
    stakeWei,
    fundedA: false,
    fundedB: false,
    status: "NONE",
  };
  escrows.set(matchId, state);

  try {
    const { escrowId, txHash } = await createEscrow(state, matchId, stakeWei, playerAUserId, playerBUserId);

    // Broadcast to all connected clients
    for (const client of clients.values()) {
      send(client.ws, { type: "ESCROW_CREATED", payload: { matchId, escrowId, txHash, stakeAvax } });
    }

    res.json({ matchId, escrowId, txHash, stakeAvax, status: state.status });
  } catch (err) {
    state.status = "ERROR";
    const message = err instanceof Error ? err.message : String(err);
    for (const client of clients.values()) {
      send(client.ws, { type: "ESCROW_ERROR", payload: { matchId, code: "CREATE_FAILED", message } });
    }
    res.status(500).json({ error: "CREATE_FAILED", message });
  }
});

// ── POST /match/join ──────────────────────────────────────────────────────────
app.post("/match/join", async (req, res) => {
  const parsed = JoinMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "BAD_REQUEST", message: parsed.error.message });
    return;
  }
  const { matchId, userId } = parsed.data;
  const state = escrows.get(matchId);
  if (!state) {
    res.status(404).json({ error: "NOT_FOUND", message: "Match not found. Call /match/create first." });
    return;
  }

  try {
    const { txHash, fundedA, fundedB, status } = await joinEscrow(state, userId);

    for (const client of clients.values()) {
      send(client.ws, { type: "ESCROW_FUNDED", payload: { matchId, userId, txHash, fundedA, fundedB } });
    }
    if (status === "READY") {
      for (const client of clients.values()) {
        send(client.ws, { type: "READY_TO_START", payload: { matchId } });
      }
    }

    res.json({ matchId, userId, txHash, fundedA, fundedB, status });
  } catch (err) {
    state.status = "ERROR";
    const message = err instanceof Error ? err.message : String(err);
    for (const client of clients.values()) {
      send(client.ws, { type: "ESCROW_ERROR", payload: { matchId, code: "JOIN_FAILED", message } });
    }
    res.status(500).json({ error: "JOIN_FAILED", message });
  }
});

// ── POST /match/settle ────────────────────────────────────────────────────────
app.post("/match/settle", async (req, res) => {
  const parsed = SettleMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "BAD_REQUEST", message: parsed.error.message });
    return;
  }
  const { matchId, winnerUserId } = parsed.data;
  const state = escrows.get(matchId);
  if (!state) {
    res.status(404).json({ error: "NOT_FOUND", message: "Match not found." });
    return;
  }

  try {
    const { txHash, status } = await settleEscrow(state, matchId, winnerUserId);

    for (const client of clients.values()) {
      send(client.ws, { type: "ESCROW_SETTLED", payload: { matchId, winnerUserId, txHash } });
    }

    res.json({ matchId, winnerUserId, txHash, status });
  } catch (err) {
    state.status = "ERROR";
    const message = err instanceof Error ? err.message : String(err);
    for (const client of clients.values()) {
      send(client.ws, { type: "ESCROW_ERROR", payload: { matchId, code: "SETTLE_FAILED", message } });
    }
    res.status(500).json({ error: "SETTLE_FAILED", message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// (clients map is declared above, before the HTTP route handlers)

const engine = new MatchEngine({
  onMatchFound: (match, forPlayer) => {
    const me = forPlayer === "A" ? match.playerA : match.playerB;
    const opp = forPlayer === "A" ? match.playerB : match.playerA;
    if (!me.client) return;

    send(me.client.ws, {
      type: "MATCH_FOUND",
      payload: { matchId: match.matchId, opponentUsername: opp.username, countdownSec: Math.floor(COUNTDOWN_MS / 1000) }
    });
  },
  onMatchStart: (match) => {
    const startTs = Date.now();
    const durationSec = Math.floor(MATCH_DURATION_MS / 1000);
    match.playerA.client && send(match.playerA.client.ws, { type: "MATCH_START", payload: { matchId: match.matchId, startTs, durationSec } });
    match.playerB.client && send(match.playerB.client.ws, { type: "MATCH_START", payload: { matchId: match.matchId, startTs, durationSec } });
  },
  onSpawn: (match, target) => {
    match.playerA.client && send(match.playerA.client.ws, { type: "SPAWN", payload: { matchId: match.matchId, target } });
    match.playerB.client && send(match.playerB.client.ws, { type: "SPAWN", payload: { matchId: match.matchId, target } });
  },
  onState: (match, timeLeftMs) => {
    const aScore = match.scoreA;
    const bScore = match.scoreB;
    match.playerA.client &&
      send(match.playerA.client.ws, { type: "STATE_UPDATE", payload: { matchId: match.matchId, scoreYou: aScore, scoreOpp: bScore, timeLeftMs } });
    match.playerB.client &&
      send(match.playerB.client.ws, { type: "STATE_UPDATE", payload: { matchId: match.matchId, scoreYou: bScore, scoreOpp: aScore, timeLeftMs } });
  },
  onPaused: (match) => {
    match.playerA.client &&
      send(match.playerA.client.ws, { type: "MATCH_PAUSED", payload: { matchId: match.matchId, reason: "OPP_DISCONNECTED", reconnectWindowSec: Math.floor(RECONNECT_WINDOW_MS / 1000) } });
    match.playerB.client &&
      send(match.playerB.client.ws, { type: "MATCH_PAUSED", payload: { matchId: match.matchId, reason: "OPP_DISCONNECTED", reconnectWindowSec: Math.floor(RECONNECT_WINDOW_MS / 1000) } });
  },
  onResumed: (match) => {
    match.playerA.client && send(match.playerA.client.ws, { type: "MATCH_RESUMED", payload: { matchId: match.matchId } });
    match.playerB.client && send(match.playerB.client.ws, { type: "MATCH_RESUMED", payload: { matchId: match.matchId } });
  },
  onEnded: (match, payloadA, payloadB) => {
    match.playerA.client && send(match.playerA.client.ws, { type: "MATCH_END", payload: payloadA });
    match.playerB.client && send(match.playerB.client.ws, { type: "MATCH_END", payload: payloadB });
  },
  onRematchOffer: (match) => {
    match.playerA.client && send(match.playerA.client.ws, { type: "REMATCH_OFFER", payload: { matchId: match.matchId, windowSec: Math.floor(REMATCH_WINDOW_MS / 1000) } });
    match.playerB.client && send(match.playerB.client.ws, { type: "REMATCH_OFFER", payload: { matchId: match.matchId, windowSec: Math.floor(REMATCH_WINDOW_MS / 1000) } });
  },
  onRematchWait: (match) => {
    match.playerA.client && send(match.playerA.client.ws, { type: "REMATCH_WAIT", payload: { matchId: match.matchId, windowSec: Math.floor(REMATCH_WINDOW_MS / 1000) } });
    match.playerB.client && send(match.playerB.client.ws, { type: "REMATCH_WAIT", payload: { matchId: match.matchId, windowSec: Math.floor(REMATCH_WINDOW_MS / 1000) } });
  },
  onRematchStarting: (match) => {
    match.playerA.client && send(match.playerA.client.ws, { type: "REMATCH_STARTING", payload: { matchId: match.matchId, countdownSec: Math.floor(COUNTDOWN_MS / 1000) } });
    match.playerB.client && send(match.playerB.client.ws, { type: "REMATCH_STARTING", payload: { matchId: match.matchId, countdownSec: Math.floor(COUNTDOWN_MS / 1000) } });
  }
});

const queue = new MatchmakingQueue(engine);

// WS
wss.on("connection", (ws) => {
  let authed: AuthedClient | null = null;

  ws.on("message", (raw) => {
    const msg = parseClientMessage(raw);
    if (!msg) {
      send(ws, { type: "ERROR", payload: { code: "BAD_MESSAGE", message: "Invalid message" } });
      return;
    }

    // AUTH is required first
    if (!authed) {
      if (msg.type !== "AUTH") {
        send(ws, { type: "ERROR", payload: { code: "NOT_AUTHED", message: "AUTH required" } });
        return;
      }
      const parsed = AuthSchema.safeParse(msg.payload);
      if (!parsed.success) {
        send(ws, { type: "ERROR", payload: { code: "BAD_AUTH", message: "Invalid auth payload" } });
        return;
      }

      authed = {
        ws,
        userId: parsed.data.userId,
        username: parsed.data.username,
        connectedAt: Date.now(),
        lastSeqByMatch: new Map()
      };
      clients.set(ws, authed);

      // attach (reconnect) if needed
      engine.attachClient(authed.userId, authed);

      send(ws, { type: "AUTH_OK", payload: { userId: authed.userId, username: authed.username } });
      return;
    }

    // after auth
    switch (msg.type) {
      case "JOIN_QUEUE": {
        const res = queue.join(authed);
        if (!res.ok) {
          send(ws, { type: "ERROR", payload: { code: res.code, message: "Unable to join queue" } });
          return;
        }
        send(ws, { type: "QUEUE_STATUS", payload: { status: "SEARCHING" } });
        break;
      }
      case "LEAVE_QUEUE": {
        queue.leave(authed.userId);
        send(ws, { type: "QUEUE_STATUS", payload: { status: "IDLE" } });
        break;
      }
      case "TAP": {
        const parsed = TapSchema.safeParse(msg.payload);
        if (!parsed.success) return;

        const r = engine.handleTap(authed.userId, parsed.data.matchId, parsed.data.seq, parsed.data.targetId);
        if (!r.ok && r.code === "RATE_LIMIT") {
          // ignore quietly to keep UX smooth
        }
        break;
      }
      case "REMATCH_DECISION": {
        const parsed = RematchSchema.safeParse(msg.payload);
        if (!parsed.success) return;
        engine.handleRematchDecision(authed.userId, parsed.data.matchId, parsed.data.wantRematch);
        break;
      }
      case "PING": {
        send(ws, { type: "PONG", payload: { t: msg.payload.t } });
        break;
      }
      default:
        break;
    }
  });

  ws.on("close", () => {
    const c = clients.get(ws);
    if (!c) return;

    // remove from queue if queued
    queue.onDisconnect(c.userId);

    // detach from match (pause/reconnect logic lives in engine)
    engine.detachClient(c.userId);

    clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  startEscrowListener(escrows, clients);
});
