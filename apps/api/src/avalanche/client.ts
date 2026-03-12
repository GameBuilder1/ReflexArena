import { JsonRpcProvider, Wallet, Contract } from "ethers";
import type { ChainConfig } from "./types";

const FUJI_CHAIN_ID = 43113;
const FUJI_EXPLORER = "https://testnet.snowtrace.io";

export const ESCROW_ABI = [
  "function deposit() external payable",
  "function withdraw(uint256 amount) external",
  "function settle(bytes32 matchId, address winner, address loser, uint256 stakeWei) external",
  "function balances(address) external view returns (uint256)",
  "function settled(bytes32) external view returns (bool)",
  "event MatchSettled(bytes32 indexed matchId, address indexed winner, address indexed loser, uint256 stakeWei, uint256 payoutWei)"
];

export function getChainConfig(): ChainConfig {
  return {
    chainId: FUJI_CHAIN_ID,
    name: "Avalanche Fuji C-Chain",
    rpcUrl: process.env.AVALANCHE_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc",
    explorerBaseUrl: FUJI_EXPLORER,
  };
}

export function getProvider(): JsonRpcProvider {
  const { rpcUrl } = getChainConfig();
  return new JsonRpcProvider(rpcUrl);
}

export function getSigner(): Wallet {
  const key = process.env.AVALANCHE_PRIVATE_KEY;
  if (!key) throw new Error("AVALANCHE_PRIVATE_KEY is not set");
  return new Wallet(key, getProvider());
}

export function getEscrowContract(): Contract {
  const address = process.env.AVALANCHE_ESCROW_ADDRESS;
  if (!address) throw new Error("AVALANCHE_ESCROW_ADDRESS is not set");
  return new Contract(address, ESCROW_ABI, getSigner());
}

export async function waitForTx(hash: string) {
  const provider = getProvider();
  return provider.waitForTransaction(hash, 1);
}
