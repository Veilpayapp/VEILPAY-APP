# Veilpay — Stellar Private Payments (SPP) Integration Plan

> **Status:** Draft v1 — grounded against the *actual* repo (Expo RN + Express), not the
> Next.js-shaped `veilpay-privacy-upgrade-v2.md`.
> **Scope of THIS plan:** Stellar SPP only, as the first Tier‑1 native‑privacy chain.
> Monero / Zcash / Midnight are deferred to sibling plans that reuse this scaffolding.
> **Decisions locked (2026-07-09, updated):**
> 1. Vendor `NethermindEth/stellar-private-payments` as a git submodule; thin Veilpay adapter on top.
> 2. **Testnet product first.** Mainnet code path fail-closed until audit + ceremony + ops gates.
> 3. **Consumer app only** — self-custody shield / private transfer / unshield. **No merchant** in this plan (future plans only). Demo day = two app accounts, not a merchant flow.
> 4. **Native mobile integration** — wrap Rust `sdk/pool` (same as `spp` CLI) via JSI/Nitro/Uniffi. **Do not ship a product WebView** of `sdk/web`.
> 5. Curve is **BN254** (not BLS12-381); prover is ark-circom → native/WASM, **not** snarkjs.

---

## 0. Reality check — what the source plan got wrong

The `veilpay-privacy-upgrade-v2.md` doc was written against a **Next.js web** app. Our repo is
**Expo React Native** (`apps/consumer-app`, screens + Zustand) with an **Express** backend
(`apps/backend`, controllers/routes/BullMQ). Corrections carried into this plan:

| Doc assumed | Actual repo | Consequence |
|---|---|---|
| `mobile/app/.../page.tsx`, `<div>` | `apps/consumer-app/src/screens/*.tsx` + React Navigation | Rewrite all UI to RN screens |
| Next.js API `route.ts` | Express controllers/routes + BullMQ jobs | Backend work lands in `apps/backend/src` |
| Merchant dashboard app exists | **No merchant app** (only `plans/MERCHANT_DASHBOARD_SPEC.md`) | Merchant flows are out of scope for v1 |
| Stellar is new | `stellar` already in `packages/shared/src/chains.ts` (`type: "xlm"`), working `stellarSigner.ts` (stellar-sdk ^13.3) | Extend, don't add |
| "Reuse existing Groth16 infra" | Existing EVM circuits **and** SPP are **BN254** | Same curve; **separate circuit artifacts/keys** still |
| SPP has a "TypeScript SDK + snarkjs" | Rust `sdk/pool` + `sdk/web` (WASM for browser) | **Mobile = native Rust bridge**, not snarkjs, not product WebView |
| Scanner matches `output.amount === invoice.amount` | Amounts are shielded — impossible to match | Not applicable to self‑custody v1; would block a merchant rail |

**Known‑incomplete dependency:** `apps/consumer-app/src/hooks/usePaymentTransaction.ts` `'max'`
branch currently **throws "not yet implemented"** — `CommitmentRecord` lacks
`pathElements/pathIndices/nullifierHash`. SPP is a *separate* pool, so it does not block on this,
but it's a signal that our ZK plumbing patterns are still maturing.

---

## 1. Phase 0 — Spike & de‑risk (before any integration code)

Goal: replace every assumption below with a verified fact. Timebox ~3–5 days.

- [ ] **Vendor the repo.** `git submodule add https://github.com/NethermindEth/stellar-private-payments packages/vendor/spp`. Record commit SHA. Read `LICENSE` (Apache‑2.0 mixed w/ **LGPLv3** on `circuits/build.rs` + `dist/` artifacts) → confirm distribution obligations are acceptable for a shipped mobile app; document in `SECURITY.md`.
- [ ] **Prover reality.** Determine how proofs are actually generated: their Rust prover compiled to WASM (Trunk) vs. a snarkjs path. This decides the mobile integration (see §4). **Do not assume snarkjs.**
- [x] **Curve confirmation.** On-chain verifier is **BN254** (Soroban `crypto::bn254` host fns), not BLS12-381. See `plans/spp-phase0-findings.md`.
- [x] **Prebuilt keys.** `deployments/testnet/circuit_keys/` ships `policy_tx_2_2` + selectiveDisclosure keys; testnet inherits that trusted setup.
- [x] **Deploy to testnet, unmodified.** Live IDs in `deployments/testnet/deployments.json` verified; self-deploy not required for dogfood.
- [x] **CLI E2E on testnet.** deposit → transfer → withdraw via `spp` CLI **passed** (2026-07-09). Requires ASP membership `insert_leaf` first.
- [ ] **Proof‑gen benchmark (mobile).** Desktop wall ~10 s/tx OK; **Android mid/low-end** still open.

