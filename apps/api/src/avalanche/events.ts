import type WebSocket from "ws";
import { getEscrowContract } from "./client";
import { matchIdToBytes32 } from "./escrow";
import type { EscrowState } from "./types";
import { send } from "../ws";

const POLL_INTERVAL_MS = 5_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start listening for MatchSettled events and fall back to polling every 5 s.
 * Calls the provided notify callback when a match transitions to SETTLED.
 */
export function startEscrowListener(
  escrows: Map<string, EscrowState>,
  clients: Map<WebSocket, { ws: WebSocket; userId: string }>
): void {
  // Try to set up event listener; gracefully skip if env is not configured.
  try {
    const contract = getEscrowContract();

    contract.on("MatchSettled", (matchId: string, winner: string, _loser: string, _stakeWei: bigint) => {
      for (const [mid, state] of escrows) {
        if (matchIdToBytes32(mid) === matchId && state.status !== "SETTLED") {
          state.status = "SETTLED";
          broadcastEscrowSettled(mid, state, clients);
        }
      }
    });
  } catch {
    // Env vars not set – listener disabled; polling will still run.
  }

  // Polling fallback
  pollTimer = setInterval(async () => {
    for (const [matchId, state] of escrows) {
      if (state.status === "SETTLED" || state.status === "NONE" || state.status === "ERROR") {
        continue;
      }
      try {
        const contract = getEscrowContract();
        const isSettled: boolean = await contract.getFunction("settled")(matchIdToBytes32(matchId));
        if (isSettled) {
          state.status = "SETTLED";
          broadcastEscrowSettled(matchId, state, clients);
        }
      } catch {
        // RPC failure – skip this poll cycle for this match.
      }
    }
  }, POLL_INTERVAL_MS);

  // Don't prevent process from exiting
  if (pollTimer.unref) pollTimer.unref();
}

export function stopEscrowListener(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function broadcastEscrowSettled(
  matchId: string,
  state: EscrowState,
  clients: Map<WebSocket, { ws: WebSocket; userId: string }>
): void {
  const payload = {
    matchId,
    winnerUserId: state.winnerUserId ?? "",
    txHash: state.settleTxHash ?? "",
  };
  for (const client of clients.values()) {
    send(client.ws, { type: "ESCROW_SETTLED", payload });
  }
}
