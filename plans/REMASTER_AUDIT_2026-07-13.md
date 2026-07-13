# VeilPay remaster audit — 2026-07-13

> **Type:** Phase 5 remaster (read-only verification + honest scorecard)  
> **Branch:** `harden/consumer-a1-and-spp-phase0`  
> **Workspace tip SHA (committed):** `823ad27`  
> **Working tree:** large uncommitted hardening + SPP track (Phases 0–4) — **not a clean freeze tag**  
> **Program plan:** Phase 0–4 complete per `plans/AUDIT_BACKLOG.md`  
> **Supersedes inflated historical “10/10” claims** in older `plans/*AUDIT*` docs for **this** track’s verdict.

---

## Executive summary

| Question | Verdict |
|----------|---------|
| **Dogfood / Stellar testnet self-custody** | **PASS — ready to dogfood** |
| **Mainnet production (merchant + EVM max + SPP mainnet)** | **NOT READY** |
| **Critical open findings (funds/auth)** | **None re-opened** from closed Phase 1–3 IDs |
| **Honest overall (dogfood bar)** | **76 / 100 — Strong for dogfood, not mainnet** |
| **Honest overall (mainnet bar)** | **58 / 100 — Weak** (intentional product gates + residual infrastructure) |

This remaster **re-verified living backlog IDs against source + focused Jest**, and incorporates **device dogfood** (pool-ops release APK): shield works, private balance recovers after reinstall, max stays off, splash fixed via release+Doppler build path.

**Do not** treat older “10/10 production ready” language as current truth.

---

## Freeze / evidence package

| Item | Value |
|------|--------|
| Living backlog | `plans/AUDIT_BACKLOG.md` |
| Dogfood checklist | `plans/spp-dogfood-recovery-checklist.md` (device pass noted 2026-07-13) |
| A2 sheet | `plans/A2_VERIFICATION.md` |
| TEST-001 | `apps/backend/src/__tests__/TEST001_blockerGates.test.ts` + `apps/consumer-app/src/__tests__/TEST001_blockerGates.test.ts` |
| Remaster smoke (this session) | Backend TEST001 + paymentTxVerifier + relayerAuth: **24 pass**; consumer TEST001 + privacy options: **15 pass** |
| APK path | `apps/consumer-app/build-artifacts/veilpay-preview-poolops-release.apk` (Doppler + embedded JS + pool-ops `.so`) |

**Freeze note:** Recommend tagging after commit of the uncommitted Phase 1–4 tree, e.g. `git tag remaster-2026-07-13`. Remaster scores assume that tree as the product under audit.

---

## Re-verification table (prior IDs)

| ID | Claimed | Remaster | Evidence (paths / notes) |
|----|---------|----------|---------------------------|
| SEC-001 auth confirm | done | **confirmed** | `routes/payment.ts` authMiddleware+requireAuth; tests |
| SEC-001 on-chain verify | done | **confirmed** | `paymentTxVerifier.ts` + controller; EVM viem + non-EVM Goldrush match |
| SEC-002 SSRF | done | **confirmed** | `urlSafety.ts` + tests |
| SEC-003 register abuse | done | **confirmed** | prod `pending`, invite token, rate limit, tests |
| SEC-004 RPC caps | done / attest accepted | **confirmed** | batch/logs/response caps; **no** app-attest (accepted residual) |
| SEC-005 onramp token | done | **confirmed** | `onrampStatusToken.ts` |
| SEC-006 relayer | done + caller gate | **confirmed** | quotas + `relayerCallerAuth` |
| REL-001 / DATA-003 | done | **confirmed** | transactional confirm + idempotency tests |
| REL-002 webhooks | done | **confirmed** | outbox before enqueue, stable jobId |
| DATA-001 SPP recovery | done (dogfood) | **confirmed** | recovery coordinator + device report |
| DATA-002 max withdraw | gated off | **confirmed** | `EVM_MAX_PRIVACY_WITHDRAW_READY === false` |
| SPP-001 poolOps gates | done | **confirmed** | privacy options + send preflight |
| DEV-001 npm audit CI | done | **confirmed** | `better-npm-audit --level=high` in CI |
| PERF-002 indexer | done | **confirmed** | take 200, expiry order |
| PRIV-001 analytics | done | **confirmed** | minimize + DSAR Settings action |
| TEST-001 | done | **confirmed** | gate suites green this session |
| UX private history pre-install | accepted residual | **confirmed residual** | local activity only by design |
| SEC-004 app-attest | accepted residual | **confirmed residual** | public read proxy + caps only |

---

## New / residual findings (this remaster)

Severity: **Critical / High / Med / Low / Info**. No Critical re-opened.

