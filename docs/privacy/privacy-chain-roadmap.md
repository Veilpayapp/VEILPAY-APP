# Privacy-chain roadmap

Veilpay’s privacy-chain roadmap is staged. Each chain requires separate engineering, security review, compliance review, UX, operations, and incident response planning.

## Track 1: Stellar SPP

Stellar SPP is the first native privacy-chain track. It is testnet-first and mainnet-gated.

Required before production exposure:

- native proof generation and device benchmarks
- audited circuits and contracts
- mainnet deployment ceremony or accepted trusted setup model
- value caps
- kill-switch
- note-secret recovery UX
- monitoring and incident response

## Future track: Monero

Monero would require wallet integration, address/payment ID handling strategy, node or provider architecture, transaction monitoring, balance reconciliation design, and compliance review.

## Future track: Zcash

Zcash would require shielded-address UX, viewing-key strategy, memo handling, note scanning, light-client or provider strategy, and balance reconciliation design.

## Future track: Midnight

Midnight would require a separate architecture review when its developer tooling, privacy model, and production readiness are finalized.

## Roadmap rule

No privacy-chain track should be described as production-live until it has passed security, operations, compliance, and user-recovery gates.
