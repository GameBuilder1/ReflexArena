import { randomUUID } from "crypto";
import type { AuthedClient } from "./ws";
import type { TargetSpawn, TargetKind, MatchEndPayload } from "./types";

/**
 * MVP constants (hardcoded)
 */
export const STAKE = 0.1;
export const FEE_PERCENT = 0.04;
export const MATCH_DURATION_MS = 60_000;
export const COUNTDOWN_MS = 3_000;
export const RECONNECT_WINDOW_MS = 10_000;
export const REMATCH_WINDOW_MS = 10_000;
export const SPAWN_INTERVAL_MS = 700;
export const STATE_TICK_MS = 200; // 5x/sec
export const TAP_RATE_LIMIT_PER_SEC = 20;

type PlayerSlot = "A" | "B";

export type Player = {
  userId: string;
  username: string;
  client?: AuthedClient; // undefined when disconnected
};

export type MatchStatus = "COUNTDOWN" | "LIVE" | "PAUSED" | "ENDED" | "REMATCH_WINDOW";

export type Match = {
  matchId: string;
  createdTs: number;

  status: MatchStatus;
  startTs: number | null;
  endTs: number | null;

  playerA: Player;
  playerB: Player;

  scoreA: number;
  scoreB: number;

  // target registry
  activeTargets: Map<string, TargetSpawn>;

  // timers/intervals
  countdownTimer?: NodeJS.Timeout;
  spawnInterval?: NodeJS.Timeout;
  stateInterval?: NodeJS.Timeout;
  matchTimeout?: NodeJS.Timeout;

  // pause + reconnect
  pausedAt?: number;
  remainingMs?: number;
  reconnectTimer?: NodeJS.Timeout;

  // rematch handshake
  rematchA?: boolean;
  rematchB?: boolean;
  rematchTimer?: NodeJS.Timeout;

  // tap rate limiting
  tapsThisSecondA: { t: number; count: number };
  tapsThisSecondB: { t: number; count: number };
};

export type EngineCallbacks = {
  onMatchFound: (match: Match, forPlayer: PlayerSlot) => void;
  onMatchStart: (match: Match) => void;
  onSpawn: (match: Match, target: TargetSpawn) => void;
  onState: (match: Match, timeLeftMs: number) => void;
  onPaused: (match: Match) => void;
  onResumed: (match: Match) => void;
  onEnded: (match: Match, payloadA: MatchEndPayload, payloadB: MatchEndPayload) => void;
  onRematchOffer: (match: Match) => void;
  onRematchWait: (match: Match) => void;
  onRematchStarting: (match: Match) => void;
};

export class MatchEngine {
  private matches = new Map<string, Match>();
  private userToMatch = new Map<string, string>(); // userId -> matchId

  constructor(private cb: EngineCallbacks) {}

  getMatch(matchId: string) {
    return this.matches.get(matchId);
  }

  getUserMatch(userId: string): Match | undefined {
    const id = this.userToMatch.get(userId);
    return id ? this.matches.get(id) : undefined;
  }

  createMatch(playerA: AuthedClient, playerB: AuthedClient): Match {
    const matchId = randomUUID();
    const now = Date.now();

    const match: Match = {
      matchId,
      createdTs: now,
      status: "COUNTDOWN",
      startTs: null,
      endTs: null,
      playerA: { userId: playerA.userId, username: playerA.username, client: playerA },
      playerB: { userId: playerB.userId, username: playerB.username, client: playerB },
      scoreA: 0,
      scoreB: 0,
      activeTargets: new Map(),
      tapsThisSecondA: { t: now, count: 0 },
      tapsThisSecondB: { t: now, count: 0 }
    };

    this.matches.set(matchId, match);
    this.userToMatch.set(playerA.userId, matchId);
    this.userToMatch.set(playerB.userId, matchId);

    // notify found (per player to include opponent)
    this.cb.onMatchFound(match, "A");
    this.cb.onMatchFound(match, "B");

    this.startCountdown(match);
    return match;
  }