**Exit gate:** CLI E2E ✅; prover mechanism = ark-circom native ✅; on-device prove still open before shipping UX.

---

## 2. ZK pipeline: separate circuits, same curve family

- Existing: `packages/circuits/withdraw.circom` → `Withdraw(20)`, **BN254**, `Groth16Verifier.sol`, EVM. Untouched.
- SPP: also **BN254** Groth16 via ark-circom (not snarkjs); own circuits (`policy_tx_2_2`), own
  proving keys, Poseidon2, Soroban verifier. **Same curve, separate artifacts.**
- Mobile: wrap `sdk/pool` natively (`packages/spp-native`); do **not** productize `sdk/web` WebView.
- Treat as a parallel stack under `packages/vendor/spp` + `packages/spp-native` + thin TS adapter.

---

## 3. Architecture (grounded in real dirs)

```
packages/
  vendor/spp/                 # submodule — Nethermind SPP (circuits, contracts, cli, sdk)
  spp-native/                 # NEW — Rust cdylib + RN bridge (Phase 0: ping/version; Phase 1: pool ops)
  spp-adapter/                # NEW — thin TS: contract IDs, RPC, note model, key mgmt types
apps/consumer-app/src/
  utils/
    stellarSpp/               # NEW — RN orchestration over spp-native
      sppClient.ts            #   deposit/transfer/withdraw orchestration
      sppNotes.ts             #   commitment/nullifier/note secret persistence (SecureStore)
      sppProver.ts            #   thin wrapper; prove lives in native sdk/pool
  screens/
    StellarSppScreen.tsx      # NEW — deposit/transfer/withdraw self-custody UI (chat-style)
  stores/
    sppNoteStore.ts           # NEW — local note/UTXO set, mirrors commitmentStore.ts patterns
apps/backend/src/
  jobs/spp-indexer.job.ts     # NEW (BullMQ) — polls Soroban pool events → Merkle root cache
  routes/spp.routes.ts        # NEW — read-only: current merkle root, ASP root, tree siblings
  services/sppService.ts      # NEW
packages/shared/src/chains.ts # EXTEND stellar entry with SPP contract IDs + testnet variant
```

No merchant app, no scanner-by-amount, no DUST — those are out of v1 scope.

---

## 4. Phase 1 — Testnet self-custody wallet (the core deliverable)

**Chain registry (`packages/shared/src/chains.ts` + app `constants/spp.ts`):**
- [x] `stellar-testnet` entry (Horizon + friendbot already in app; shared package now has SPP IDs).
- [x] Optional `spp?: { poolId; verifierId; aspMembershipId; aspNonMembershipId; registryId; … }` — mainnet has no `spp` (fail-closed).

**Key management (`stores/sppNoteStore.ts`):**
- [ ] Derive SPP privacy keys from the **existing** stored mnemonic / wallet signature path (CLI uses SEP-53 message sign via stellar keys).
- [ ] Spending material stays behind biometric‑gated SecureStore.
- [x] Persist local note summaries in SecureStore (`sppNoteStore`); expand fields as native ops land.

