# VeilPay Audit Remediation — Session Handoff

**Source audit:** VP-AUDIT-2026-07-14 (provisional static review, HEAD `ceaeb58`)
**Handoff written:** 2026-07-14
**Branch:** main

---

## State of the working tree

⚠️ **Uncommitted.** This session's fixes are in the working tree, NOT committed.
Commit as `codeREDxbt`, no `Co-Authored-By` line (per repo convention).

Files changed this session:
- `apps/backend/src/controllers/healthController.ts` — PERF-001
- `apps/backend/src/controllers/__tests__/healthController.test.ts` — test rewire
- `apps/backend/src/index.ts` — SEC-009
- `apps/backend/src/middleware/rateLimiter.ts` — SEC-002 limiter
- `apps/backend/src/routes/merchant.ts` — SEC-002 wiring
- `.github/workflows/ci.yml` — TEST-004 CI step
- `apps/indexer/package.json` — TEST-004 `--forceExit`
- `apps/indexer/src/config/__tests__/index.test.ts` — TEST-004 `.js`→`.ts` import fix

(Note: `graphify-out/GRAPH_REPORT.md` and a few files were already dirty before this
session — line-ending churn, unrelated. Don't commit the graphify report.)

---

## ✅ Done (5)

| ID | Fix | Verified |
|---|---|---|
| PERF-001 | `checkRedis()` reuses shared `getRedisClient()` singleton instead of new-per-probe (+ leak on error path) | backend suite 318 pass |
| SEC-009 | Removed `\|\| "veilpay_dev_session_secret"` fallback (config makes it unreachable anyway) | typecheck + suite |
| TEST-004 | Indexer suite was **broken + hung**: fixed `'../index.js'` import bug (5 tests never passed) and added `--forceExit` for the eager-Redis open handle; wired `Test indexer` into CI | 56/56 pass, exits clean |
| SEC-002 | Added `registrationRateLimiter` (5/15min IP) on `/register` — it had **no** limiter. Kept the 409 message (status code is the real oracle; genericizing = theater) | merchant+ratelimiter suites pass |
| SEC-001 | RPC proxy budget circuit-breaker + alerting. New `utils/rpcBudget.ts` (per-UTC-day upstream-call budget, Redis-backed + in-mem fallback; consecutive-failure circuit breaker) and `utils/alerting.ts` (throttled Sentry+log ops alerts). Wired into both POST/GET handlers in `routes/rpc.ts`: fail-closed 503 on open circuit / exhausted budget; record 429/5xx/network as failures. `RPC_DAILY_BUDGET` env (default 200k). **Attestation deliberately out** — stays as documented future-hardening note. | 330 pass / 2 skip, +12 new tests |

**SEC-002 is partial** — the complete non-enumeration fix is async email verification (return identical response for new vs existing). That's the P2 "part 2" below.

**SEC-001 is the code half.** Device attestation (App Attest/Play Integrity) is ops+mobile work, left as the `SECURITY(hardening)` note on `rpcRateLimiter` in `rateLimiter.ts`.

---

## Verification commands (all currently green)

```bash
pnpm --filter @veilpay/backend typecheck
pnpm --filter @veilpay/backend test          # 330 pass / 2 skip (was 318; +12 SEC-001)
pnpm --filter @veilpay/indexer test          # 56 pass, exits clean
pnpm --filter @veilpay/backend lint          # 0 errors (3 pre-existing warns)
pnpm --filter @veilpay/indexer lint          # clean
```

---

## ⬜ Remaining: 21 items

### P0 — release-gating (4 remaining)
- ~~**SEC-001 / RB-05** *(code)* — budget circuit-breaker + alerting~~ ✅ **DONE** (see above). Remaining sub-item is device attestation/app-token — *ops+mobile*, not editor work; tracked as future hardening.
- **RB-01 / SEC-007 / RB-04** *(process)* — Privacy ceremony + external audit (SEC-008/011 open). Until signed: keep fail-closed, no mainnet privacy marketing. `docs/security/ceremony-and-audit-gates.md`.
- **RB-02** *(ops)* — Prod secrets/CORS boot-checklist dry-run. `apps/backend/src/config/index.ts` already fail-fasts; verify against `docs/.../production-checklist.md`.
- **RB-03** *(ops)* — Release build has real `EXPO_PUBLIC_SSL_PINS` (app throws in release without).
- **SEC-004** *(ops)* — Relayer secret set / `RELAYER_ALLOW_UNAUTHENTICATED` NOT true. `apps/backend/src/middleware/relayerAuth.ts`.

### P1 (7 remaining)
- **UX-002** *(code)* — Wire 1–2 Maestro flows (onboarding + send) into CI. `e2e/` scaffold exists, selectors unfinished.
- **PROD-001** *(product)* — Merchant dashboard MVP **or** explicit "API-only" GTM doc (no `apps/frontend` in repo).
- ~~**ARCH-004** *(code, small)* — Align Prisma `PrivacyLevel` with app levels~~ ✅ **DONE**. Enum + all zod/OpenAPI validators widened `standard|max` → `standard|stealth|max|private` (matches `settingsStore.ts`). Additive migration `20260714010000_privacy_level_stealth_private` (`ALTER TYPE ADD VALUE`, no data backfill). Backend is passthrough (stores/echoes, never branches), so no privacy behavior activates. **Migration not yet applied to any DB** — no DB reachable here; `prisma migrate deploy` on next deploy.
- **ARCH-002** *(arch)* — Split workers from API process / multi-replica (`railway.json` numReplicas:1; `apps/backend/src/index.ts` co-hosts workers).
- **ARCH-003** *(ops)* — Single indexer owner doc (dual path: `apps/backend/src/jobs/chainIndexer.ts` + `apps/indexer`).
- **REL-004** *(ops)* — Document RPO/RTO + backup drill.
- **§17-5** *(docs)* — Document public API surface honestly (wallet vs merchant).
- **§17-7** *(ops)* — Production runbook checklist dry-run.

### P2 (6)
- **SEC-002 part 2** *(code)* — Async email verification (complete the enumeration fix).
- **A11Y-001** *(code)* — Money-flow accessibility labels + SR smoke (CI has a heuristic gate only).
- **A11Y-002** — Declare a WCAG target.
- **SEC-006** — iOS screenshot protection for seed/export (`security.ts canBlockScreenshots()` is Android-only).
- **PROD-002** *(code)* — Finish or hide max-privacy TODOs (`usePaymentTransaction.ts` directory/Merkle path).
- **CODE-001 / UX-003** — Break up 44 KB modules; runtime review of export/backup screens.

### P3 (3)
- **SEC-003** — Watch invoice-status endpoint for future field leaks.
- **LOC-001** — i18n foundation (currently en-US hardcoded).
- **PRIV-002** — DSAR / account-wipe flow.

---

## Recommended next step

Pure-code items that land cleanly like today's did:
**SEC-001** (RPC budget breaker + alerting — P0, highest value) or **ARCH-004** (small enum alignment, but needs a Prisma migration).

The other ~16 remaining items are ops/process/product decisions needing the owner's input
(secrets, ceremony sign-off, GTM direction, WCAG target) — not editor work.

---

## Context notes
- Consumer app: max/stealth privacy is correctly-gated **dead code** on an undeployed pool — do not "finish" max. Track A = harden live standard send/receive. (`plans/consumer-hardening-and-spp-phase0.md`)
- SPP is testnet-only, self-custody-first, fail-closed on mainnet.
- Sensitive ops (spend/withdraw/deposit/reveal) always require biometric-or-PIN.
