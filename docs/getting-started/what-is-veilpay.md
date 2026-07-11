# What is Veilpay?

Veilpay is a privacy-first, self-custody wallet that lets people hold, send, and receive assets across multiple blockchains from one mobile app.

At a high level, Veilpay lets a user create or import a wallet, view balances across chains, send and receive payments, connect to dapps, move between fiat and crypto through ramp providers, and use privacy features where supported. The system is designed around secure signing boundaries, multi-chain support, and privacy primitives.

## Product surfaces

Veilpay has two major surfaces:

| Surface | Purpose |
| --- | --- |
| Consumer app | Self-custody wallet, balances, send/receive, privacy UX, fiat ramps |
| Backend services | RPC proxy, chain indexing, health checks, and supporting infrastructure |

Veilpay also provides shared infrastructure for chain metadata, contracts, circuits, audit tooling, and the native Stellar SPP bridge.

## What makes Veilpay different

Veilpay is not just a wallet UI. It is a self-custody payment stack that combines:

- **Self-custody**: user signing happens on the consumer device; the backend never receives signing material.
- **Multi-chain payments**: EVM, Solana, and Stellar flows in a single wallet.
- **Privacy primitives**: stealth addresses, encrypted notes, ZK direction, and Stellar Private Payments are part of the protocol roadmap.
- **Operational safety**: server-side RPC credential isolation, rate limiting, Redis-backed infrastructure, and health endpoints.

## Public chain scope

The public documentation focuses on Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, Solana, and Stellar. Stellar SPP is documented as the first native privacy-chain track and remains gated by testnet, audit, and production-readiness requirements.
