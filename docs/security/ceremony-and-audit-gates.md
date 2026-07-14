# Ceremony and external audit gates (SEC-008 / SEC-011)

These gates are **process and policy**, not pure code. They block claiming
**mainnet privacy** (EVM max privacy withdraw, multi-deposit Solana pool,
Stellar SPP mainnet) as production-ready.

| ID | Gate | Owner | Blocks |
|----|------|--------|--------|
| **SEC-008** | Trusted setup / proof-system ceremony | Protocol + security | Any mainnet deploy of circuits whose soundness depends on a ceremony or published toxic-waste destruction |
| **SEC-011** | External security audit | Security + eng leadership | Marketing or product claims of “audited” / “mainnet privacy ready” |

Related product gates live in [Mainnet privacy gates](../roadmap/mainnet-privacy-gates.md).

---

## SEC-008 — Ceremony / trusted setup

### When this applies

- Circom / Groth16 circuits used by **EVM `VeilPool`** and **Solana `veil_pool`**
  (shared withdraw circuit under `packages/circuits/`).
- Any future circuit revision that changes the R1CS or proving key.
- Stellar SPP keys shipped in native/vendor builds (document inheritance of
  upstream ceremony; do not invent a parallel story).

### Required evidence before mainnet privacy

1. **Ceremony description** — Powers of Tau (or equivalent) phase + circuit-specific phase, with public transcripts or reproducible build scripts.
2. **Verifying key binding** — On-chain / embedded VK hashes match the ceremony output checked into the repo (e.g. `packages/circuits/build/verification_key.json` → EVM `Groth16Verifier.sol` and Solana `verifying_key.rs`).
3. **Participant / contribution record** — Enough to defend against a single malicious contributor for the threat model you publish.
4. **Key handling** — Proving keys treated as non-secret but integrity-protected; never ship wrong-circuit keys to production clients.
5. **Revision policy** — Any circuit change forces a new ceremony (or a documented transparent alternative) **before** mainnet verifier upgrade.

### Explicit non-goals of SEC-008

- Dogfood / testnet privacy with clear “testnet only” labeling.
- Public (non-ZK) payments and merchant invoice flows.
- Solana **single-leaf scaffold** localnet experiments (`MAX_SCAFFOLD_LEAVES = 1`).

### Checklist

- [ ] Ceremony transcript(s) archived and linked from this doc or the release notes.
- [ ] VK hash table: circuit commit ↔ EVM verifier ↔ Solana `VERIFYINGKEY` ↔ mobile/native assets.
- [ ] Production build fails closed if VK / zkey asset mismatch is detected (where tooling allows).
- [ ] Incident plan if a ceremony or key is later found compromised (pause pools, rotate contracts).

### Current VK / verifier inventory (pre-ceremony)

> **Status: OPEN — dogfood / testnet artifacts only.**  
> SHA-256 values below bind *what is in the tree today*. They are **not** evidence of a multi-party ceremony. Do not treat this section as SEC-008 pass.

| Artifact | Path | SHA-256 (file contents) |
|----------|------|-------------------------|
| Circuit verifying key (JSON) | `packages/circuits/build/verification_key.json` | `1cc1ec8969740c03dda0793bccd8b8e73cfa9f2ae8d819cf62c7706ee4482663` |
| Proving key (final zkey) | `packages/circuits/build/withdraw_final.zkey` | `3b67ef3099e9fe39b22c927befe2ddc788fffd8d71a3023c82a489f69ed53b99` |
| EVM Groth16 verifier | `packages/contracts-evm/src/Groth16Verifier.sol` | `72f7c6c78e2a909436224df3d71ebfadfdeeca7c93abea6fc6b3c1a24816e863` |
| Solana embedded VK | `packages/contracts-solana/programs/veil_pool/src/verifying_key.rs` | `4b1fe73df4c0e4945f348f5d59f1a9ef3794b338c05f5d63eb8100dbe5f8f1bd` |
| Inventory as of commit | `main` @ `977ff01` | Recompute hashes after any circuit or verifier change |

