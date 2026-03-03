export type ChainConfig = {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerBaseUrl: string;
};

export type EscrowStatus = "NONE" | "CREATED" | "FUNDED" | "READY" | "SETTLED" | "ERROR";

export type EscrowState = {
  matchId: string;
  escrowId?: string;
  contractAddress: string;
  stakeWei: bigint;
  playerA?: string;
  playerB?: string;
  fundedA: boolean;
  fundedB: boolean;
  status: EscrowStatus;
  createTxHash?: string;
  joinTxHashA?: string;
  joinTxHashB?: string;
  settleTxHash?: string;
  winnerUserId?: string;
};

export type CreateMatchRequest = {
  matchId: string;
  stakeAvax: string;
  playerAUserId: string;
  playerBUserId?: string;
};

export type CreateMatchResponse = {
  matchId: string;
  escrowId: string;
  txHash: string | null;
  stakeAvax: string;
  status: EscrowStatus;
};

export type JoinMatchRequest = {
  matchId: string;
  userId: string;
};

export type JoinMatchResponse = {
  matchId: string;
  userId: string;
  txHash: string;
  fundedA: boolean;
  fundedB: boolean;
  status: EscrowStatus;
};

export type SettleMatchRequest = {
  matchId: string;
  winnerUserId: string;
};

export type SettleMatchResponse = {
  matchId: string;
  winnerUserId: string;
  txHash: string;
  status: EscrowStatus;
};
