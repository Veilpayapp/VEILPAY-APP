# VeilPay - Multi-Chain Privacy Payment Protocol

A privacy-focused payment protocol supporting multiple blockchains (EVM, Solana, Aptos) with stealth addresses and zero-knowledge proofs.

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
│   ├── contracts-solana/ # Anchor programs
│   └── contracts-aptos/  # Move modules
├── plans/                # Project documentation
└── docker-compose.yml    # Local infrastructure
```

## Key Features

### Consumer App
- Multi-chain wallet (EVM, Solana, Aptos)
- Privacy-first design
- Stealth addresses for all transactions
- Zero-knowledge proof option (MAX privacy)
- Real-time balance tracking
- Transaction history

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

- [Roadmap & Future Work](plans/ROADMAP.md)
- [Consumer App Phase 1 Plan](plans/veilpay-consumer-phase1.md)
- [Coordinated Fix Plan](plans/veilpay-coordinated-fix-plan.md)

## License

Private - All rights reserved.