**Prover / native (`packages/spp-native` + `utils/stellarSpp/` + Expo module):**
- [x] Hello-world `version` / `ping` / `capabilities` (JS stub + Rust cdylib).
- [x] `@veilpay/expo-spp-native` local Expo module + autolink (npm install verified).
- [x] Android JNI scaffold (`android-jni` feature, `SppNativeRust`, jniLibs scripts).
- [ ] cargo-ndk `.so` + dev-client device check (`backend: native`, Rust version string).
- [x] Link `sdk/pool` (same as CLI) via feature `pool-ops` + session FFI — **not** product WebView / snarkjs.
      Desktop compile OK; device APK with `SPP_NATIVE_POOL_OPS=1` when EAS quota returns.
- [ ] On-device Android prove bench (desktop ~10s Phase 0).

**Operations (`utils/stellarSpp/sppClient.ts`):**
- [x] Scaffold + mainnet fail-closed; ops throw `SPP_OPS_NOT_READY` until native poolOps.
- [x] `deposit` / `transfer` / `withdraw` → `ensurePoolSession` + native prove/submit path (CAP_POOL_OPS).
- [x] ASP membership insert productized (permissionless on current testnet) — device OK.
- [ ] Device E2E shield→transfer→unshield with real prove (blocked on native 1.1.0 APK).

**Backend indexer (`jobs/spp-indexer.job.ts`):**
- [ ] BullMQ worker polling Soroban pool events → maintain a cached Merkle tree so the client can fetch inclusion siblings without re‑scanning the chain. Mirror existing indexer job structure. Persist cursor in the existing `IndexerState`‑style pattern.

**UI (`screens/StellarSppScreen.tsx`):**
- [x] Scaffold screen + Settings entry; testnet-gated; shows native bridge status + local notes.
- [ ] Wire real deposit/transfer/withdraw when `poolOps` is true; honest status `signing → submitted → confirmed`.
- [ ] Explicit "note secret saved" affordance (model on `CommitmentSaveBanner.tsx`).

**Tests:** unit tests for config / note store / client scaffold; property + device E2E later.

---

## 5. Phase 2 — Hardening & the mainnet gate (NOT shipped in v1)

Explicitly deferred; listed so the boundary is unambiguous:
- [ ] External audit of vendored circuits + Soroban contracts (SPP is an **unaudited WIP reference impl** — Nethermind + Stellar both say not for real assets).
- [ ] **Real multi‑party trusted setup** for the withdrawal circuit if we ever deploy our *own* keys (a 1‑contributor `zkey contribute` = forgeable proofs = drainable pool).
- [ ] Per‑tx / per‑pool value caps + kill‑switch for any first mainnet exposure.
- [ ] Regulatory review: privacy‑pool acceptance, app‑store policy, MSB/relayer exposure.
- [ ] Only after all of the above: flip chain registry to mainnet contract IDs.

---

## 6. Deferred to sibling plans (reuse this scaffolding)
- Merchant‑invoice acceptance over SPP: requires payer→merchant **note‑secret delivery channel** + viewing‑key detection. **Flaw to solve first:** you cannot match a shielded deposit to an invoice by amount. Needs its own design doc.
- Monero, Zcash, Midnight Tier‑1 chains.
- Dash PrivateSend (mixing) — deferred as in the source plan.

---

## 7. Open questions to close during Phase 0
1. Prover mechanism: Rust‑WASM (Trunk) or snarkjs? (drives §4 prover work)
2. Does the vendored install script ship usable testnet proving keys? (drives whether v1 needs any ceremony)
3. LGPLv3 `dist/` artifact obligations vs. shipping inside a closed mobile binary — acceptable?
4. Public Key Registry contract: is it enough to later bootstrap merchant detection, or do we need our own directory?
5. On‑device proof‑gen time on low‑end Android — within UX budget?

## 8. References
- Nethermind SPP repo: https://github.com/NethermindEth/stellar-private-payments
- Stellar privacy docs (SPP = "shield everything", PoC not for production): https://developers.stellar.org/docs/build/apps/privacy
- Soroban ZK / BLS12‑381 direction: https://github.com/orgs/stellar/discussions/1500
- snarkjs (bn128 + bls12‑381): https://github.com/iden3/snarkjs
- Prototyping Privacy Pools on Stellar: https://stellar.org/blog/ecosystem/prototyping-privacy-pools-on-stellar
```
