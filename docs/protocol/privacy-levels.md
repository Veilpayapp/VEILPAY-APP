# Privacy levels

Veilpay treats privacy as an explicit protocol dimension.

## Standard

Standard payments use normal chain transfers. They are faster to reason about and easier to index, but inherit the public visibility of the underlying network.

## Enhanced primitives

Veilpay includes privacy-oriented primitives such as stealth addresses and encrypted notes. These help reduce direct linkability and protect memo content, but they are not equivalent to full private settlement by themselves.

## Private Stellar track

The Stellar Private Payments track is the first native privacy-chain integration path. Contracts are deployed on both testnet and mainnet; the testnet flow was verified end-to-end on 2026-07-09 (CLI E2E), and the mainnet shield/transfer/unshield flow is implemented and shipping in app builds, pending a user-approved on-chain test. Full production activation still requires external audit, operational limits, and safety controls.

## Roadmap privacy chains

Monero, Zcash, and Midnight are planned privacy-chain tracks. Each will require its own integration, security model, indexing strategy, UX, compliance review, and production-readiness gates.
