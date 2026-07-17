# VeilPay — Multi-Chain Privacy Payment Protocol

A privacy-focused, self-custody payment protocol for EVM, Solana, and Stellar.
Stealth-address primitives and encrypted notes ship today; zero-knowledge private
payments are delivered through the Stellar Private Payments (SPP) track, which is
**testnet-only and fail-closed on mainnet** until audit and operational gates are met.

> **Status:** See [`docs/getting-started/current-status.md`](docs/getting-started/current-status.md)
> for the authoritative breakdown of what is implemented, gated, and planned. Do
> not treat roadmap items as production-live.

---

## Quick Start

### Prerequisites
- Node.js 20+ (see `.nvmrc`)
- pnpm 9+ (see `package.json#packageManager`)
- Docker & Docker Compose
- Foundry (for EVM contract work) — optional unless touching `packages/contracts-evm`
- Anchor / Solana toolchain — optional unless touching `packages/contracts-solana`

### One-time setup

```bash
pnpm install
git submodule update --init --recursive   # openzeppelin, forge-std, stellar-private-payments

cp .env.example .env                       # then fill in the values

pnpm db:up                                 # PostgreSQL, Redis, Anvil
pnpm --filter @veilpay/backend db:generate
pnpm --filter @veilpay/backend db:migrate
```

### Run the services

```bash
pnpm backend:dev      # Express API            (http://localhost:3001)
pnpm indexer:dev      # Blockchain event indexer
pnpm consumer:dev     # Expo mobile wallet
```

### Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build                 # backend + indexer (+ dependents)
pnpm build:full            # everything in the workspace
```

### Ports & local services

| Service     | Port | Purpose                  |
|-------------|------|--------------------------|
| Backend API | 3001 | Express REST API         |
| PostgreSQL  | 5432 | Primary database         |
| Redis       | 6379 | BullMQ queues & cache    |
| Anvil       | 8545 | Local EVM testnet (31337) |

---

## Project Structure

```
veilpay/
├── apps/
│   ├── consumer-app/                 # React Native mobile wallet (Expo)
│   ├── backend/                       # Express API server (authoritative API surface)
│   └── indexer/                       # Blockchain event indexer
├── packages/
│   ├── shared/                        # Shared types & utilities
│   ├── contracts-evm/                 # Solidity contracts (Foundry) — privacy-pool scaffolding
│   ├── contracts-solana/              # Anchor programs — scaffolding
│   ├── circuits/                      # Zero-knowledge circuits
│   ├── spp-native/                   # Stellar Private Payments native integration
│   ├── auditor/                       # Security audit harness
│   └── vendor/spp/                    # Vendored NethermindEth/stellar-private-payments (submodule)
├── docs/                              # Project documentation (+ assets/)
├── plans/                             # Roadmap, design docs, UI_AUDIT_PLAN.md
├── e2e/                               # End-to-end tests
├── scripts/graphify/                  # Graphify import scripts (one-shot tooling)
├── tsconfig/                          # Shared TS config
├── docker-compose.yml                 # Local infrastructure
└── railway.json                       # Backend deployment config
```

> Local-only (gitignored, per-developer): `.agent/`, `.agents/`, `.kilo/`,
> `.kilocode/`, `.kiro/`, `.continue/`, `.audit-evidence/`, `.expo/`,
> `graphify-out/`, `packages/antigravity-utils/`. See `.gitignore`.

> `apps/frontend/` is referenced in some legacy docs but is **not** present in the
> workspace; the consumer-facing surface today is `apps/consumer-app`.

---

## Key Features

### Consumer App (`apps/consumer-app`)
- Multi-chain, self-custody wallet (EVM, Solana, Stellar)
- Send / receive, real-time balances, transaction history
- Stealth-address primitives and encrypted notes
- Fiat on-ramp / off-ramp and WalletConnect v2

### Backend API (`apps/backend`) — authoritative
- Merchant registration & API-key auth
- Invoice creation
- Payment webhooks (queue, worker, delivery, idempotent expiry events)
- Multi-chain support
- Rate limiting & typed request validation

### Indexer (`apps/indexer`)
- Real-time blockchain monitoring
- Event parsing & storage
- Payment-confirmation detection

### Privacy payments (gated)
- Stellar Private Payments (SPP) via `packages/spp-native` + `packages/vendor/spp` —
  **testnet-only and fail-closed on mainnet**.
- EVM/Solana privacy-pool contracts in `packages/contracts-*` are scaffolding; their
  proof verification is intentionally fail-closed pending verifier work.

See [Current status](docs/getting-started/current-status.md) before relying on any
privacy feature.

---

## Workspace Scripts

| Script              | Description                                              |
|---------------------|----------------------------------------------------------|
| `pnpm dev`          | Run all `dev` tasks via Turbo                            |
| `pnpm backend:dev`  | Start backend only                                       |
| `pnpm indexer:dev`  | Start indexer only                                       |
| `pnpm consumer:dev` | Start Expo consumer app                                  |
| `pnpm db:up`        | `docker-compose up -d` (PostgreSQL, Redis, Anvil)        |
| `pnpm db:down`      | Stop Docker services                                     |
| `pnpm db:migrate`   | Run Prisma migrations against the backend DB             |
| `pnpm build`        | Build `backend` + `indexer` (+ dependents)               |
| `pnpm build:full`   | Build every workspace package                            |
| `pnpm lint`         | Turbo lint across the workspace                          |
| `pnpm typecheck`    | Turbo typecheck across the workspace                     |
| `pnpm test`         | Turbo test across the workspace                          |
| `pnpm audit:prod`   | Run the auditor harness against production config        |

---

## Environment Variables

See `.env.example`. **Required** for local dev:

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — JWT signing secret (min 32 chars)
- `API_KEY_SALT` — salt for API key hashing

**Chain RPCs:** `RPC_ETHEREUM`, `RPC_POLYGON`, `RPC_ARBITRUM` (and equivalents for
Solana / Stellar as used by the indexer and consumer app).

> Never commit secrets, private keys, mnemonics, or raw signatures. See
> [`SECURITY.md`](SECURITY.md).

---

## Submodules

| Path                                              | Source                                              |
|---------------------------------------------------|-----------------------------------------------------|
| `packages/contracts-evm/lib/openzeppelin-contracts` | github.com/OpenZeppelin/openzeppelin-contracts    |
| `packages/contracts-evm/lib/forge-std`             | github.com/foundry-rs/forge-std                    |
| `packages/vendor/spp`                              | github.com/NethermindEth/stellar-private-payments  |

Clone with `git submodule update --init --recursive`.

---

## Documentation

- [Current status](docs/getting-started/current-status.md) — implemented vs. gated vs. planned
- [Documentation home](docs/README.md)
- [Roadmap & Future Work](plans/ROADMAP.md)
- [Security policy](SECURITY.md)
- [Quick reference](QUICKSTART.md)

---

## Agent & Tooling Notes

- Architecture navigation: see [`GRAPHIFY.md`](GRAPHIFY.md). The graphify snapshot
  lives in `graphify-out/` (gitignored; regenerate via `graphify --update`).
  Import scripts live in `scripts/graphify/`.
- Agent guidance: see [`AGENTS.md`](AGENTS.md).
- Workspace package overrides and vulnerability pinning: see `pnpm.overrides` in
  [`package.json`](package.json).

## License

Private — All rights reserved.
