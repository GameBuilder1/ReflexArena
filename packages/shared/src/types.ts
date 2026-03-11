Generate TypeScript types for the Reflex Arena backend.

We are building a mobile-first social reflex challenge platform.

Create types for:

User
Profile
Score
Friendship
Challenge

Constraints:

User
- userId: string
- email?: string
- createdAt: string

Profile
- userId
- username
- avatarUrl?
- bestScore
- averageReactionMs
- accuracyPct
- wins
- losses
- createdAt
- updatedAt

Score
- scoreId
- userId
- challengeType: "REFLEX_TAP_V1"
- score
- validHits
- trapHits
- misses
- accuracyPct
- averageReactionMs
- durationSec
- createdAt

Friendship
- friendshipId
- requesterUserId
- addresseeUserId
- status: "PENDING" | "ACCEPTED" | "BLOCKED"
- createdAt
- updatedAt

Challenge
- challengeId
- fromUserId
- toUserId
- challengeType: "BEAT_MY_SCORE"
- targetScore
- scoreId
- status: "PENDING" | "COMPLETED" | "EXPIRED" | "DECLINED"
- completedScoreId?
- createdAt
- expiresAt?
- updatedAt

Export all types.

export type ClientToServer =
  | { type: "AUTH"; payload: { userId: string; username: string } }
  | { type: "JOIN_QUEUE"; payload: {} }
  | { type: "LEAVE_QUEUE"; payload: {} }
  | { type: "TAP"; payload: { matchId: string; seq: number; targetId: string; clientTs: number } }
  | { type: "REMATCH_DECISION"; payload: { matchId: string; wantRematch: boolean } }
  | { type: "PING"; payload: { t: number } };

export type ServerToClient =
  | { type: "AUTH_OK"; payload: { userId: string; username: string } }
  | { type: "ERROR"; payload: { code: string; message: string } }
  | { type: "QUEUE_STATUS"; payload: { status: "SEARCHING" | "IDLE" } }
  | { type: "MATCH_FOUND"; payload: { matchId: string; opponentUsername: string; countdownSec: number } }
  | { type: "MATCH_START"; payload: { matchId: string; startTs: number; durationSec: number } }
  | { type: "SPAWN"; payload: { matchId: string; target: TargetSpawn } }
  | { type: "STATE_UPDATE"; payload: { matchId: string; scoreYou: number; scoreOpp: number; timeLeftMs: number } }
  | { type: "MATCH_PAUSED"; payload: { matchId: string; reason: "OPP_DISCONNECTED"; reconnectWindowSec: number } }
  | { type: "MATCH_RESUMED"; payload: { matchId: string } }
  | { type: "MATCH_END"; payload: MatchEndPayload }
  | { type: "REMATCH_OFFER"; payload: { matchId: string; windowSec: number } }
  | { type: "REMATCH_WAIT"; payload: { matchId: string; windowSec: number } }
  | { type: "REMATCH_STARTING"; payload: { matchId: string; countdownSec: number } }
  | { type: "PONG"; payload: { t: number } };

export type TargetKind = "VALID" | "TRAP";

/** Add these if they exist in your API today; otherwise keep placeholders until we paste full API code */
export type TargetSpawn = {
  id: string;
  kind: TargetKind;
  x: number;
  y: number;
  ttlMs: number;
};

export type MatchEndPayload = {
  matchId: string;
  scoreYou: number;
  scoreOpp: number;
  winner: "YOU" | "OPP" | "TIE";
};
