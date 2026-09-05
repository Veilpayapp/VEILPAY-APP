# Current status

Last updated: 2026-08-17 · App version 1.0.4 (build 15)

This page distinguishes implemented, gated, and planned areas so readers do not confuse roadmap items with production-live functionality.

## Implemented core architecture

- Expo React Native consumer wallet (Expo SDK 55, React Native 0.83, 34 screens).
- Express + TypeScript backend, Prisma + PostgreSQL, Redis, BullMQ workers.
- Chain indexer (EVM + Stellar polling, Solana JSON-RPC, WebSocket stream, stealth scanner).
- Health, readiness, and liveness routes; metrics and alerting.
- Backend RPC proxy with per-provider budget circuit breaker.
- EVM (Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, Sepolia), Solana (mainnet/devnet), and Stellar (mainnet/testnet) wallet flows: balances, send, receive, history.
- Fiat on/off ramps: Transak, MoonPay, onramp.money, Stripe shell with provider matrix and quotes.
- WalletConnect v2 (EVM + Solana namespaces), session persistence.
- Sentry hooks plus pino structured logging with correlation IDs.
- EAS/Expo OTA infrastructure (OTA channel currently discontinued; Android releases ship via the local APK build script).

## Implemented security & privacy primitives

- BIP39/HD derivation, SecureStore-only mnemonic storage (no plaintext fallback for sensitive stores), biometric gate on all spend/withdraw/buy flows, clipboard auto-wipe.
- RPC pool with circuit breaker and health checks; SSL certificate pinning in the native SPP bridge (webpki) and fail-closed app TLS policy.
- Deep-link whitelist with address/amount/token validation; WalletConnect URI caps.
- Stealth address utilities, encrypted notes (NaCl box) for EVM.
- EVM ZK privacy-pool scaffolding: Groth16 verifier + VeilPool contract, deposit circuit, nullifier registry. Solana program with real Groth16 `verify_proof` (dummy-proof backdoor removed, SEC-007).
- Stellar Private Payments (SPP): native Rust bridge (`spp-native`), testnet contracts redeployed at ledger 4,125,614, mainnet contracts deployed at ledger 63,938,602, RPC failover for mainnet, shield/transfer/unshield app flow with live progress UI, per-network SQLite wallet isolation, human-readable network errors.

## Gated or not production-live

- A mainnet SPP shield/transfer/unshield transaction has not yet been recorded on the ledger (pending user-approved on-device test with real XLM).
- External audit of the vendored SPP circuits and contracts is pending; SPP is an unaudited reference implementation and is not intended for real assets until audit and operational gates pass.
- Mainnet SPP depends on release configuration (Doppler manifest + RPC secrets); a build without a valid manifest stays fail-closed.
- Full SPP recovery UX after device loss is not yet productized.
- Privacy-chain integrations beyond Stellar SPP are roadmap tracks.

## Planned privacy-chain tracks

- Monero.
- Zcash.
- Midnight.

These tracks will require separate wallet UX, compliance review, chain-specific indexing, operational limits, and security review before any mainnet exposure.

## Key supporting services

- Backend merchant/invoice/webhook API with HMAC-SHA256 signing, timestamp replay protection, and 5+ rate-limit tiers (global, auth, webhook, webhook verify, invoice status, RPC, merchant-tier LRU cache).
- Webhook delivery via BullMQ with dead-letter queue, retries, circuit breaker, and idempotent expiry events.
- Chain indexer ships 7+ src test suites (config, indexers, websocket, queue, stealth crypto/scanner, webhook dispatcher).
- Audit tooling (`packages/auditor`) for plan/production-readiness checks.