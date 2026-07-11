# System architecture

Veilpay is a TypeScript monorepo with mobile, backend, indexer, shared, contract, circuit, and native modules.

## Repository layout

```text
apps/
  consumer-app/      Expo React Native wallet
  backend/           Express API server
  indexer/           Chain indexing service

packages/
  shared/            Shared chain metadata and utilities
  circuits/          ZK circuit assets and experiments
  contracts-evm/     EVM contracts
  contracts-solana/  Solana programs
  spp-native/        Rust native module for Stellar SPP
```

## Runtime layout

```text
User device
  └─ Consumer app
       ├─ Secure wallet storage
       ├─ Chain signers
       ├─ Balance and transaction views
       └─ Privacy UX

Backend
  ├─ Express routes
  ├─ Prisma database access
  ├─ Redis coordination
  ├─ BullMQ queues
  ├─ RPC proxy
  └─ Chain indexer

Networks and services
  ├─ EVM RPC providers
  ├─ Solana RPC
  ├─ Stellar Horizon / Soroban
  ├─ Fiat ramp providers
  ├─ Sentry
  └─ Doppler
```

## Data stores

- PostgreSQL stores backend relational data through Prisma.
- Redis supports sessions, queues, rate-limit state, and worker coordination.
- SecureStore stores sensitive mobile wallet material.
- Async/local app storage is used for non-secret app state where appropriate.

## Operational pattern

The backend exposes an API surface, queues asynchronous work, and keeps sensitive infrastructure credentials out of the mobile binary. The consumer app owns user confirmation and signing.
