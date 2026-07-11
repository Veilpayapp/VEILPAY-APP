# Veilpay Docs

Veilpay is a multi-chain, privacy-first, self-custody wallet for sending, receiving, and holding assets across EVM networks, Solana, and Stellar.

This documentation is the public product and developer knowledge base for Veilpay. It is written for builders, operators, auditors, and advanced users who need to understand how the system works from the mobile wallet to the supporting backend to on-chain settlement.

## What Veilpay provides

- A self-custody consumer wallet built with Expo and React Native.
- Multi-chain balance, send, receive, and transaction history flows.
- Backend-proxied RPC access to avoid exposing provider credentials in the mobile app.
- Fiat on-ramp and off-ramp flows through provider integrations.
- WalletConnect v2 for external dapp sessions.
- Privacy tooling including stealth-address primitives, encrypted notes, and a Stellar Private Payments track for native privacy.
- Production-oriented security controls: server-side credential isolation, rate limiting, strict CORS, typed validation, secret management, and operational health checks.

## Documentation map

- **Start here:** product overview, concepts, and quickstart.
- **Architecture:** mobile app, backend services, indexer, queues, and infrastructure.
- **Consumer app:** wallet flows, networks, signing, balances, and privacy UX.
- **Privacy:** current privacy primitives, Stellar SPP, and future privacy-chain tracks.
- **Security:** signing boundaries, secret handling, and production controls.
- **Reference:** environment variables, backend routes, supported networks, and glossary.

## Current implementation boundary

Veilpay currently focuses on:

- EVM networks: Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, and Sepolia for testing.
- Solana mainnet and devnet flows.
- Stellar mainnet and testnet flows.
- Stellar Private Payments on testnet as the first native privacy-chain integration track.

Planned privacy-chain tracks include Monero, Zcash, and Midnight. Those tracks are documented as roadmap items and are not described as production-live integrations.

## Brand and docs conventions

- The public brand spelling is **Veilpay**.
- Docs avoid exposing or encouraging use of secrets, private keys, mnemonics, raw signatures, or signing material.
- Incomplete features are marked clearly as planned, gated, or testnet-only.
- Examples use representative placeholders and must be adapted before production use.
