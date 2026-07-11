# Privacy overview

Veilpay’s privacy architecture combines practical wallet privacy features with a longer-term native privacy-chain roadmap.

## Current primitives

- Stealth-address utilities.
- Encrypted notes.
- ZK-oriented proof and privacy-pool scaffolding.
- Stellar SPP testnet integration work.

## Design goals

- Reduce unnecessary public linkability.
- Keep private material on-device.
- Avoid logging or storing secrets.
- Make privacy mode explicit and understandable.
- Gate mainnet privacy features behind audits and operational controls.

## Privacy boundaries

Not every Veilpay payment is private by default. Standard chain transfers remain visible on the underlying network. Stronger privacy modes require additional protocol support and user-visible flow changes.

## In this section

- [Stealth addresses](stealth-addresses.md) — one-time recipient addresses that reduce linkability.
- [Encrypted notes](encrypted-notes.md) — recipient-only memo protection.
- [Zero-knowledge direction](zero-knowledge.md) — proof and privacy-pool scaffolding, and the gates before it is production-live.
- [Stellar Private Payments](stellar-spp.md) — the first native privacy-chain track, testnet-first and mainnet-gated.
- [Privacy-chain roadmap](privacy-chain-roadmap.md) — staged plan across Stellar SPP, Monero, Zcash, and Midnight.
