# VeilPay

Self-custody, multi-chain payments with optional privacy.

| Surface | Package | Role |
|---------|---------|------|
| **Mobile wallet** | `apps/consumer-app` | Send / receive, balances, privacy levels (Expo / React Native) |
| **API** | `apps/backend` | Merchants, invoices, webhooks, relayer |
| **Indexer** | `apps/indexer` | Chain events → payments |
| **EVM pool + verifier** | `packages/contracts-evm` | `VeilPool`, Groth16 verifier (Foundry) |
| **ZK circuits** | `packages/circuits` | Deposit + withdraw Circom circuits |
| **Solana** | `packages/contracts-solana` | Anchor pool scaffolding |
| **Stellar SPP** | `packages/spp-native` + `packages/vendor/spp` | Private XLM (testnet-gated) |
| **Shared types** | `packages/shared` | Cross-app contracts |

**Status:** product and privacy features ship with network and build gates. Authoritative “what is live” list: [`docs/getting-started/current-status.md`](docs/getting-started/current-status.md).

---

## What users can do

1. **Standard** — normal on-chain transfer (always available).
2. **Stealth** (EVM) — one-time stealth address + announcement (when privacy stack is configured).
3. **Maximum** (EVM) — ZK privacy pool deposit / withdraw (when withdraw path and contracts are ready).
4. **Private** (Stellar) — SPP shielded XLM on testnet when native pool ops are present; fail-closed on mainnet.

---

## Quick start

### Prerequisites

- Node.js 20+ (`.nvmrc`)
- pnpm 9+ (`package.json#packageManager`)
- Docker + Docker Compose
- Foundry (optional, for `packages/contracts-evm`)
- Circom + snarkjs (optional, for circuit compile)

### Setup

```bash
pnpm install
git submodule update --init --recursive

cp .env.example .env   # fill secrets — never commit real keys

pnpm db:up
pnpm --filter @veilpay/backend db:generate
pnpm --filter @veilpay/backend db:migrate
```

### Run

```bash
pnpm backend:dev      # API  → http://localhost:3001
pnpm indexer:dev      # indexer
pnpm consumer:dev     # Expo wallet
```

### Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### EVM contracts

```bash
cd packages/contracts-evm
forge test -vvv
```

### ZK circuits

```bash
cd packages/circuits
# needs circom + snarkjs on PATH
bash compile.sh          # withdraw artifacts (dev ceremony only)
pnpm test                # mocha: withdraw + deposit witnesses
```

Source of truth for the note model and public inputs:

- [`packages/circuits/withdraw.circom`](packages/circuits/withdraw.circom)
- [`packages/circuits/deposit.circom`](packages/circuits/deposit.circom)
- [`packages/circuits/docs/CIRCUIT_SECURITY.md`](packages/circuits/docs/CIRCUIT_SECURITY.md)

```
commitment    = Poseidon(nullifier, secret, amount, token)
nullifierHash = Poseidon(nullifier)
```

Withdraw public inputs (order is load-bearing):

`[merkleRoot, nullifierHash, recipient, amount, token]`

> **Dev keys only:** `compile.sh` produces dogfood Groth16 keys. Do not use them for mainnet. See [`SECURITY.md`](SECURITY.md) and ceremony gates.

---

## Repo layout

```
apps/
  consumer-app/     # Mobile wallet (authoritative UI)
  backend/          # Merchant + relayer API (authoritative API)
  indexer/          # Chain indexing
packages/
  circuits/         # Circom deposit + withdraw
  contracts-evm/    # VeilPool, Groth16Verifier
  contracts-solana/ # Solana programs
  spp-native/       # Stellar private payments native bridge
  vendor/spp/       # Vendored SPP upstream (submodule)
  shared/           # Shared types
docs/               # Product & architecture docs
plans/              # Active roadmap (ROADMAP.md, specs)
e2e/                # Cross-service e2e
```

Local-only (gitignored): `.kilo/`, `.kilocode/`, `.kiro/`, `.agent/`, `.agents/`, `graphify-out/`, `coverage/`, `node_modules/`, `build/`.

---

## Scripts (workspace)

| Command | Description |
|---------|-------------|
| `pnpm backend:dev` | Backend API |
| `pnpm indexer:dev` | Indexer |
| `pnpm consumer:dev` | Expo consumer app |
| `pnpm db:up` / `db:down` | Docker Postgres, Redis, Anvil |
| `pnpm db:migrate` | Prisma migrations |
| `pnpm test` / `lint` / `typecheck` / `build` | Turbo quality gates |

---

## Environment

See [`.env.example`](.env.example). Minimum for local API:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres |
| `REDIS_URL` | Redis / queues |
| `JWT_SECRET` | Session/JWT (≥ 32 chars) |
| `API_KEY_SALT` | Merchant API key hashing |

Chain RPCs and privacy contract addresses are documented in [`docs/reference/environment-variables.md`](docs/reference/environment-variables.md).

**Never** commit secrets, private keys, mnemonics, or raw signatures.

---

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/README.md`](docs/README.md) | Docs home |
| [`docs/getting-started/current-status.md`](docs/getting-started/current-status.md) | Live vs gated vs planned |
| [`docs/protocol/privacy-levels.md`](docs/protocol/privacy-levels.md) | Standard / stealth / max / private |
| [`SECURITY.md`](SECURITY.md) | Security policy & threat model |
| [`packages/circuits/docs/CIRCUIT_SECURITY.md`](packages/circuits/docs/CIRCUIT_SECURITY.md) | ZK note model |
| [`docs/security/ceremony-and-audit-gates.md`](docs/security/ceremony-and-audit-gates.md) | SEC-008 / SEC-011 gates |
| [`plans/ROADMAP.md`](plans/ROADMAP.md) | Product roadmap |
| [`QUICKSTART.md`](QUICKSTART.md) | Short local cheat sheet |

---

## Submodules

```bash
git submodule update --init --recursive
```

| Path | Upstream |
|------|----------|
| `packages/contracts-evm/lib/openzeppelin-contracts` | OpenZeppelin |
| `packages/contracts-evm/lib/forge-std` | Foundry std |
| `packages/vendor/spp` | Nethermind Stellar Private Payments |

---

## License

Private — all rights reserved.