**After a real ceremony:** replace or append a new inventory row set, link transcript(s), and fill the [Sign-off](#sign-off) table. Keep historical rows.

### Operator runbook (to close SEC-008)

1. Freeze circuit sources under `packages/circuits/` (tag or commit SHA).
2. Run Powers of Tau + circuit-specific contribution with public transcripts; archive under company vault **and** link from this doc / release notes.
3. Export final VK / zkey; recompute SHA-256; regenerate EVM verifier + Solana `verifying_key.rs` from the same VK.
4. Confirm dogfood/testnet deployments still use labeled keys until sign-off.
5. Protocol owner signs SEC-008 row in the sign-off table with evidence paths.

### Incident plan (ceremony / key compromise)

1. Pause or disable privacy withdraw surfaces (relayer, pool contracts, app flags).
2. Treat current proving/verifying keys as untrusted; do not process new private deposits until re-ceremony or transparent replacement is deployed.
3. Communicate residual risk for notes already in-pool; prefer withdraw-to-safe windows only if still sound under the threat model.
4. Rotate contracts / verifiers only after a new SEC-008 ceremony (or accepted transparent setup) and SEC-011 delta review.

---

## SEC-011 — External audit

### Scope that must be audited for mainnet privacy claims

| Surface | Notes |
|---------|--------|
| Withdraw circuit + trusted setup assumptions | `packages/circuits` |
| EVM privacy stack | `VeilPool`, verifier, hasher, fee/cap logic |
| Solana pool (when multi-leaf) | Merkle, nullifiers, groth16 verify, authority/pause |
| Relayer / withdraw path | Auth, quotas, amount caps, no silent fail-open |
| Note / recovery UX | Backup, restore, no secret logging |
| Merchant payment verify | Already improved in Pass B; re-audit if model changes |

### Minimum process

1. **Engagement** — Named firm or public audit program; scope written and frozen.
2. **Report** — Findings with severities; remediations tracked to closed or accepted risk with owner.
3. **Public summary** — What was audited, what was out of scope, residual risks.
4. **Re-audit trigger** — Circuit change, verifier change, Merkle design change, or new chain privacy launch.

### What “audited” must **not** mean

- Only backend REST hardening (that is a separate track).
- Only dogfood device tests.
- Only self-review or AI code review (useful, not a substitute).

### Checklist

- [ ] Signed SOW / scope doc stored under `plans/` or company vault.
- [ ] All Critical/High findings closed or accepted with written residual.
- [ ] Public summary published before “mainnet privacy” marketing.
- [ ] Version pins: audited commit SHAs listed next to release tags.

### Operator runbook (to close SEC-011)

1. Freeze privacy scope (circuits, EVM privacy stack, Solana pool if multi-leaf, relayer withdraw, note UX). Write SOW under `plans/` or vault.
2. Engage named firm / public program; freeze scope for the engagement window.
3. Track findings → remediations in a ticket/PR list; Critical/High must close or have written residual risk + owner.
4. Publish a public summary (what was in/out of scope, residual risks) **before** any “audited mainnet privacy” marketing.
5. Pin audited commit SHAs next to release tags; security owner signs SEC-011 in the sign-off table.

### Suggested engagement scope (copy into SOW)

| Surface | Repo paths |
|---------|------------|
| Withdraw circuit + setup assumptions | `packages/circuits/` |
| EVM privacy | `packages/contracts-evm/src/` (`VeilPool`, verifier, caps) |
| Solana pool (multi-leaf only when enabled) | `packages/contracts-solana/programs/veil_pool/` |
| Relayer / withdraw API | `apps/backend/src/controllers/relayerController.ts`, `middleware/relayerAuth.ts`, quotas |
| Consumer note / privacy UX | `apps/consumer-app/src/` privacy + backup paths |
| Stellar SPP (if claiming mainnet SPP) | vendor/native SPP + app fail-closed gates |

---

## Product fail-closed defaults (until gates pass)

| Feature | Until SEC-008 + SEC-011 (and product gates) |
|---------|-----------------------------------------------|
| EVM max privacy withdraw | `EVM_MAX_PRIVACY_WITHDRAW_READY = false` |
| Stellar SPP mainnet | Fail-closed / testnet-only labeling |
| Solana multi-deposit pool | `ScaffoldSingleLeafOnly` (`MAX_SCAFFOLD_LEAVES = 1`) |
| Mainnet “audited privacy” claims | Forbidden |

---

## Sign-off

| Role | Name | Date | Gate | Evidence path |
|------|------|------|------|---------------|
| Protocol | | | SEC-008 | |
| Security | | | SEC-011 | |
| Eng lead | | | Both + product gates | |

Update this table when a gate passes; link evidence paths. Do not delete historical rows—append.

## Agent / CI automated coverage (not a substitute for sign-off)

| Control | How enforced today |
|---------|-------------------|
| Max privacy withdraw off | `EVM_MAX_PRIVACY_WITHDRAW_READY === false` + TEST-001 |
| Stellar SPP mainnet private off | TEST-001 + `isSppEnabledForChain` |
| Solana multi-deposit | `MAX_SCAFFOLD_LEAVES = 1` + cargo unit test |
| Ceremony doc present | TEST-001 backend |
| SSL pins release fail-closed | `security.ts` + TEST-001 consumer |

Human ceremony + external audit **must still** complete the sign-off table before any mainnet privacy claim.
