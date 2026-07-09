# VeilPay — Consumer Hardening (Track A) + SPP Phase 0 Spike (Track B)

> **Decision (2026-07-09):** Harden the *live* consumer app first, in parallel with the
> read-only SPP Phase 0 spike. Merchant side fully parked. No new merchant flows.
> Do **not** finish the `'max'` ZK path — see "Why not `max`" below.

## Audit findings (ground truth, this session)

Health of the live app is **good**, not broken:
- `tsc --noEmit`: **0 errors**
- Jest: **527 pass / 1 skip / 0 fail** (528 tests, 108 suites)
- ESLint: **0 errors / 1253 warnings** (bulk = `no-explicit-any`)
- Git tree clean, build 11.

The privacy stack is **entirely unconfigured and correctly fenced off**:
- `packages/contracts-evm/deployments/sepolia.json` = all-zero addresses, `blockNumber: 0`.
- `'max'` → screen passes `sourceCommitmentHash: undefined`; hook also throws for missing
  `pathElements/pathIndices/nullifierHash`. **Dead path.**
- `'stealth'` → `isPrivacyStackConfigured() === false` fail-fast; row disabled in UI.
- Stealth **receive** scanner gated off in `useIncomingPaymentNotifications`.
- **The only live payment path is `'standard'`** (direct transfer on EVM / SVM / MVM / XLM).

### Why not finish `'max'`
Finishing it = deploy a BN254 EVM pool + plumb Merkle path into `CommitmentRecord` + build a
commitment-picker UI + wire a real relayer. That is **new-feature work on a stack SPP
(BLS12-381 / Soroban) is meant to supersede** — not hardening. Leave `'max'`/`'stealth'` as the
correctly-gated typed stubs they are.

---

## Track A — Harden the standard multi-chain send/receive path

Scope = the code users actually touch. Confirmed concrete findings first, then verification sweep.

### A1. Confirmed defects to fix
1. **Duplicate, divergent `validateAddress`.** Two implementations exist:
   - `stores/walletStore.ts` (used by `SendPaymentScreen`) — `mvm` branch adds `&& length <= 66`.
   - `utils/validation.ts` — `mvm` branch has **no** length cap (`/^0x[a-fA-F0-9]{1,64}$/`).
   Two sources of truth for "is this address valid" is a latent correctness/consistency bug.
   **Fix:** make `walletStore.validateAddress` re-export/delegate to `utils/validation.ts`
   (single source), reconciling the `mvm` length rule (keep the stricter `<= 66`). Add a test
   asserting the two entry points agree across all four chain types.

2. **Stellar reserve is hardcoded to 1 XLM.** `stellarSigner.ts:102` uses a flat `reserveXlm = 1`,
   but Stellar's minimum reserve is `(2 + numSubentries) × base_reserve (0.5)`, so an account with
   trustlines/offers needs **more** than 1 XLM reserved. A send that passes this check can fail at
   Horizon with `tx_insufficient_balance`. **Fix:** compute reserve from
   `accountData.subentry_count` (already in the Horizon response): `reserve = (2 + subentry_count) * 0.5`.
   Add a unit test with a mocked multi-subentry account.

3. **Poller `privacyLevel` type excludes `'stealth'`.** `PollOptions.privacyLevel?: 'standard' | 'max'`
   but the stealth flow calls the poller (with `'standard'`, so no runtime bug today) — the type is
   just narrower than reality. Low priority; widen to `PrivacyLevel` for honesty or leave a note.

### A2. Verification sweep (find-or-clear; each ends in a test or a clean bill)
- **Four signers**: `secureSigner` (EVM), `solanaSigner` (SVM), `aptosSigner` (MVM), `stellarSigner`
  (XLM) — verify: insufficient-funds math, address validation parity with A1, error mapping to
  `TransactionError` codes, decimals/amount formatting (scientific-notation & comma inputs).
- **`txStatusPoller` + `waitForTransaction`**: confirm chain-key routing matches `chains.ts` keys
  (`stellar` / `solana` / `aptos` vs testnet variants), abort-on-unmount, timeout-stays-pending
  semantics, transient-RPC-error resilience.
- **Balance polling** (`useBalance` / `useBalancePolling` / `balanceFetcher`): re-check the
  known flicker regression is still fixed; verify multichain native+token paths and the
  30s/5s refresh guards.
- **Received-payment notifications** (`useIncomingPaymentNotifications`): dedupe by hash/id,
  `seen`-set persistence keyed by address, foreground/background gating.
- **Send/confirm screens**: address re-validation against the *active* chain on the confirm
  screen (not just send screen), amount+fee gate correctness.

### A3. Method
- Work in small, reviewable commits, one finding per commit, tests alongside.
- Follow existing patterns: `*.property.test.ts` / `*.test.ts` in `__tests__/`, fast-check where
  the store tests already use it.
- After each change: `npx tsc --noEmit` + targeted `jest` for the touched area; full suite before
  any version bump.
- Commit attribution per [[commit-attribution]] (author `codeREDxbt`, **no** Claude Co-Authored-By).
- Any shipped behavior change → follow [[update-release-process]] (bump `version.json` build +
  changelog). Pure test/refactor commits that don't change runtime behavior don't need a bump.

---

## Track B — SPP Phase 0 spike (read-only, touches no app code)

Toolchain verified present on this machine: **Rust 1.96, cargo, stellar-cli 27.0 (Soroban)**, git 2.54
w/ submodule support. Track B follows `plans/stellar-spp-integration-plan.md §1` exactly:

- [ ] `git submodule add https://github.com/NethermindEth/stellar-private-payments packages/vendor/spp`;
      record SHA. Read `LICENSE`; note LGPLv3 obligations on `circuits/build.rs` + `dist/` in `SECURITY.md`.
- [ ] **Prover reality** — determine Rust→WASM (Trunk) vs snarkjs. #1 unknown.
- [ ] Confirm on-chain verifier curve = **BLS12-381** via Soroban host fns.
- [ ] Confirm install script ships usable **testnet proving keys** (→ inherit their trusted setup).
- [ ] Deploy Pool / Verifier / ASP-membership / ASP-non-membership / Public-Key-Registry to
      **Stellar testnet, unmodified**, via their Makefile/cli. Capture contract IDs.
- [ ] Run **deposit → transfer → withdraw** via their `spp` CLI end-to-end on testnet.
- [ ] Benchmark on-device proof-gen time/memory (mid/low-end Android) — the make-or-break UX number.

**Exit gate:** a testnet transfer works via CLI, prover mechanism known, proof-gen tolerable.
Track B produces **facts + a submodule + docs only** — zero `apps/consumer-app` changes, so it
cannot regress Track A.

---

## Sequencing & isolation
- Tracks A and B are independent: A edits `apps/consumer-app`, B adds `packages/vendor/spp` +
  docs. They can proceed in either order / interleaved.
- **Suggested start:** land A1 (three confirmed fixes, highest certainty) while B's submodule +
  prover investigation runs. Then A2 sweep. Re-evaluate SPP Phase 1 (app code) only after B's exit gate.

## Out of scope (explicit)
- Any merchant flow. Finishing `'max'`/`'stealth'` or deploying the BN254 EVM pool.
- Building on `veilpay-privacy-upgrade-v2.md` snippets (Next.js/BN254 assumptions).
- SPP Phase 1 app integration — gated behind Track B's exit gate.
