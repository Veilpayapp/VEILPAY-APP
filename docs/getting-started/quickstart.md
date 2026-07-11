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

## Start local infrastructure

```bash
pnpm db:up
```

This starts local services such as PostgreSQL and Redis. Some local setups may also include an EVM development chain.

## Configure environment

Copy the example environment file and fill in local values:

```bash
cp .env.example .env
```

Production secrets are managed through Doppler. Do not commit secrets, private keys, mnemonics, raw signatures, or provider API keys.

## Prepare the backend database

```bash
pnpm --filter @veilpay/backend db:generate
pnpm --filter @veilpay/backend db:migrate
```

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

## Start the consumer app

```bash
pnpm consumer:dev
```

## Run checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```
