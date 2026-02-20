# Reflex Arena

**Competitive settlement infrastructure for skill-based digital competition. Built on Avalanche.**

Reflex Arena is a server-authoritative 1v1 competitive platform that combines real-time gameplay with transparent, verifiable settlement. Match outcomes are cryptographically anchored on Avalanche’s C-Chain to create tamper-evident proof without compromising user privacy.

It feels like esports.  
It settles like fintech.  
It verifies like blockchain.

---

## Overview

Reflex Arena addresses a core issue in competitive gaming platforms: centralized trust in outcome adjudication and settlement.

Existing head-to-head platforms rely entirely on internal ledgers and operator discretion. Reflex Arena introduces verifiable settlement by anchoring deterministic match result hashes on Avalanche, creating a publicly auditable integrity layer.

The MVP focuses on:

- 1v1 reflex-based duels  
- Fixed structured entry pools  
- Transparent 4% platform fee  
- Deterministic server-authoritative scoring  
- On-chain result anchoring (Avalanche Fuji for MVP)  
- Privacy-preserving user balances  

---

## Architecture

Reflex Arena is designed as a layered system:

### 1. Gameplay Layer (Off-Chain)
- Real-time server-authoritative engine
- Deterministic scoring
- No RNG
- No client-side trust
- Forfeit and reconnection handling

Blockchain is intentionally excluded from the live gameplay loop to preserve latency and competitive integrity.

---

### 2. Settlement Layer (Application Layer)
- Fixed stake per match
- Transparent fee calculation
- Internal ledger updates
- Result object generation
- Match result hashing (keccak256)

---

### 3. Verification Layer (Avalanche C-Chain)
- Smart contract deployed on Avalanche Fuji (testnet)
- Match result hashes anchored via contract event
- Publicly verifiable transaction records
- Minimal on-chain logic to reduce attack surface

The smart contract emits an event containing:

- Match ID hash  
- Result hash  
- Timestamp  

This creates tamper-evident outcome records.

---

## Why Avalanche

Avalanche was selected for:

- Fast finality  
- Low gas costs  
- EVM compatibility (Hardhat-based development)  
- Stablecoin ecosystem (future tournament support)  
- Scalability for high-frequency anchoring  

Reflex Arena demonstrates practical gaming infrastructure usage of Avalanche beyond speculative token mechanics.

---

## MVP Scope

The MVP intentionally limits complexity to ensure clarity and execution quality.

### Included:
- Public 1v1 reflex duel
- Fixed entry pool (e.g., 0.1 AVAX equivalent demo credit)
- Transparent 4% platform fee
- Deterministic scoring engine
- Match history
- Avalanche Fuji result anchoring

### Excluded (Future Milestones):
- Variable stake pools
- Stablecoin settlement
- Spectator prediction markets
- Team tournaments
- Console integrations
- Infrastructure SDK

---

## Economic Model (MVP)

Example:

Stake per player: 0.1  
Total pool: 0.2  
Platform fee (4%): 0.008  
Winner receives: 0.192  

No hidden multipliers.  
No dynamic odds.  
No house manipulation.

Revenue scales linearly with match volume.

---

## Security Model

Security priorities include:

- Server-authoritative scoring
- Deterministic match logic
- Minimal smart contract surface area
- No dynamic odds mechanisms
- No RNG-based payout systems
- Clear settlement math

The smart contract does not:
- Calculate gameplay outcomes
- Manage complex pools
- Introduce probability mechanics

This reduces contract risk and improves auditability.

---

## Privacy Design

- Wallet addresses are not displayed publicly  
- User balances remain private  
- Leaderboards show usernames only  
- No public earnings broadcasting  

This reduces targeting risk and improves user safety.

---

## Repository Structure

reflex-arena/
├── apps/
│   ├── web/        # Next.js frontend
│   └── api/        # Node + WebSocket backend
├── contracts/      # Hardhat + Solidity smart contracts
├── packages/
│   └── shared/     # Shared types
├── pnpm-workspace.yaml
└── README.md

---

## Local Development

### 1. Install dependencies
pnpm install

### 2. Start backend
pnpm -C apps/api dev

### 3. Start frontend
pnpm -C apps/web dev

Frontend runs at:
http://localhost:3000

Backend health check:
http://localhost:4000/health

---

## Smart Contract Deployment (Fuji Testnet)

Ensure your `.env` contains:

FUJI_RPC=https://api.avax-test.network/ext/bc/C/rpc
ANCHOR_WALLET_PRIVATE_KEY=your_private_key

Deploy:

cd contracts
pnpm exec hardhat run scripts/deploy.ts --network fuji

Record the deployed contract address and update:

ARENA_ANCHOR_ADDRESS=0x...

---

## Roadmap

### Phase 1 – MVP
- 1v1 reflex duel
- Fixed structured pools
- Avalanche result anchoring
- Transparent fee display

### Phase 2
- Tiered pools
- Stablecoin settlement
- Team matches
- Tournament brackets

### Phase 3
- Spectator participation layer
- Settlement APIs
- Third-party game integration SDK
- Console ecosystem expansion

---

## Vision

Reflex Arena begins with a focused reflex duel.

Its long-term vision is to become programmable competitive settlement infrastructure — where digital skill-based competition is transparent, verifiable, and scalable.

Built on Avalanche.  
Engineered for trust.  
Designed for serious competitors.

---

## License

MIT License
