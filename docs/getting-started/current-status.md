# Current status

This page distinguishes implemented, gated, and planned areas so readers do not confuse roadmap items with production-live functionality.

## Implemented core architecture

- Expo React Native consumer wallet.
- Express and TypeScript backend services.
- Redis-backed infrastructure and BullMQ jobs.
- Health, readiness, and liveness routes.
- Backend RPC proxy for selected networks.
- Chain indexing and transaction-status detection.
- EVM, Solana, and Stellar consumer-wallet flows.
- Fiat ramp screens and provider integrations.
- WalletConnect v2 integration.
- Sentry hooks for observability.

## Implemented privacy primitives

- Stealth address utilities.
- Encrypted notes.
- ZK-oriented proof and privacy-pool scaffolding.
- Stellar SPP testnet product shell and native bridge scaffolding.

## Gated or not production-live

- Stellar SPP mainnet is fail-closed until audit and operational gates are met.
- Full native SPP prove/submit UX depends on device build readiness, native pool operations, and proof benchmarks.
- Privacy-chain integrations beyond Stellar SPP are roadmap tracks.

## Planned privacy-chain tracks

- Monero.
- Zcash.
- Midnight.

These tracks will require separate wallet UX, compliance review, chain-specific indexing, operational limits, and security review before any mainnet exposure.
