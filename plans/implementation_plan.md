# VeilPay Mainnet Hardening Plan — Final Verified

> **Target:** Production-ready in 4 weeks (mainnet launch ~May 22, 2026)
> **Stack:** Free-tier RPCs with failover · Doppler secrets · Maestro E2E · Single-instance backend
> **Current Score:** 8.7/10 (verified, adjusted from inflated 9.1/10) → **Target Score: 9.2/10**
> **Last verified:** 2026-05-04 — Full file-by-file code audit completed
> **Audit Report:** See [AUDIT_REPORT.md](AUDIT_REPORT.md) for comprehensive security scoring
> **Consumer App Audit:** See [consumer-app-production-audit.md](consumer-app-production-audit.md) for per-area scores

---

## Sprint Summary: What's Done vs What's Left

### ✅ Completed (Verified Against Source Code)

| # | Item | Files | Status |
|---|---|---|---|
| 1.1 | Doppler secrets management — `.env.example` documented, config rejects dev defaults in production | `.env.example`, `config/index.ts` | ✅ DONE |
| 1.2 | RPC Provider Pool — weighted round-robin, circuit breaker, health checks | `rpcPool.ts` (367 lines) | ✅ DONE |
| 1.3 | Dynamic Gas Estimation — EIP-1559, 15% buffer, 30s cache, static fallback | `gasEstimator.ts` (223 lines) | ✅ DONE |
| 1.4 | Secure Signer — signing closure pattern | `secureSigner.ts` (355 lines) | ✅ DONE |
| 1.5 | Production Environment Enforcement — Zod schema, placeholder rejection, CORS check | `config/index.ts` (116 lines) | ✅ DONE |
| 2.1 | Solana Devnet + Sepolia as built-in chains | `walletStore.ts`, `rpc.ts`, `balanceFetcher.ts` | ✅ DONE |
| 2.2 | Custom Network Management UI | `AddCustomNetworkScreen.tsx` (9,925 bytes) | ✅ DONE |
| 2.3 | NetworkStatusBanner wired up | `HomeDashboardScreen.tsx`, `PaymentConfirmationScreen.tsx` | ✅ DONE |
| 2.4 | Price Fallback alignment ($3,200 shared constant) | `priceFeed.ts:16` — `FALLBACK_ETH_PRICE = 3200` | ✅ DONE |
| 2.5 | Clipboard auto-clear for seed phrase (30s) | `CreateWalletScreen.tsx`, `SettingsScreen.tsx` | ✅ DONE |
| 2.6 | Rate Limiter LRU+TTL cache | `rateLimiter.ts` — `MerchantLimiterCache` class | ✅ DONE |
| 3.1 | Consumer app unit tests | 12 utils tests + 1 transak test | ✅ DONE |
| 3.2 | Backend test suite | 4 test files (auth, rateLimiter, invoice, merchant) | ✅ DONE |
| 3.3 | E2E scaffolding with Maestro | 6 flow YAML files | ✅ DONE (stubs) |
| 3.x | Screen tests | 6 screen tests (Deposit, Home, Onboarding, Settings, WC, Withdraw) | ✅ DONE |
| 3.x | Store tests | `walletStore.test.ts` | ✅ DONE |
| 4.1 | Tx History N+1 fix — 50-block cap | `transactionHistory.ts` | ✅ DONE |
| 4.2 | Deep Link Security Hardening — full input sanitization | `deepLinking.ts` (233 lines, 8 validation checks) | ✅ DONE |
| 4.3 | Accessibility Fixes — contrast, live regions, touch targets | 16+ files, Toast.tsx, HomeDashboard, PaymentConfirmation | ✅ DONE |
| 4.6 | Webhook Delivery Module | `webhookDelivery.ts` — file created | ⚠️ PARTIAL (not wired) |
| NEW | Transaction Status Poller | `txStatusPoller.ts` (196 lines) | ✅ DONE |
| NEW | Transaction Replacement (speedup/cancel) | `secureSigner.ts:249-354` | ✅ DONE |
| NEW | WalletConnect Signing Response | `walletConnectSession.ts:262-286` | ✅ DONE |
| NEW | WC Session Listener Registration | `walletConnectSession.ts:305-328` | ✅ DONE |
| NEW | Env Validation at Startup | `envValidation.ts` (180 lines) | ✅ DONE |
| NEW | Sentry dev-mode init + breadcrumbs | `sentry.ts` (88 lines) | ✅ DONE |
| NEW | Console.log stripping | `babel.config.js` | ✅ DONE |
| NEW | CI/CD Pipeline | `ci.yml`, `consumer-app-eas.yml` | ✅ DONE |
| NEW | Solana Balance Fetching (JSON-RPC) | `balanceFetcher.ts:97-157` | ✅ DONE |
| NEW | Aptos Balance Fetching (REST API) | `balanceFetcher.ts:159-224` | ✅ DONE |
| NEW | AppState foreground refresh | `App.tsx` | ✅ DONE |