| Sev | Domain | Finding | Status |
|-----|--------|---------|--------|
| **Med** | Security | HTTP confirm ERC-20 path verifies receipt+recipient but not full transfer-log amount decode (native ETH value enforced) | Residual — document; prefer indexer for tokens |
| **Med** | Reliability | Goldrush service remains a **stub** (`fetchGoldrushTransactions` often empty) — non-EVM HTTP confirm + indexer depend on real indexer wiring | Residual — ops/infra |
| **Med** | Security | Relayer prod requires `RELAYER_SHARED_SECRET` — must be set in Doppler or withdraw returns 503 | Ops checklist |
| **Low** | UX | Private activity feed does not reconstruct pre-install history | **Accepted** residual |
| **Low** | A11Y | Critical labels improved; full a11y suite / contrast CI not done | Residual Phase backlog |
| **Low** | Process | Working tree not committed/tagged; remaster score is against dirty tree + tip `823ad27` | Tag after land |
| **Info** | Product | EVM max withdraw intentionally off; mainnet SPP fail-closed | Non-goal this track |
| **Info** | Build | Debug APK hangs without Metro; dogfood uses **release** + Doppler | Documented |

---

## Scorecard (honest)

Weights oriented to **payment / wallet / funds safety**. Scores are **evidence-based**, not aspirational.

| Domain | Weight | Score | Band | Notes |
|--------|--------|------:|------|-------|
| **Security** | 25% | **78** | Strong | Auth, SSRF, confirm verify, relayer gate, quotas, pending register. Gaps: ERC-20 decode, Goldrush stub, no app-attest/cert pin. |
| **Data / funds integrity** | 25% | **80** | Strong | SPP recovery dogfood pass; payment atomicity; max gated. Cap: EVM max unfinished; note recovery ≠ private ledger history. |
| **API / abuse** | 15% | **76** | Strong | Rate limits, RPC caps, register pending, relayer secret. |
| **Reliability** | 10% | **72** | Adequate+ | Webhook outbox solid; indexer bounded; Goldrush mock limits automated multi-chain confirm. |
| **SPP product** | 10% | **78** | Strong | pool-ops dogfood shield/recovery; mainnet closed correctly. |
| **UX / a11y** | 5% | **70** | Adequate | Privacy chrome solid; activity residuals; a11y partial. |
| **Performance** | 5% | **72** | Adequate+ | AppState poll backoff; note list parallel; indexer take 200. |
| **Testing / gates** | 5% | **76** | Strong | TEST-001 + focused suites; not full monorepo CI green on freeze SHA. |

### Composite

| Bar | Formula emphasis | Score | Verdict |
|-----|------------------|------:|---------|
| **Dogfood / Stellar testnet** | Security + funds + SPP | **~76** | **Ship dogfood** |
| **Mainnet production** | Cap if Critical product gaps | **~58** | **Do not claim mainnet ready** |

**Confidence:** High on security control presence (source + tests). Medium on full monorepo CI (dirty tree, graphify churn). Device dogfood: High for reported shield/recovery path.

---

## Release verdict

### Ship now (recommended)
- **Consumer pool-ops preview APK** on **Stellar testnet** for internal dogfood.
- Backend hardening from this track to staging/prod **with** Doppler secrets: on-chain confirm, SSRF, webhook outbox, register pending, `RELAYER_SHARED_SECRET`.

### Do not claim yet
- Mainnet SPP.
- EVM max privacy withdraw “production ready.”
- Merchant platform expansion.
- Perfect historical audit scores (10/10) — **invalidated** for current readiness narrative.

---

## Code review notes (Phase 1–4 surfaces only)

| Area | Review note |
|------|-------------|
| `paymentTxVerifier` | Correct fail-closed pattern; ERC-20 amount still invoice-claim aligned not log-decoded — track as residual. |
| `relayerCallerAuth` | Timing-safe compare good; ensure prod Doppler has secret. |
| SPP recovery + gates | Fail-closed without poolOps correct; recovery restores balance not activity history — intentional. |
| Indexer PERF-002 | Bound + expiry filter good; still full Goldrush per address in batch of 200. |
| Analytics DSAR | Local erase only; document Mixpanel server DSAR for operators. |

---

## Next backlog (post-remaster only)

1. **Commit + tag** Phase 1–4 tree; re-run full backend + consumer Jest + CI on tag.  
2. **Goldrush / real multi-chain indexer** for non-EVM confirm + indexer path.  
3. **ERC-20 transfer log verify** on HTTP confirm (or disable HTTP confirm for non-native).  
4. **Ops:** set `RELAYER_SHARED_SECRET`, confirm register invite token policy.  
5. Optional UX: private activity reconstruction epic (separate).  
6. EVM max withdraw product epic (after SPP dogfood solid) — still **not** this remaster.  
7. Mainnet SPP ceremony / audit gate — separate program.

---

## Pointer for older docs

| Doc | Status |
|-----|--------|
| `plans/PRODUCTION_READINESS_AUDIT.md` | Historical; prepend pointer to **this remaster** for current verdict |
| `plans/AUDIT_REPORT.md` / full_stack “10/10” | **Do not use** for ship decisions |
| `plans/AUDIT_BACKLOG.md` | Living status — still authoritative for IDs |

---

## Remaster exit checklist

- [x] Re-verify prior IDs against source  
- [x] New/residual findings listed (no Critical open)  
- [x] Code review notes on Phase 1–4 surfaces  
- [x] Honest scorecard (dogfood vs mainnet)  
- [x] Release verdict + next backlog  
- [ ] Git tag of clean freeze SHA (operator step after commit)
