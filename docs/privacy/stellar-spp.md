# Stellar Private Payments

Stellar Private Payments is Veilpay’s first native privacy-chain integration track. Veilpay vendors the Nethermind `stellar-private-payments` reference implementation (git submodule under `packages/vendor/spp`) and adds a native mobile bridge, app orchestration, and privacy UX on top.

## Status (2026-08-17)

- **Testnet:** Working end-to-end. Contracts were redeployed at ledger 4,125,614 (inside RPC event retention). CLI E2E (deposit → transfer → withdraw) passed on 2026-07-09; app-side onboarding (derive keys, ASP membership `insert_leaf`, pool open/sync, key registration) verified on-device. The full stellarSpp suite passes 106 tests across 15 suites.
- **Mainnet:** Contracts deployed at ledger 63,938,602. The app flow (shield / transfer / unshield) is implemented and the build is ready. A DNS failure on the primary Gateway.fm Soroban RPC was the sole blocker on the test device; an RPC failover to the Lumen public RPC (`https://mainnet.sorobanrpc.com`) was implemented and verified reachable. A user-approved mainnet shield transaction with a confirmed hash on the ledger is the remaining gate.
- **Important:** SPP is an unaudited reference implementation (Nethermind + Stellar both advise against real assets until audited). Mainnet is fail-closed unless a release manifest with valid contract IDs and RPC is present. No external audit claim is made.

## Architecture

```text
Stellar Testnet / Mainnet
  ├─ Soroban SPP contracts
  ├─ pool contract (native XLM)
  ├─ verifier contract (BN254 Groth16)
  ├─ ASP membership / non-membership contracts
  └─ public key registry contract

Consumer app (apps/consumer-app)
  ├─ Private XLM screen + Privacy Level flow (shield / transfer / unshield)
  ├─ SPP client orchestration (src/utils/stellarSpp/*)
  ├─ Private note store, diagnostics, progress UI
  └─ Native module bridge (modules/spp-native)

Native layer (packages/spp-native)
  └─ Rust cdylib wrapping SPP sdk/pool (pool ops, key derivation, prove/submit)
     with rustls/webpki TLS and JNI Android bindings
```

## Key technical facts

- Proving uses **BN254 Groth16 via ark-circom** (not snarkjs) on the SPP path; the circuit is `policy_tx_2_2` with a separate proving key from the EVM circuits.
- Native proving runs off the JS thread in the Rust bridge; measured desktop wall time is ~10 s per proof, on-device estimate ~10–20 s (tree depth 8 testnet / 10 mainnet).
- The app seeds circuit assets (proving key 8.1 MB, wasm 646 KB, r1cs 5.1 MB) from APK assets on first readiness check.
- Fee ceiling was calibrated from on-chain data: `SPP_TRANSACT_FEE_CEILING_STROOPS` is now 1,200,000 stroops (0.12 XLM), covering the observed max submitted `max_fee` of 1,156,558 stroops.
- Per-network SQLite wallet files keep testnet and mainnet private accounts fully separate.
- Mainnet `pool_sync` uses an RPC failover wrapper (`sppRpcFailover.ts`): on DNS/connection errors it reopens the pool with the fallback RPC and retries; only network-class errors trigger failover, not contract errors or retention gaps.

## Current gates

- User-approved mainnet shield/transfer/unshield with confirmed ledger hashes (in progress).
- External audit of circuits and contracts (planned; SPP is currently an unaudited WIP reference implementation).
- Mainnet ceremony or accepted trusted-setup model if deploying own keys (current deployment inherits the SPP testnet trusted setup keys).
- Value caps and kill-switch for any first mainnet exposure beyond the current pool-level max deposit.
- Note-secret recovery UX and device-loss flows.
- Monitoring and incident response around the relayer/private payment rails.

## User-facing model

The intended UX is private XLM with explicit shield, private transfer, and unshield flows. Users must understand that private notes and recovery material are critical and must be protected. The app pauses state-changing actions until private history is fully synced and readiness is confirmed.