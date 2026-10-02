# Quickstart

This quickstart is for local development of the Veilpay monorepo.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker and Docker Compose
- Expo-compatible Android or iOS development setup for mobile testing

## Install dependencies

```bash
pnpm install
```

This workspace uses pnpm only — do not run `npm install` or `yarn`.

## Start local infrastructure

The local Docker Compose stack (PostgreSQL 16 + Redis 7) is defined in `config/docker-compose.yml`:

```bash
docker compose -f config/docker-compose.yml up -d
```

*(Requires Docker installed and running.)*

## Configure environment

The authoritative variable reference is the repository-root [`.env.example`](../../.env.example). Copy it to the per-service env files and fill in local values:

```bash
cp .env.example apps/backend/.env
cp .env.example apps/consumer-app/.env.local   # only EXPO_PUBLIC_* vars are bundled
```

Production secrets are managed through Doppler. Do not commit secrets, private keys, mnemonics, raw signatures, or provider API keys.

## Prepare the backend database

```bash
pnpm --filter @veilpay/backend db:generate   # prisma generate
pnpm --filter @veilpay/backend db:migrate    # prisma migrate dev — local dev only
```

For production or CI, apply committed migrations only: `pnpm --filter @veilpay/backend db:deploy` (`prisma migrate deploy`). Never run `prisma migrate dev` or `prisma db push` against a production database.

## Start the backend

```bash
pnpm backend:dev
```

Default local API base URL:

```text
http://localhost:3001
```

## Start the indexer

```bash
pnpm indexer:dev
```

## Stage circuit assets, then start the consumer app

The consumer app bundles Groth16 prover artifacts from a gitignored directory, so fresh clones must stage them before any bundle build:

```bash
node apps/consumer-app/scripts/stage-circuit-assets.js
```

The script verifies every staged byte against the SHA-256 pins in `apps/consumer-app/src/constants/circuit.ts` and fails closed on any mismatch. Release builds require the pins; dev builds keep remote artifact URLs.

Without a local circuit compile (`packages/circuits/build`), supply the three binaries from a pinned source instead:

```bash
CIRCUIT_ARTIFACTS_URL=<url-or-dir> node apps/consumer-app/scripts/supply-circuit-assets.js
```

The source is an https base URL (e.g. a GitHub release download base) or a local directory; every byte is digest-verified against the same pins before anything is staged, and a mismatch stages nothing. See the [circuit asset supply and pinning](../reference/circuit-asset-supply.md) reference for the one-time release upload and the CI wiring.

```bash
pnpm consumer:dev
```

## Run checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Release hygiene:

```bash
node apps/consumer-app/scripts/check-version-sync.js   # app version / build number vs changelog
node scripts/validate-maestro-flows.mjs                # e2e Maestro flow + testID coverage
```

For settlement reconciliation between the indexer and the backend, see the [settlement reconciliation runbook](../reference/settlement-reconciliation.md).
