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

| Role | Name | Date | Gate |
|------|------|------|------|
| Protocol | | | SEC-008 |
| Security | | | SEC-011 |
| Eng lead | | | Both + product gates |

Update this table when a gate passes; link evidence paths. Do not delete historical rows—append.
