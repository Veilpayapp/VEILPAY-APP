# Audit backlog (living)

> **Freeze date:** 2026-07-13  
> **Source of truth:** cross-check against source (not the original “14 open” table)  
> **Program plan:** Phase 0 → 5 (inventory → payment integrity → SPP recovery → abuse → quality → remaster)  
> **Product bar (dogfood):** pool-ops APK, recovery e2e on Stellar testnet, max privacy **off**, no unauth payment mutation, no unrecoverable shield without warning + recovery path.

Update **Status** when work lands. Do not re-open closed IDs unless remaster finds a regression.

---

## Definition of ready (dogfood)

| Gate | Requirement |
|------|-------------|
| Payment confirm | Auth + merchant ownership + **on-chain verify** (or endpoint disabled in prod) |
| SPP funds | Reinstall/recovery restores pXLM on **pool-ops** build |
| Non–pool-ops APK | Cannot shield / transfer / unshield (hard fail-closed) |
| DATA-002 | `EVM_MAX_PRIVACY_WITHDRAW_READY = false` + tests |
| Mainnet SPP | Still fail-closed (not this track) |

---

## Living checklist

| ID | Severity | Status | Owner | Phase | Exit test / evidence |
|----|----------|--------|-------|-------|----------------------|
| SEC-001 auth on `/payment/confirm` | High | **done** | backend | — | `payment.test.ts`, `paymentController.test.ts` unauth 401 + merchant scope |
| SEC-001 residual (on-chain verify) | High | **done** (2026-07-13) | backend | 1 | `paymentTxVerifier` + controller gate; fake txHash 400; Jest green |
| SEC-002 Webhook SSRF + pin + 3xx reject | High | **done** | backend | — | `urlSafety.test.ts` |
| SEC-003 Public register abuse | Med | **done** (2026-07-13) | backend | 3 | Rate limit + prod `pending` + optional invite token; tests |
| SEC-004 RPC caps | Med | **done** (attest residual **accepted**) | backend | 3 | Caps/batch/logs live; no app-attest unless cost abuse returns |
| SEC-005 Onramp status HMAC token | High | **done** | backend | — | Onramp status 401 without token |
| SEC-006 Relayer quotas / circuit / floor | Med | **done** + caller secret residual closed | backend | 3 | Quotas + `relayerCallerAuth` (`RELAYER_SHARED_SECRET`) |
| REL-001 / DATA-003 Payment `$transaction` + idempotency | High | **done** | backend | — | `paymentProcessor.test.ts` |
| REL-002 Webhook delivery before HTTP + retry idemp | Med | **done** | backend | 3 | Outbox row before enqueue; stable jobId; tests |
| DATA-001 SPP note recovery after reinstall | Critical | **done** (dogfood 2026-07-13) | consumer | 2 | Recovery restores pXLM on pool-ops APK |
| DATA-002 EVM max withdraw | Critical | **gated off** (do not implement) | consumer | 2 containment | `EVM_MAX_PRIVACY_WITHDRAW_READY === false`; max disabled + send blocked |
| SPP-001 poolOps product gates | High | **done** (2026-07-13) | consumer | 2 | UI + send preflight hard-disable without `poolOps`; tests |
| UX-activity public refresh after shield | Low | **done** (2026-07-13) | consumer | 2 polish | `refreshTransactions` after SPP success |
| UX-private activity history pre-install | Low | **accepted residual** | consumer | — | Local session feed by design; not full chain history |
| UX-001 Diagnostic StellarSpp not in prod nav | Low | **done** | consumer | — | Not in production navigator |
| DEV-001 CI high npm audit gate | Med | **done** | devops | — | `better-npm-audit --level=high` |
| PERF-001/003 Poll backoff / SecureStore batch | Low | **done** (2026-07-13) | consumer | 4 | Gas AppState + balance AppState; notes parallel list |
| PERF-002 Indexer full pending scan | Med | **done** (2026-07-13) | backend | 3 | take 200 + order expiresAt + skip expired |
| PRIV-001 Analytics / DSAR | Low | **done** (2026-07-13) | consumer | 4 | Minimize + opt-out + Settings DSAR action |
| A11Y-001 Critical screens | Low | **done** (partial) | consumer | 4 | Balance + confirm send labels; more optional |
| TEST-001 Automated gates for former blockers | Med | **done** (2026-07-13) | both | 4 | `TEST001_blockerGates.test.ts` backend+consumer |
| A2 verification sweep | Med | **done** (2026-07-13) | consumer | 4 | `plans/A2_VERIFICATION.md` |
| Aptos removal / logo / public-private activity | — | **done** | consumer | — | Prior session |