  attachClient(userId: string, client: AuthedClient) {
    const match = this.getUserMatch(userId);
    if (!match) return;

    if (match.playerA.userId === userId) match.playerA.client = client;
    if (match.playerB.userId === userId) match.playerB.client = client;

    // if match was paused because of disconnect, resume if both back
    if (match.status === "PAUSED" && match.playerA.client && match.playerB.client) {
      this.resumeMatch(match);
    }
  }

  detachClient(userId: string) {
    const match = this.getUserMatch(userId);
    if (!match) return;

    if (match.playerA.userId === userId) match.playerA.client = undefined;
    if (match.playerB.userId === userId) match.playerB.client = undefined;

    // Only pause if LIVE/COUNTDOWN (countdown pause is acceptable)
    if ((match.status === "LIVE" || match.status === "COUNTDOWN") && !(match.status === "ENDED")) {
      this.pauseMatch(match);
    }
  }

  handleTap(userId: string, matchId: string, seq: number, targetId: string) {
    const match = this.matches.get(matchId);
    if (!match) return { ok: false, code: "NO_MATCH" as const };

    if (match.status !== "LIVE") return { ok: false, code: "NOT_LIVE" as const };

    const slot: PlayerSlot | null =
      match.playerA.userId === userId ? "A" : match.playerB.userId === userId ? "B" : null;
    if (!slot) return { ok: false, code: "NOT_IN_MATCH" as const };

    const player = slot === "A" ? match.playerA : match.playerB;
    if (!player.client) return { ok: false, code: "DISCONNECTED" as const };

    // rate limit
    const now = Date.now();
    const bucket = slot === "A" ? match.tapsThisSecondA : match.tapsThisSecondB;
    if (now - bucket.t >= 1000) {
      bucket.t = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    if (bucket.count > TAP_RATE_LIMIT_PER_SEC) return { ok: false, code: "RATE_LIMIT" as const };

    // seq monotonic
    const lastSeq = player.client.lastSeqByMatch.get(matchId) ?? 0;
    if (seq <= lastSeq) return { ok: false, code: "BAD_SEQ" as const };
    player.client.lastSeqByMatch.set(matchId, seq);

    const target = match.activeTargets.get(targetId);
    if (!target) return { ok: false, code: "NO_TARGET" as const };
    if (now > target.expiresTs) {
      match.activeTargets.delete(targetId);
      return { ok: false, code: "EXPIRED" as const };
    }

    // apply score
    if (target.kind === "VALID") {
      if (slot === "A") match.scoreA += 1;
      else match.scoreB += 1;
    } else {
      // TRAP -> -1, min 0
      if (slot === "A") match.scoreA = Math.max(0, match.scoreA - 1);
      else match.scoreB = Math.max(0, match.scoreB - 1);
    }

    // one target counts once
    match.activeTargets.delete(targetId);

    return { ok: true as const };
  }

  handleRematchDecision(userId: string, matchId: string, want: boolean) {
    const match = this.matches.get(matchId);
    if (!match) return;

    if (match.status !== "REMATCH_WINDOW") return;

    if (match.playerA.userId === userId) match.rematchA = want;
    if (match.playerB.userId === userId) match.rematchB = want;

    // if either says no -> end rematch window immediately
    if (match.rematchA === false || match.rematchB === false) {
      this.cleanupRematch(match);
      return;
    }

    // if both yes -> restart
    if (match.rematchA === true && match.rematchB === true) {
      this.cb.onRematchStarting(match);
      this.startCountdown(match, true);
    } else {
      this.cb.onRematchWait(match);
    }
  }

  // ---------- internals ----------

  private startCountdown(match: Match, isRematch = false) {
    // clear any old timers
    this.clearTimers(match);

    match.status = "COUNTDOWN";
    match.startTs = null;
    match.endTs = null;
    match.scoreA = 0;
    match.scoreB = 0;
    match.activeTargets.clear();
    match.remainingMs = MATCH_DURATION_MS;
    match.pausedAt = undefined;
    match.rematchA = undefined;
    match.rematchB = undefined;

    match.countdownTimer = setTimeout(() => {
      this.startMatch(match);
    }, COUNTDOWN_MS);

    if (!isRematch) {
      // initial start already has MATCH_FOUND; rematch will have REMATCH_STARTING messaging
      // Callback for match start is in startMatch()
    }
  }

  private startMatch(match: Match) {
    const now = Date.now();
    match.status = "LIVE";
    match.startTs = now;
    match.remainingMs = MATCH_DURATION_MS;

    this.cb.onMatchStart(match);

    // spawn loop
    match.spawnInterval = setInterval(() => {
      if (match.status !== "LIVE") return;
      const target = this.spawnTarget();
      match.activeTargets.set(target.targetId, target);
      this.cb.onSpawn(match, target);
    }, SPAWN_INTERVAL_MS);

    // state tick
    match.stateInterval = setInterval(() => {
      if (match.status !== "LIVE") return;
      const left = this.computeTimeLeft(match);
      this.cb.onState(match, left);
    }, STATE_TICK_MS);

    // match end timer
    match.matchTimeout = setTimeout(() => {
      this.endMatch(match, "TIME");
    }, MATCH_DURATION_MS);
  }

  private pauseMatch(match: Match) {
    if (match.status === "ENDED") return;
    if (match.status === "PAUSED") return;

    // pause countdown or live
    const now = Date.now();
    match.status = "PAUSED";

    // compute remaining time if live
    if (match.startTs) {
      match.remainingMs = this.computeTimeLeft(match);
      match.pausedAt = now;
    }

    // stop timers that impact gameplay clock
    this.stopLiveTimers(match);

    this.cb.onPaused(match);

    // start reconnect window timer
    match.reconnectTimer = setTimeout(() => {
      // if either still disconnected -> forfeit
      const aUp = !!match.playerA.client;
      const bUp = !!match.playerB.client;
      if (!aUp || !bUp) {
        // determine forfeit winner/loser
        if (!aUp && bUp) this.endMatch(match, "FORFEIT_A");
        else if (aUp && !bUp) this.endMatch(match, "FORFEIT_B");
        else this.endMatch(match, "FORFEIT_BOTH");
      } else {
        this.resumeMatch(match);
      }
    }, RECONNECT_WINDOW_MS);
  }

  private resumeMatch(match: Match) {
    if (match.status !== "PAUSED") return;

    // clear reconnect timer
    if (match.reconnectTimer) clearTimeout(match.reconnectTimer);
    match.reconnectTimer = undefined;

    // restore timers with remaining time
    match.status = "LIVE";
    this.cb.onResumed(match);

    // restart spawn/state loops
    match.spawnInterval = setInterval(() => {
      if (match.status !== "LIVE") return;
      const target = this.spawnTarget();
      match.activeTargets.set(target.targetId, target);
      this.cb.onSpawn(match, target);
    }, SPAWN_INTERVAL_MS);

    match.stateInterval = setInterval(() => {
      if (match.status !== "LIVE") return;
      const left = this.computeTimeLeft(match);
      this.cb.onState(match, left);
    }, STATE_TICK_MS);

    // restart end timer using remaining
    const remaining = match.remainingMs ?? MATCH_DURATION_MS;
    match.matchTimeout = setTimeout(() => {
      this.endMatch(match, "TIME");
    }, remaining);
  }

  private computeTimeLeft(match: Match): number {
    if (match.status === "PAUSED") return match.remainingMs ?? MATCH_DURATION_MS;
    if (!match.startTs) return MATCH_DURATION_MS;
    const elapsed = Date.now() - match.startTs;
    const left = (match.remainingMs ?? MATCH_DURATION_MS) - elapsed;
    return Math.max(0, left);
  }

  private endMatch(
    match: Match,
    reason: "TIME" | "FORFEIT_A" | "FORFEIT_B" | "FORFEIT_BOTH"
  ) {
    if (match.status === "ENDED") return;
    match.status = "ENDED";
    match.endTs = Date.now();

    this.clearTimers(match);

    // compute outcomes
    const pot = STAKE * 2;
    const fee = pot * FEE_PERCENT;
    const winnerReceives = pot - fee;

    const aScore = match.scoreA;
    const bScore = match.scoreB;

    let outcomeA: MatchEndPayload["outcome"] = "DRAW";
    let outcomeB: MatchEndPayload["outcome"] = "DRAW";

    if (reason === "TIME") {
      if (aScore > bScore) {
        outcomeA = "WIN";
        outcomeB = "LOSS";
      } else if (bScore > aScore) {
        outcomeA = "LOSS";
        outcomeB = "WIN";
      }
    } else if (reason === "FORFEIT_A") {
      outcomeA = "FORFEIT_LOSS";
      outcomeB = "FORFEIT_WIN";
    } else if (reason === "FORFEIT_B") {
      outcomeA = "FORFEIT_WIN";
      outcomeB = "FORFEIT_LOSS";
    } else if (reason === "FORFEIT_BOTH") {
      outcomeA = "DRAW";
      outcomeB = "DRAW";
    }

    const payloadA: MatchEndPayload = {
      matchId: match.matchId,
      outcome: outcomeA,
      yourScore: aScore,
      oppScore: bScore,
      stake: STAKE,
      feePercent: FEE_PERCENT,
      pot,
      fee,
      winnerReceives,
      endedTs: match.endTs
    };

    const payloadB: MatchEndPayload = {
      matchId: match.matchId,
      outcome: outcomeB,
      yourScore: bScore,
      oppScore: aScore,
      stake: STAKE,
      feePercent: FEE_PERCENT,
      pot,
      fee,
      winnerReceives,
      endedTs: match.endTs
    };

    this.cb.onEnded(match, payloadA, payloadB);

    // offer rematch window (only if both clients connected)
    match.status = "REMATCH_WINDOW";
    this.cb.onRematchOffer(match);

    match.rematchTimer = setTimeout(() => {
      this.cleanupRematch(match);
    }, REMATCH_WINDOW_MS);
  }

  private cleanupRematch(match: Match) {
    if (match.rematchTimer) clearTimeout(match.rematchTimer);
    match.rematchTimer = undefined;

    // final cleanup for match and user mappings
    this.matches.delete(match.matchId);
    this.userToMatch.delete(match.playerA.userId);
    this.userToMatch.delete(match.playerB.userId);
  }

  private spawnTarget(): TargetSpawn {
    const targetId = randomUUID();
    const kind: TargetKind = Math.random() < 0.78 ? "VALID" : "TRAP"; // deterministic enough for MVP
    const x = Math.random();
    const y = Math.random();
    const expiresTs = Date.now() + 900; // each target alive < 1s
    return { targetId, kind, x, y, expiresTs };
  }

  private stopLiveTimers(match: Match) {
    if (match.spawnInterval) clearInterval(match.spawnInterval);
    if (match.stateInterval) clearInterval(match.stateInterval);
    if (match.matchTimeout) clearTimeout(match.matchTimeout);
    match.spawnInterval = undefined;
    match.stateInterval = undefined;
    match.matchTimeout = undefined;

    // also clear countdown if pausing during countdown
    if (match.countdownTimer) clearTimeout(match.countdownTimer);
    match.countdownTimer = undefined;
  }

  private clearTimers(match: Match) {
    this.stopLiveTimers(match);
    if (match.reconnectTimer) clearTimeout(match.reconnectTimer);
    if (match.rematchTimer) clearTimeout(match.rematchTimer);
    match.reconnectTimer = undefined;
    match.rematchTimer = undefined;
  }
}
