# Stellar Private Payments

Stellar Private Payments is Veilpay’s first native privacy-chain integration track.

## Status

SPP is currently treated as a testnet and gated integration path. Mainnet is fail-closed until audit, ceremony, operational, and app-readiness requirements are met.

## Architecture

```text
Stellar Testnet
  ├─ Soroban SPP contracts
  ├─ pool contract
  ├─ verifier contract
  ├─ ASP membership contracts
  └─ registry contract

Consumer app
  ├─ Private XLM screen
  ├─ SPP client utilities
  ├─ Private note store
  └─ Native module bridge

Native layer
  └─ Rust proving bridge
```

## Key technical facts

- SPP uses BN254 Groth16 proving through ark-circom tooling.
- Mobile integration targets a native Rust bridge, not a production WebView.
- Testnet contract IDs are configured for Stellar Testnet.
- Mainnet has no enabled SPP config until safety gates are passed.

## Current gates

- Device proof generation benchmark.
- Native pool-operations build readiness.
- Real shield, transfer, and unshield device E2E.
- External audit of circuits and contracts.
- Mainnet ceremony and operational controls.
- Value caps and kill-switch.

## User-facing model

The intended UX is private XLM with explicit shield, private transfer, and unshield flows. Users must understand that private notes and recovery material are critical and must be protected.