---

## Explicit non-goals (this track)

- Full EVM **max** withdraw product epic (keep gated; separate epic after SPP dogfood).
- Mainnet SPP contracts / merchant product expansion.
- Remaster audit before Phase 1–2 exit gates.

---

## Phase exit notes

### Phase 0 — Inventory freeze

- [x] This file created from cross-check (2026-07-13).
- [ ] Team acknowledges statuses (no code required).

### Phase 1 — Payment integrity

- [x] HTTP confirm verifies chain fact before write (`verifyPaymentTxOnChain`).
- [x] Tests: unauth 401; wrong merchant 404; fake txHash fails; duplicate txHash idempotent.

### Phase 2 — SPP recoverability + gates

- [x] Cold start / restore runs coordinated recovery when `poolOps` (`useSppBackgroundSetup`).
- [x] Hard gate shield/transfer/unshield without `poolOps` (privacy options + send preflight).
- [x] DATA-002 remains false with tests.
- [x] Dogfood pool-ops APK: shield + recovery pass (2026-07-13).
- [x] Public activity refresh after SPP success.
- [x] Private pre-install activity history: accepted residual (local-only by design).

### Phase 3 — Abuse & API hardening

- [x] SEC-003 register: rate limit + prod pending + optional invite token + tests.
- [x] SEC-006 residual: `RELAYER_SHARED_SECRET` / `X-Relayer-Secret` gate.
- [x] SEC-004 residual: caps remain; app-attest deferred as accepted risk.
- [x] REL-002 outbox before HTTP + idempotent jobId (already in tree; tests cover).
- [x] PERF-002 indexer: max 200 pending/sweep, soonest expiry first.

### Phase 4 — Quality / A2 / TEST-001

- [x] TEST-001 backend + consumer blocker gate suites.
- [x] PRIV-001 DSAR action in Settings + analytics tests.
- [x] PERF-001 balance poll AppState backoff (gas already gated).
- [x] PERF-003 SPP note list already parallel.
- [x] A11Y confirm send labels; balance card already labeled.
- [x] A2 checklist filed: `plans/A2_VERIFICATION.md`.

### Phase 5 — Remaster

- [x] Re-verify all IDs + residuals (2026-07-13).
- [x] Honest scorecard published: `plans/REMASTER_AUDIT_2026-07-13.md`.
- [x] Older `PRODUCTION_READINESS_AUDIT.md` pointed at remaster.
- [ ] Operator: commit Phase 1–4 tree + `git tag remaster-2026-07-13` (working tree still dirty at remaster time).

---

## Monday-morning order

1. Phase 0 — this backlog  
2. Phase 1 — SEC-001 residual (on-chain verify)  
3. Phase 2 — DATA-001 / SPP gates (parallel with 1 OK)  
4. Dogfood APK after Phase 2  
5. Remaster only after 1–4 freeze  

---

## Max withdraw epic (deferred)

Document only: wire Merkle path + nullifierHash on deposit, prover, relayer withdraw, e2e deposit→restart→withdraw, then flip `EVM_MAX_PRIVACY_WITHDRAW_READY`. Not Phase 1–4 of this program.