### ⚠️ Remaining Work (Blocking 9.2/10)

| # | Item | Priority | Effort | Impact on Score |
|---|---|---|---|---|
| R-1 | **Wire webhook delivery to Express** — import `webhookDelivery.ts` into invoice routes, deploy Redis | HIGH | 1 day | +0.15 |
| R-2 | **State migration versioning** — add version key + migration function to Zustand persist | MEDIUM | 0.5 day | +0.10 |
| R-3 | **Disable Solana/Aptos send UI** — show "Coming soon" badge or hide send button for non-EVM chains | MEDIUM | 0.5 day | +0.05 |
| R-4 | **Flesh out E2E Maestro flows** — convert 6 stubs to real assertions with test data | MEDIUM | 2 days | +0.10 |
| R-5 | **Measure test coverage** — add `--coverage` to CI and set 60% threshold | LOW | 0.5 day | +0.05 |
| R-6 | **Bootstrap retry mechanism** — retry wallet restore on first launch failure | LOW | 0.5 day | +0.05 |
| R-7 | **Clean up dead code** — remove `startTransaction()` null return in sentry.ts, unused `CANCEL_VALUE` | LOW | 0.5 day | +0.02 |
| R-8 | **Pool lifecycle cleanup** — call `destroy()` on AppState background | LOW | 0.5 day | +0.02 |

**Estimated effort for remaining work: ~6 days**

---

## 🆕 Newly Discovered Issues (from final sweep)

> [!CAUTION]
> The following 6 issues were found during the original final review and are now resolved or tracked.

| # | Issue | Status |
|---|---|---|
| **N1** | Solana devnet missing from `SUPPORTED_CHAINS`, `NETWORKS`, etc. | ✅ FIXED — all chain maps updated |
| **N2** | `NetworkStatusBanner` is never rendered (dead code) | ✅ FIXED — mounted in HomeDashboard and PaymentConfirmation |
| **N3** | Transaction history O(N×M) block scanning | ✅ FIXED — 50-block cap on blockchain fallback |
| **N4** | `balanceFetcher.ts` only supports EVM chains | ✅ FIXED — Solana + Aptos balance fetching implemented |
| **N5** | Inconsistent fallback prices ($3,000 vs $3,200) | ✅ FIXED — aligned to shared `FALLBACK_ETH_PRICE = 3200` |
| **N6** | `react-native-crypto-js` unused | Confirmed absent — I-3 in audit report |

---

## Complete File Change Manifest (Verified)

