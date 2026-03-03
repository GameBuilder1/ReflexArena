import { keccak256, toUtf8Bytes } from "ethers";
import { getEscrowContract, waitForTx } from "./client";
import type { EscrowState, EscrowStatus } from "./types";

/** Convert a string matchId to a bytes32 hex string via keccak256. */
export function matchIdToBytes32(matchId: string): string {
  return keccak256(toUtf8Bytes(matchId));
}

/**
 * Record an escrow in the provided state object.
 * The ReflexArenaEscrow contract has no on-chain "create" method; we track creation in memory
 * and generate the escrowId deterministically from the matchId.
 */
export async function createEscrow(
  state: EscrowState,
  matchId: string,
  stakeWei: bigint,
  playerAUserId: string,
  playerBUserId?: string
): Promise<{ escrowId: string; txHash: null }> {
  const escrowId = matchIdToBytes32(matchId);
  state.escrowId = escrowId;
  state.stakeWei = stakeWei;
  state.playerA = playerAUserId;
  state.playerB = playerBUserId;
  state.status = "CREATED";
  return { escrowId, txHash: null };
}

/**
 * Fund one side of the escrow.  The API signer calls `deposit({ value: stakeWei })` on behalf
 * of the joining player.  Idempotent: returns the existing txHash if the player already funded.
 */
export async function joinEscrow(
  state: EscrowState,
  userId: string
): Promise<{ txHash: string; fundedA: boolean; fundedB: boolean; status: EscrowStatus }> {
  // Idempotency check
  if (userId === state.playerA && state.fundedA && state.joinTxHashA) {
    return { txHash: state.joinTxHashA, fundedA: true, fundedB: state.fundedB, status: state.status };
  }
  if (userId === state.playerB && state.fundedB && state.joinTxHashB) {
    return { txHash: state.joinTxHashB, fundedA: state.fundedA, fundedB: true, status: state.status };
  }

  const contract = getEscrowContract();
  const tx = await contract.getFunction("deposit")({ value: state.stakeWei });
  const receipt = await waitForTx(tx.hash);
  const txHash = receipt?.hash ?? tx.hash;

  if (userId === state.playerA) {
    state.fundedA = true;
    state.joinTxHashA = txHash;
  } else if (userId === state.playerB) {
    state.fundedB = true;
    state.joinTxHashB = txHash;
  }

  state.status = state.fundedA && state.fundedB ? "READY" : "FUNDED";
  return { txHash, fundedA: state.fundedA, fundedB: state.fundedB, status: state.status };
}

/**
 * Settle the escrow.  Calls `settle(bytes32, winner, loser, stakeWei)` on the contract.
 * Idempotent: returns the existing txHash if already settled.
 *
 * NOTE (MVP): The contract requires winner != loser and balances[loser] >= stakeWei.
 * In this single-wallet custodial model the signer deposits on behalf of both players,
 * so the contract-level settle will only succeed when the loser's derived address has
 * been pre-funded (i.e., in a full multi-wallet deployment).  For testnet demos the
 * call may revert; the error is surfaced as ESCROW_ERROR via the caller.
 */
export async function settleEscrow(
  state: EscrowState,
  matchId: string,
  winnerUserId: string
): Promise<{ txHash: string; status: EscrowStatus }> {
  if (state.status === "SETTLED" && state.settleTxHash) {
    return { txHash: state.settleTxHash, status: "SETTLED" };
  }

  const loserUserId = winnerUserId === state.playerA ? state.playerB : state.playerA;
  if (!loserUserId) throw new Error("Cannot determine loser: match not fully configured");

  // Derive deterministic EVM addresses from userIds for on-chain winner/loser tracking.
  const winnerAddr = "0x" + keccak256(toUtf8Bytes("player:" + winnerUserId)).slice(-40);
  const loserAddr  = "0x" + keccak256(toUtf8Bytes("player:" + loserUserId)).slice(-40);

  const contract = getEscrowContract();
  const matchBytes32 = matchIdToBytes32(matchId);
  const tx = await contract.getFunction("settle")(matchBytes32, winnerAddr, loserAddr, state.stakeWei);
  const receipt = await waitForTx(tx.hash);
  const txHash = receipt?.hash ?? tx.hash;

  state.settleTxHash = txHash;
  state.winnerUserId = winnerUserId;
  state.status = "SETTLED";
  return { txHash, status: "SETTLED" };
}
