# VeilPay Audit Remediation — Session Handoff

**Source audit:** VP-AUDIT-2026-07-14 (provisional static review, HEAD `ceaeb58`)
**Handoff updated:** 2026-07-14
**Branch:** main

---

## Scope constraint

**Do not work merchant / registration / merchant-API items** unless the owner
explicitly asks. Consumer wallet + send/receive + privacy gates only.

That means **SEC-002 part 2** (async merchant email verification) is **deferred**
and out of active remediation scope.

---

## ✅ Done (on main)

| ID | Commit | Notes |
|---|---|---|
| PERF-001, SEC-009, SEC-002 (register rate limit only — prior), TEST-004 | `30f2e96` | Merchant rate-limit was prior work; no further merchant work |
| SEC-001 RPC budget breaker | `84c68ec` | Attestation still residual |
| ARCH-004 PrivacyLevel enum | `70ae19b` | Migration not applied to any DB yet |
| A11Y-001, PROD-002, SEC-003 | `3af3043` | Money-flow labels + invoice field lock |
| **UX-002, A11Y-002, LOC-001, PRIV-002** | *(this commit)* | Consumer-only |

---

## ✅ This commit (consumer-only)

| ID | Fix | Verified |
|---|---|---|
| **UX-002** | Maestro onboarding + send flows on real `testID`s; `scripts/validate-maestro-flows.mjs` + CI step | validator ok |
| **A11Y-002** | WCAG **2.2 Level AA** target in `docs/consumer-app/accessibility.md` | doc |
| **LOC-001** | Lightweight i18n foundation (`src/i18n`, en-US, `t()`), onboarding + wipe copy | i18n tests |
| **PRIV-002** | Local account wipe + Settings action + `docs/consumer-app/dsar.md` | accountWipe tests |

**Do not commit** `graphify-out/GRAPH_REPORT.md`.

### Key files

- `e2e/flows/onboarding.yaml`, `send_payment.yaml`, `e2e/README.md`
- `scripts/validate-maestro-flows.mjs`
- `.github/workflows/ci.yml`
- `apps/consumer-app/src/i18n/**`
- `apps/consumer-app/src/utils/accountWipe.ts` + tests
- `apps/consumer-app/src/screens/{Onboarding,Settings,SendPayment,WalletConnect}Screen.tsx`
- `apps/consumer-app/src/hooks/useBiometrics.ts` (`account_wipe` context)
- `docs/consumer-app/accessibility.md`, `dsar.md`, `docs/SUMMARY.md`

---

## Verification

```bash
node scripts/validate-maestro-flows.mjs
cd apps/consumer-app && npx jest --testPathPattern="i18n|accountWipe|OnboardingScreen|SettingsScreen" --forceExit
cd apps/consumer-app && npx tsc --noEmit
```

---

## ⬜ Remaining (prefer consumer / ops; skip merchant)

### P0 ops
- RB-01 / ceremony, RB-02 secrets, RB-03 SSL pins, SEC-004 relayer secret

### P1
- PROD-001 *(product — skip merchant dashboard until asked)*
- ARCH-002/003, REL-004, §17-5, §17-7

### P2 consumer-relevant
- **SEC-006** — iOS screenshot protection for seed/export
- **CODE-001 / UX-003** — split large modules; export/backup review

### Deferred (merchant)
- **SEC-002 part 2** — async email verification / enumeration fix — **out of scope**

### Ops follow-ups
- ARCH-004: `prisma migrate deploy` on next deploy
- Device Maestro: `maestro test e2e/flows/onboarding.yaml`

---

## Context notes
- Consumer app: max/stealth privacy remains gated dead code — do not “finish” max.
- SPP testnet-only, fail-closed on mainnet.
- Sensitive ops (spend / export / **account wipe**) require biometric-or-PIN.
