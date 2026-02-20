import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";

import { send, parseClientMessage, AuthSchema, TapSchema, RematchSchema, type AuthedClient } from "./ws";
import { MatchEngine, COUNTDOWN_MS, MATCH_DURATION_MS, RECONNECT_WINDOW_MS, REMATCH_WINDOW_MS } from "./matchEngine";
import { MatchmakingQueue } from "./matchmaking";

const PORT = Number(process.env.API_PORT || 4000);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// Connected clients by ws
const clients = new Map<any, AuthedClient>(); // ws -> client

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
      send(ws as any, { type: "ERROR", payload: { code: "BAD_MESSAGE", message: "Invalid message" } });
      return;
    }

    // AUTH is required first
    if (!authed) {
      if (msg.type !== "AUTH") {
        send(ws as any, { type: "ERROR", payload: { code: "NOT_AUTHED", message: "AUTH required" } });
        return;
      }
      const parsed = AuthSchema.safeParse(msg.payload);
      if (!parsed.success) {
        send(ws as any, { type: "ERROR", payload: { code: "BAD_AUTH", message: "Invalid auth payload" } });
        return;
      }

      authed = {
        ws: ws as any,
        userId: parsed.data.userId,
        username: parsed.data.username,
        connectedAt: Date.now(),
        lastSeqByMatch: new Map()
      };
      clients.set(ws as any, authed);

      // attach (reconnect) if needed
      engine.attachClient(authed.userId, authed);

      send(ws as any, { type: "AUTH_OK", payload: { userId: authed.userId, username: authed.username } });
      return;
    }

    // after auth
    switch (msg.type) {
      case "JOIN_QUEUE": {
        const res = queue.join(authed);
        if (!res.ok) {
          send(ws as any, { type: "ERROR", payload: { code: res.code, message: "Unable to join queue" } });
          return;
        }
        send(ws as any, { type: "QUEUE_STATUS", payload: { status: "SEARCHING" } });
        break;
      }
      case "LEAVE_QUEUE": {
        queue.leave(authed.userId);
        send(ws as any, { type: "QUEUE_STATUS", payload: { status: "IDLE" } });
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
        send(ws as any, { type: "PONG", payload: { t: msg.payload.t } });
        break;
      }
      default:
        break;
    }
  });

  ws.on("close", () => {
    const c = clients.get(ws as any);
    if (!c) return;

    // remove from queue if queued
    queue.onDisconnect(c.userId);

    // detach from match (pause/reconnect logic lives in engine)
    engine.detachClient(c.userId);

    clients.delete(ws as any);
  });
});

server.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
