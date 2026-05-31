# 🚀 VeilPay Hardening & Vibe Coding Implementation Plan

The user has selected to knock out all 6 remaining "sneaky" technical debt and feature items. This is a non-trivial amount of work, but fundamentally beautiful. We're going to build this out from scratch, ensuring the abstraction layers make sense and the UX is perfectly minimal. 

Here is how we will orchestrate this across the entire Software 2.0 stack.

## Proposed Changes

### 1. Webhook Delivery & Queue Wiring (Backend) - ✅ COMPLETE
The webhook delivery module is now fully hooked into the BullMQ worker and index.ts.
- **[MODIFY] `apps/backend/src/jobs/webhookQueue.ts`** - Refactored as producer
- **[NEW] `apps/backend/src/jobs/webhookWorker.ts`** - Consumer logic separated
- **[MODIFY] `apps/backend/src/jobs/webhookDelivery.ts`** - Cleaned up unused variables
- **[MODIFY] `apps/backend/src/routes/invoice.ts`**
  - Ensure `enqueueWebhook` is properly emitting the `invoice.paid` event.

### 2. State Migration Versioning (Zustand)
Under the hood, `walletStore.ts` already has a `migrate` function for `version: 1 -> 2`, but the persistent state is still declared as `version: 1`.
- **[MODIFY] `apps/consumer-app/src/stores/walletStore.ts`**
  - Bump `version` from `1` to `2`.
  - Explicitly clear `pushToken` and `latestTransakOrder` during `disconnect()`.
  - Ensure `hasHydrated` is resilient to schema changes.

### 3. Solana & Aptos Send UI / Modules
Building native signing from scratch for Solana and Aptos requires pulling in heavy cryptography libraries (`@solana/web3.js` and `aptos` SDK), which bloats the React Native bundle. Since this is an EVM-first release:
- **[MODIFY] `apps/consumer-app/src/screens/SendPaymentScreen.tsx`**
  - Fully hide the "Send" flow for SVM and MVM chains instead of just showing a disabled button.
  - Show a pristine "Coming Soon" Sovereign state for non-EVM chains.

### 4. Bootstrap Retry Mechanism
I noticed that `App.tsx` actually *does* have a 3-attempt exponential backoff loop already, but the UX during the retry is opaque.
- **[MODIFY] `apps/consumer-app/App.tsx`**
  - Update the `bootSubtitle` text to actively reflect the retry attempts (e.g., "Retrying connection (1/3)...").

### 5. Empirical E2E Maestro Flows
The current YAML files are just stubs. We will "vibe code" the exact interaction scripts.
- **[MODIFY] `apps/consumer-app/.maestro/flow_fiat_onramp.yaml`**
- **[MODIFY] `apps/consumer-app/.maestro/flow_max_privacy_payment.yaml`**
- **[MODIFY] `apps/consumer-app/.maestro/flow_network_degradation.yaml`**
- **[MODIFY] `apps/consumer-app/.maestro/flow_send_payment.yaml`**
- **[MODIFY] `apps/consumer-app/.maestro/flow_wallet_import.yaml`**
  - Add explicit `tapOn`, `inputText`, and `assertVisible` statements to match the exact Sovereign Minimalist UI copy.

### 6. The Sovereign Minimalist UI Migration (Phase 3)
We are stripping out the "Frankenstein" NeoPop mix from the core app.
- **[MODIFY] `apps/consumer-app/src/screens/HomeDashboardScreen.tsx`**
- **[MODIFY] `apps/consumer-app/src/screens/CreateWalletScreen.tsx`**
- **[MODIFY] `apps/consumer-app/src/screens/ImportWalletScreen.tsx`**
- **[MODIFY] `apps/consumer-app/src/screens/SendPaymentScreen.tsx`**
  - Replace `NeoPopCard` / `NeoPopButton` with `SovereignCard` / `SovereignButton`.
  - Remove 1px internal dividers.
  - Align fonts strictly to `Manrope` (Headers) and `Inter` (Body).

---

> [!IMPORTANT]
> **User Review Required:** 
> Do you want me to literally build out the Solana/Aptos transaction signing using their respective SDKs, or are you okay with just gracefully hiding the UI for non-EVM chains for this specific launch? 

## 🚀 Architecture & UI De-bloat Plan

> **Status:** ✅ COMPLETED (Execution finished 2026-05-23). The UI is strictly Sovereign Minimalist, monolithic screens are decomposed, tests are green, and the web3 stack is unified under `viem`.

## Current State & Issuests
- Run `maestro test apps/consumer-app/.maestro/` to empirically verify the E2E flows on an emulator.
- Run `npm test` in `apps/backend` to ensure the BullMQ worker starts without syntax errors.

### Manual Verification
- Start the app, log out, and check that `pushToken` drops from local storage.
- Disconnect the network locally, launch the app, and verify the UI shows "Retrying connection...".
- Navigate to the Home Dashboard and verify all harsh borders and NeoPop shadows have been nuked.

## Audit Refresh

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 69 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 48
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 69 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 48
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 88 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 64
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 62 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 38
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 69 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 44
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 69 | Code Quality 0 | UX Polish 80 | Performance 78 | Production-Readiness 0
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 93 | Code Quality 0 | UX Polish 80 | Performance 78 | Production-Readiness 0
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 94 | UX Polish 80 | Performance 78 | Production-Readiness 94
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 0 | UX Polish 80 | Performance 78 | Production-Readiness 0
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 51 | UX Polish 80 | Performance 78 | Production-Readiness 51
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 94 | UX Polish 80 | Performance 78 | Production-Readiness 94
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 80 | Performance 78 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 80 | Performance 78 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 80 | Performance 78 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 85 | Performance 85 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 85 | Performance 85 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)
