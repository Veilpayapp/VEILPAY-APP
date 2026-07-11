# What is Veilpay?

Veilpay is a privacy-first payment system that combines a self-custody mobile wallet with merchant payment infrastructure.

At a high level, Veilpay lets a merchant create an invoice, lets a user pay from a mobile wallet, and lets the backend confirm and notify the merchant when the payment state changes. The system is designed around secure signing boundaries, multi-chain support, privacy primitives, and production-grade API controls.

## Product surfaces

Veilpay has three major surfaces:

| Surface | Purpose | Primary location |
| --- | --- | --- |
| Consumer app | Self-custody wallet, balances, send/receive, privacy UX, fiat ramps | `apps/consumer-app` |
| Backend API | Merchants, invoices, payments, webhooks, RPC proxy, health checks | `apps/backend` |
| Indexer and workers | Payment detection, chain polling, webhook delivery, invoice expiry | `apps/indexer`, `apps/backend/src/jobs` |

The repo also includes shared packages for chain metadata, contracts, circuits, audit tooling, and the native Stellar SPP bridge.

## What makes Veilpay different

Veilpay is not just a wallet UI. It is a payment stack that combines:

- **Self-custody**: user signing happens on the consumer device.
- **Merchant APIs**: invoices and webhooks give merchants a server-side integration path.
- **Multi-chain payments**: EVM, Solana, and Stellar flows are represented in the current app architecture.
- **Privacy primitives**: stealth addresses, encrypted notes, ZK direction, and Stellar Private Payments are part of the protocol roadmap.
- **Operational safety**: backend request signing, timestamp windows, rate limiting, Redis-backed sessions, queue-based webhook delivery, and health endpoints.

## Public chain scope

The public documentation focuses on Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, Solana, and Stellar. Stellar SPP is documented as the first native privacy-chain track and remains gated by testnet, audit, and production-readiness requirements.