| Phase | File | Action | Category | Verified |
|---|---|---|---|---|
| 1.1 | `.env.example` | NEW | Secrets | ✅ 3,346 bytes |
| 1.1 | `config/index.ts` | MODIFY | Secrets | ✅ 4,346 bytes |
| 1.2 | `src/utils/rpcPool.ts` | NEW | RPC | ✅ 13,009 bytes, 367 lines |
| 1.2 | `src/utils/rpc.ts` | MODIFY | RPC | ✅ 4,854 bytes |
| 1.2 | `src/utils/transactions.ts` | MODIFY | RPC | ✅ 18,661 bytes, uses `poolCall` |
| 1.2 | `src/utils/balanceFetcher.ts` | MODIFY | RPC | ✅ 10,886 bytes, uses `poolCall` |
| 1.2 | `src/utils/transactionHistory.ts` | MODIFY | RPC | ✅ 14,199 bytes |
| 1.3 | `src/utils/gasEstimator.ts` | NEW | Gas | ✅ 8,520 bytes, 223 lines |
| 1.4 | `src/utils/secureSigner.ts` | NEW | Security | ✅ 13,553 bytes, 355 lines |
| 2.1 | `walletStore.ts` | MODIFY | Networks | ✅ 17,133 bytes |
| 2.2 | `AddCustomNetworkScreen.tsx` | NEW | Networks | ✅ 9,925 bytes |
| 2.3 | `HomeDashboardScreen.tsx` | MODIFY | Offline | ✅ 35,055 bytes |
| 2.3 | `PaymentConfirmationScreen.tsx` | MODIFY | Offline | ✅ 38,394 bytes |
| 2.4 | `priceFeed.ts` | MODIFY | Prices | ✅ `FALLBACK_ETH_PRICE = 3200` |
| 2.5 | `CreateWalletScreen.tsx` | MODIFY | Security | ✅ 15,188 bytes |
| 2.5 | `SettingsScreen.tsx` | MODIFY | Security | ✅ 21,093 bytes |
| 2.6 | `rateLimiter.ts` | MODIFY | Backend | ✅ 4,725 bytes, LRU cache class |
| 3.x | 12 consumer app test files | NEW | Testing | ✅ All present |
| 3.x | 6 screen test files | NEW | Testing | ✅ All present |
| 3.x | 1 store test file | NEW | Testing | ✅ Present |
| 3.x | 4 backend test files | NEW | Testing | ✅ All present |
| 3.3 | `e2e/` directory (6 flows) | NEW | E2E | ✅ Stubs present |
| 4.1 | `transactionHistory.ts` | MODIFY | Performance | ✅ 50-block cap |
| 4.2 | `deepLinking.ts` | MODIFY | Security | ✅ 7,417 bytes, 8 validation checks |
| 4.3 | Toast.tsx, multiple screens | MODIFY | A11y | ✅ Contrast fixed, live regions added |
| 4.6 | `webhookDelivery.ts` | NEW | Backend | ⚠️ 3,271 bytes — exists but NOT wired |
| NEW | `txStatusPoller.ts` | NEW | UX | ✅ 7,331 bytes |
| NEW | `envValidation.ts` | NEW | Security | ✅ 5,781 bytes |
| NEW | `sentry.ts` | MODIFY | Observability | ✅ 1,978 bytes |
| NEW | `walletConnectSession.ts` | MODIFY | WC | ✅ 8,809 bytes, signing + events |
| NEW | `.github/workflows/ci.yml` | NEW | CI/CD | ✅ 2,267 bytes |
| NEW | `.github/workflows/consumer-app-eas.yml` | NEW | CI/CD | ✅ 1,953 bytes |

**Total: ~15 new files, ~20 modified files, 24 test files, 2 CI workflows**

---

## Verification Plan

### Automated Tests
```powershell
# Unit tests
cd apps/consumer-app && npm test -- --coverage

# Backend tests
cd apps/backend && npm test -- --coverage

# Type checking
cd apps/consumer-app && npx tsc --noEmit
cd apps/backend && npx tsc --noEmit

# E2E (requires emulator)
maestro test e2e/flows/
```

### Manual Verification
- [x] Full wallet creation → send → confirm flow (EVM)
- [x] Deep link injection: reject invalid address, negative amount, script token
- [x] Airplane mode toggle → NetworkStatusBanner appears, send blocked
- [x] Switch to Sepolia → verify balance fetch works
- [x] Switch to Solana Devnet → verify balance fetch works
- [x] Add custom testnet → verify RPC validation
- [x] Verify `FALLBACK_ETH_PRICE = 3200` aligned across priceFeed and marketData
- [ ] Wire webhook delivery and test with BullMQ
- [ ] Verify Doppler: `doppler run -- node -e "console.log(process.env.JWT_SECRET?.length)"`
- [ ] Add state migration versioning and test with schema change

---

## Scoring Journey

| Date | Score | Key Changes |
|---|---|---|
| 2026-04-27 | 6.3/10 | Initial consumer app audit |
| 2026-05-02 | 7.2/10 | Phase 1-2 completion (RPC pool, gas estimator, secure signer) |
| 2026-05-04 (claimed) | 9.1/10 | Post-sprint (inflated — webhook counted as done when not wired) |
| **2026-05-04 (verified)** | **8.7/10** | **Adjusted after file-by-file verification. Webhook delivery is dead code. Multi-chain signing gap noted.** |

---

## Timeline Summary

| Week | Focus | Key Deliverables | Status |
|---|---|---|---|
| **Week 1** | 🚨 Ship Blockers | Doppler, RPC pool, dynamic gas, secure signer, production env | ✅ DONE |
| **Week 2** | 🔧 Mainnet Ready | Sepolia + Solana devnet, custom networks, offline banner, price fix, clipboard clear, rate limiter | ✅ DONE |
| **Week 3** | 🧪 Test Coverage | Unit tests (24 files), Maestro E2E stubs, CI/CD pipeline | ✅ DONE |
| **Week 4** | ✨ Polish | Tx history perf, deep link hardening, a11y fixes, tx poller, WC signing, sentry breadcrumbs | ✅ DONE |
| **Week 4+** | 🔄 Remaining | Wire webhook, state migration, E2E assertions, coverage threshold | ⚠️ 6 days left |

**Target: 9.2/10 achievable by completing R-1 through R-6 (~4 working days).**
