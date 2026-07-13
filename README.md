# Veilpay - Multi-Chain Privacy Payment Protocol

A privacy-focused, self-custody payment protocol for EVM, Solana, and Stellar.
Stealth-address primitives and encrypted notes ship today; zero-knowledge private
payments are delivered through the Stellar Private Payments (SPP) track, which is
**testnet-only and fail-closed on mainnet** until audit and operational gates are met.

> **Status:** See [Current status](docs/getting-started/current-status.md) for the
> authoritative breakdown of what is implemented, gated, and planned. Do not treat
> roadmap items as production-live.

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 9+
- Docker & Docker Compose

### Setup

```bash
# Install dependencies
pnpm install

# Start infrastructure (PostgreSQL, Redis, Anvil)
pnpm db:up

# Generate Prisma client
pnpm --filter @veilpay/backend db:generate

# Run migrations
pnpm --filter @veilpay/backend db:migrate

# Start backend API
pnpm backend:dev

# In another terminal, start the indexer
pnpm indexer:dev

# Start the consumer mobile app
pnpm consumer:dev
```

### Environment Setup

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

## Project Structure

```
veilpay/
├── apps/
│   ├── consumer-app/     # React Native mobile wallet (Expo)
│   ├── backend/          # Express API server
│   ├── indexer/          # Blockchain event indexer
│   └── frontend/         # Merchant dashboard (Next.js)
├── packages/
│   ├── shared/           # Shared types and utilities
│   ├── contracts-evm/    # Solidity contracts (Foundry)
│   └── contracts-solana/ # Anchor programs
├── plans/                # Project documentation
└── docker-compose.yml    # Local infrastructure
```

## Key Features

### Consumer App
- Multi-chain, self-custody wallet (EVM, Solana, Stellar)
- Send, receive, real-time balances, and transaction history
- Stealth-address primitives and encrypted notes
- Fiat on-ramp/off-ramp and WalletConnect v2

> Zero-knowledge private payments are provided by the Stellar Private Payments
> (SPP) track — testnet-only and fail-closed on mainnet. The Solana/EVM
> privacy-pool contracts are scaffolding and are **not** production-live (their
> proof verification is intentionally fail-closed pending verifier work). See
> [Current status](docs/getting-started/current-status.md).

### Backend API
- Merchant registration
- Invoice creation
- Payment webhooks
- Multi-chain support

### Indexer
- Real-time blockchain monitoring
- Event parsing and storage
- Payment confirmation detection

## Development

### Run All Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

### Build All Packages

```bash
pnpm build
```

## Testing

### Local Blockchain

Anvil (EVM testnet) is included in Docker Compose:

```bash
# RPC URL: http://localhost:8545
# Chain ID: 31337
```

## Documentation

- [Current status](docs/getting-started/current-status.md) — implemented vs. gated vs. planned
- [Documentation home](docs/README.md)
- [Roadmap & Future Work](plans/ROADMAP.md)
- [Security policy](SECURITY.md)

## License

Private - All rights reserved.
