# Veilpay - Quick Reference

## Commands

```bash
# Infrastructure
pnpm db:up              # Start PostgreSQL, Redis, Anvil
pnpm db:down            # Stop all services
pnpm db:migrate         # Run database migrations

# Development
pnpm backend:dev        # Start backend API (port 3001)
pnpm indexer:dev        # Start blockchain indexer
pnpm consumer:dev       # Start mobile app (Expo)

# Build & Test
pnpm build              # Build all packages
pnpm lint               # Lint all code
pnpm typecheck          # Type check all packages
pnpm test               # Run all tests
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Backend API | 3001 | Express REST API |
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Queue & cache |
| Anvil | 8545 | Local EVM testnet |

## Environment Variables

### Required
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for JWT signing (min 32 chars)
- `API_KEY_SALT` - Salt for API key hashing

### Blockchain RPCs
- `RPC_ETHEREUM` - Ethereum RPC URL
- `RPC_POLYGON` - Polygon RPC URL
- `RPC_ARBITRUM` - Arbitrum RPC URL

## Project Structure

```
apps/
├── consumer-app/   # Mobile wallet (Expo)
├── backend/        # API server
├── indexer/        # Event indexer
└── frontend/       # Merchant dashboard

packages/
├── shared/         # Shared types
├── contracts-evm/  # Solidity
└── contracts-solana/ # Anchor
```

## Current Status

For the authoritative, maintained breakdown of what is implemented, gated, and
planned, see [Current status](docs/getting-started/current-status.md).

**Implemented**
- Consumer wallet with multi-chain flows (EVM, Solana, Stellar)
- Backend API with authentication, rate limiting, and typed validation
- Webhook dispatcher (queue, worker, delivery, idempotent expiry events)
- Indexer with chain event parsing and payment-confirmation detection
- Redis-backed infrastructure and BullMQ jobs; Docker infrastructure

**Gated / not production-live**
- Stellar SPP is testnet-only and fail-closed on mainnet pending audit and
  operational gates
- Solana/EVM privacy-pool contracts are scaffolding; proof verification is
  intentionally fail-closed pending verifier work

See [ROADMAP.md](plans/ROADMAP.md) for planned tracks.
