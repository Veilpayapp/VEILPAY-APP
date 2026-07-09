# VeilPay — Stellar Private Payments (SPP) Integration Plan

> **Status:** Draft v1 — grounded against the *actual* repo (Expo RN + Express), not the
> Next.js-shaped `veilpay-privacy-upgrade-v2.md`.
> **Scope of THIS plan:** Stellar SPP only, as the first Tier‑1 native‑privacy chain.
> Monero / Zcash / Midnight are deferred to sibling plans that reuse this scaffolding.
> **Decisions locked (2026-07-09):**
> 1. Vendor `NethermindEth/stellar-private-payments` as a git submodule; thin VeilPay adapter on top.
> 2. **Testnet‑only for v1.** Mainnet gated behind external audit + real trusted setup ceremony.
> 3. **Self‑custody wallet model first** (deposit / transfer / withdraw from the user's own
>    VeilPay wallet). Merchant‑invoice acceptance deferred (needs note‑delivery design).

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
| "Reuse existing Groth16 infra" | Existing circuits are **BN254**; SPP/Soroban is **BLS12‑381** | Separate ZK pipeline — see §2 |
| SPP has a "TypeScript SDK + snarkjs" | SPP repo is 82% Rust; prover built via **Trunk (Rust→WASM)** | Prover integration is Rust‑WASM, not snarkjs WebView — **verify first (§1)** |
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
- [ ] **Curve confirmation.** Confirm on‑chain verifier is BLS12‑381 via Soroban host functions (stellar discussion #1500). Confirm snarkjs/artifacts curve if snarkjs is in play.
- [ ] **Prebuilt keys.** Confirm their install script provisions `circuit-keys` (proving/verifying keys). If yes, **testnet inherits their trusted setup** — no ceremony needed for v1. Mainnet still needs our own ceremony.
- [ ] **Deploy to testnet, unmodified.** Use their `cli` / `Makefile` / `deployments` to deploy Pool, Groth16 Verifier, ASP Membership, ASP Non‑Membership, and the **Public Key Registry** contract to Stellar **testnet**. Capture contract IDs.
- [ ] **CLI E2E on testnet.** Run deposit → transfer → withdraw via their `spp` CLI end‑to‑end before we touch the app. This is the "does the primitive even work for us" gate.
- [ ] **Proof‑gen benchmark.** Measure proof generation time + memory for one withdrawal on a mid/low‑end Android device (this is the make‑or‑break UX number).

**Exit gate:** a testnet transfer works via CLI, we know the prover mechanism, and proof‑gen is
tolerable on‑device. If proof‑gen is >~10s or OOMs on low‑end devices, escalate before Phase 2.

---

## 2. ZK pipeline: separate, not shared

- Existing: `packages/circuits/withdraw.circom` → `Withdraw(20)`, **BN254**, `Groth16Verifier.sol`, EVM. Untouched.
- SPP: **BLS12‑381**, own ptau, own zkey, own WASM, own Poseidon constants, Soroban verifier.
- **Reuse is tooling/skills only** (circom, snarkjs *if applicable*, the off‑thread WASM proving
  pattern in `ZkpProver.tsx`), **not artifacts**. Treat as a parallel stack under
  `packages/vendor/spp` + a new `packages/spp-adapter` (TS).

---

## 3. Architecture (grounded in real dirs)

```
packages/
  vendor/spp/                 # submodule — Nethermind SPP (circuits, contracts, cli, sdk)
  spp-adapter/                # NEW — thin TS: contract IDs, RPC, note model, key mgmt types
apps/consumer-app/src/
  utils/
    stellarSpp/               # NEW — RN bridge to the prover (mechanism TBD in Phase 0)
      sppClient.ts            #   deposit/transfer/withdraw orchestration
      sppNotes.ts             #   commitment/nullifier/note secret persistence (SecureStore)
      sppProver.ts            #   proof generation surface (Rust-WASM or snarkjs bridge)
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

**Chain registry (`packages/shared/src/chains.ts`):**
- [ ] Add `stellar-testnet` entry (Horizon testnet + Soroban testnet RPC + friendbot).
- [ ] Extend the `stellar` shape with an optional `spp?: { poolId; verifierId; aspMembershipId; aspNonMembershipId; registryId; poolLevels; aspLevels }`. Keep it optional so transparent XLM still works if SPP config is absent (mirrors the `assertCircuitConfigured` fail‑fast pattern already in `constants/circuit.ts`).

**Key management (`utils/stellarSpp/sppNotes.ts`):**
- [ ] Derive the SPP spending key from the **existing** stored mnemonic (same `getStoredMnemonic()` path `stellarSigner.ts` uses) — one seed, no new backup surface for the user.
- [ ] Spending secret stays behind biometric‑gated SecureStore. Reuse the sensitive‑op auth gate (biometric‑or‑PIN, check `.success` on the returned object) already standard in this app.
- [ ] Persist note secrets (nullifier, secret, value, label, leaf index, path) locally — losing them = losing funds. Model on `stores/commitmentStore.ts` + `pendingCommitmentQueue.ts`.

**Prover (`utils/stellarSpp/sppProver.ts`):** implement per Phase 0 finding. If Rust‑WASM: host the
vendor's WASM in a WebView bridge modeled on `ZkpProver.tsx`. If snarkjs: reuse that component's
message protocol directly with the BLS12‑381 artifacts.

**Operations (`utils/stellarSpp/sppClient.ts`):**
- [ ] `deposit(amount)` → build commitment, submit to Pool via Soroban tx signed with the Stellar keypair (reuse `stellarSigner.ts` submission path), stash the note locally, then confirm the ledger.
- [ ] `withdraw(recipient, amount)` → fetch current Merkle root + siblings from backend (`spp.routes.ts`), generate proof, submit `withdraw`, `markSpent` the note.
- [ ] `transfer(recipientSppPubKey, amount)` → spend note, create new note bound to recipient's SPP pubkey (looked up via the Public Key Registry contract).
- [ ] ASP mode: default **max_privacy** (ASP disabled) for self‑custody consumer flow; expose compliance mode as config only.

**Backend indexer (`jobs/spp-indexer.job.ts`):**
- [ ] BullMQ worker polling Soroban pool events → maintain a cached Merkle tree so the client can fetch inclusion siblings without re‑scanning the chain. Mirror existing indexer job structure. Persist cursor in the existing `IndexerState`‑style pattern.

**UI (`screens/StellarSppScreen.tsx`):**
- [ ] Chat‑style deposit/withdraw/transfer, matching the app's existing screen conventions (not the doc's `<div>`).
- [ ] Honest status model: `signing → submitted → confirmed (1 ledger ~5s)`. Stellar genuinely confirms in ~1 ledger, so the UX doc's ~5s claim holds **for Stellar** (unlike the Monero/Zcash claims).
- [ ] Explicit "note secret saved" affordance — surface the backup‑critical nature of local notes (this app already has a `CommitmentSaveBanner.tsx` to model on).

**Tests:** property tests in the repo's existing style (`*.property.test.ts`), plus a testnet E2E in `tests/e2e`.

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
