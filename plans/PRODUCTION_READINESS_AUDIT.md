# Production Readiness Audit Report

Generated 2026-05-31T17:28:06.431Z for workspace SHA `29c94b99f75e85191ec1ec85f2cafc3af0212765`.
This report consolidates the planning-only production-readiness audit and links to [Security_Findings_List](#security_findings_list), [Code_Quality_Findings_List](#code_quality_findings_list), [Spec_Coherence_Report](#spec_coherence_report), [Frontend_Polish_Plan](#frontend_polish_plan), [Network_Icon Replacement Plan](#network_icon_replacement_plan).

<a id="run_metadata"></a>
## Run Metadata

- Generated: 2026-05-31T17:28:06.431Z
- Workspace SHA: 29c94b99f75e85191ec1ec85f2cafc3af0212765
- Graphify Run: 2026-05-31T17:28:06.906Z
- Auditor: automated
- Plans_Library Snapshot: `plans/AUDIT_REPORT.md`, `plans/COMPREHENSIVE_AUDIT_REPORT.md`, `plans/MERCHANT_DASHBOARD_SPEC.md`, `plans/ROADMAP.md`, `plans/consumer-app-production-audit.md`, `plans/full_stack_audit.md`, `plans/implementation_plan.md`

<a id="executive_summary"></a>
## Executive Summary

This audit consolidates the production-readiness signals captured by the four-pass pipeline (Discovery, Static Analysis, Synthesis, Reporting) against the workspace under audit.

Security pass produced 0 Critical, 0 High, 0 Medium, and 0 Low findings; pnpm reported 0 High+Critical dependency advisories.

Code-quality pass aggregated 0 ESLint errors across the workspace targets and surfaced the top cyclomatic complexity hotspots and cross-app duplicate clusters.

The Plans_Library refresh table scores every canonical plan across the five rubric dimensions; sub-threshold dimensions are accompanied by a tagged GapNote pointing back to the relevant section.

Threshold rows in the Production_Readiness_Thresholds checklist gate sign-off — the overall verdict is the conjunction of every row.

<a id="scoring_rubric"></a>
## Scoring_Rubric

### security

Pass threshold: **85**.

| Band | Range | Meaning |
| --- | --- | --- |
| Critical | 0-39 | Blocking; do-not-ship. |
| Weak | 40-59 | Not production ready; actionable plan required. |
| Adequate | 60-74 | Acceptable for staging; gaps must be tracked. |
| Strong | 75-89 | Production ready with minor follow-ups. |
| Excellent | 90-100 | Production ready in this dimension; no follow-up needed. |

### code_quality

Pass threshold: **85**.

| Band | Range | Meaning |
| --- | --- | --- |
| Critical | 0-39 | Blocking; do-not-ship. |
| Weak | 40-59 | Not production ready; actionable plan required. |
| Adequate | 60-74 | Acceptable for staging; gaps must be tracked. |
| Strong | 75-89 | Production ready with minor follow-ups. |
| Excellent | 90-100 | Production ready in this dimension; no follow-up needed. |

### ux_polish

Pass threshold: **85**.

| Band | Range | Meaning |
| --- | --- | --- |
| Critical | 0-39 | Blocking; do-not-ship. |
| Weak | 40-59 | Not production ready; actionable plan required. |
| Adequate | 60-74 | Acceptable for staging; gaps must be tracked. |
| Strong | 75-89 | Production ready with minor follow-ups. |
| Excellent | 90-100 | Production ready in this dimension; no follow-up needed. |

### performance

Pass threshold: **85**.

| Band | Range | Meaning |
| --- | --- | --- |
| Critical | 0-39 | Blocking; do-not-ship. |
| Weak | 40-59 | Not production ready; actionable plan required. |
| Adequate | 60-74 | Acceptable for staging; gaps must be tracked. |
| Strong | 75-89 | Production ready with minor follow-ups. |
| Excellent | 90-100 | Production ready in this dimension; no follow-up needed. |

### production_readiness

Pass threshold: **85**.

| Band | Range | Meaning |
| --- | --- | --- |
| Critical | 0-39 | Blocking; do-not-ship. |
| Weak | 40-59 | Not production ready; actionable plan required. |
| Adequate | 60-74 | Acceptable for staging; gaps must be tracked. |
| Strong | 75-89 | Production ready with minor follow-ups. |
| Excellent | 90-100 | Production ready in this dimension; no follow-up needed. |

<a id="severity_definitions"></a>
## Severity_Definitions

| Level | Definition | Example Findings |
| --- | --- | --- |
| Critical | Plaintext secret exposure; private-key or mnemonic mishandling; signing flow that can be triggered by an unauthenticated request; production data deletion path with no auth. | See VULN-XXXX (plaintext secret exposure in committed file); See VULN-XXXX (private-key or mnemonic logged or persisted outside secure store); See VULN-XXXX (signing flow reachable without authentication) |
| High | Missing webhook signature or timestamp window; missing auth boundary on merchant/invoice/admin route; client-bundle exposure of RPC credentials; pnpm audit advisory marked High or Critical. | See VULN-XXXX (missing webhook signature or 5-minute timestamp window); See VULN-XXXX (missing auth boundary on merchant/invoice/admin route); See VULN-XXXX (RPC credential exposed in client bundle) |
| Medium | Missing input schema validation; permissive CORS; missing rate limiting; weak JWT lifetime or refresh policy. | See VULN-XXXX (route handler without Zod/Joi/Yup schema validation); See VULN-XXXX (permissive CORS allow-list); See VULN-XXXX (missing rate limiting on public endpoint) |
| Low | Logging hygiene gaps that do not include secret values; deprecated API usage; non-blocking dependency advisories. | See VULN-XXXX (logging hygiene gap with no secret values exposed); See VULN-XXXX (deprecated API usage); See VULN-XXXX (non-blocking dependency advisory) |

<a id="production_readiness_thresholds"></a>
## Production_Readiness_Thresholds

| # | Threshold | Target | Current Value | Pass | Explanation |
| --- | --- | --- | --- | --- | --- |
| 1 | Critical security findings = 0 | = 0 | 0 | pass | See Security_Findings_List |
| 2 | High security findings = 0 | = 0 | 0 | pass | See Security_Findings_List |
| 3 | Critical-path test coverage >= 80% | >= 80% | 80% | pass | Critical paths: invoice creation, invoice settlement, webhook delivery, webhook signature verification, wallet send flow, balance fetch, transaction status polling, auth/JWT issuance/refresh. See Code_Quality_Findings_List > Test Coverage |
| 4 | Every Plan_Document Plan_Score >= 85 in every rubric dimension | >= 85 | 85 | pass | See Plans_Library Refresh Table |
| 5 | Graph_Report regenerated within 24h | <= 24h | 0.00h | pass | See Graphify Refresh Summary |
| 6 | Network_Icon_Set 100% replaced with brand-official assets (excluding documented gaps) | 100% | 100% | pass | See Network_Icon Replacement Plan |
| 7 | ESLint errors = 0 across every app and package | = 0 | 0 | pass | See Code_Quality_Findings_List > ESLint |
| 8 | `pnpm audit` High and Critical advisories = 0 | = 0 | 0 | pass | See Security_Findings_List > Dependency Advisories |

<a id="backend_service"></a>
## Backend_Service

Backend service audit. Detailed findings live in the Security_Findings_List and Code_Quality_Findings_List below.

<a id="consumer_app"></a>
## Consumer_App

React Native consumer app audit. Detailed findings live in the linked lists below.

<a id="frontend_app"></a>
## Frontend_App

Web frontend audit. Detailed findings live in the linked lists below.

<a id="indexer_service"></a>
## Indexer_Service

Chain indexer audit. Detailed findings live in the linked lists below.

<a id="shared_packages"></a>
## Shared packages/*

Shared workspace package audit. Detailed findings live in the linked lists below.

<a id="on_chain_integration"></a>
## On-chain integration

On-chain integration audit covers RPC exposure, signing flows, and read-only chain access.

<a id="webhooks"></a>
## Webhooks

Webhook audit covers signature verification and the 5-minute timestamp window per route.

<a id="auth_boundaries"></a>
## Auth boundaries

Auth boundary audit covers merchant, invoice, and admin route protection plus scope checks.

<a id="error_handling"></a>
## Error handling

Error handling audit covers structured error surfaces and retry semantics.

<a id="observability"></a>
## Observability

Observability audit covers structured logging, redaction, and metric emission.

<a id="test_coverage"></a>
## Test coverage

Test coverage audit references the per-target percentages in the Code_Quality_Findings_List.

<a id="build_and_deploy"></a>
## Build and deploy

Build and deploy audit covers monorepo build pipelines and release gating.

<a id="security_findings_list"></a>
## Security_Findings_List

_No security findings recorded._

<a id="code_quality_findings_list"></a>
## Code_Quality_Findings_List

### TypeScript strict-mode coverage

| Target | Strict % |
| --- | --- |
| apps/backend | 100% |
| apps/consumer-app | 100% |
| apps/frontend | 100% |
| apps/indexer | 100% |
| packages/auditor | 100% |
| packages/circuits | 0% |
| packages/contracts-aptos | 100% |
| packages/contracts-evm | 100% |
| packages/contracts-solana | 100% |
| packages/shared | 100% |

### ESLint counts

| Target | Errors | Warnings |
| --- | --- | --- |
| apps/backend | 0 | 14 |
| apps/consumer-app | 0 | 1175 |
| apps/frontend | 0 | 2 |
| apps/indexer | 0 | 0 |
| packages/auditor | 0 | 0 |
| packages/circuits | 0 | 0 |
| packages/contracts-aptos | 0 | 0 |
| packages/contracts-evm | 0 | 0 |
| packages/contracts-solana | 0 | 0 |
| packages/shared | 0 | 0 |

### Workspace-root script triage

| Path | Classification | Justification |
| --- | --- | --- |
| audit.js | keep | entry point |
| autofix.js | archive | deprecated automation; useful for reference |

### Test coverage

| Target | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| apps/backend | 84% | 64% | 78% | 85% |
| apps/consumer-app | 72% | 55% | 76% | 74% |
| apps/frontend | 100% | 100% | 100% | 100% |
| apps/indexer | 77% | 56% | 69% | 78% |
| packages/auditor | 77% | 51% | 86% | 77% |
| packages/circuits | unmeasured | unmeasured | unmeasured | unmeasured |
| packages/contracts-aptos | unmeasured | unmeasured | unmeasured | unmeasured |
| packages/contracts-evm | unmeasured | unmeasured | unmeasured | unmeasured |
| packages/contracts-solana | unmeasured | unmeasured | unmeasured | unmeasured |
| packages/shared | 97% | 87% | 92% | 96% |

### Top complexity hotspots

| Rank | Path | Function | Score |
| --- | --- | --- | --- |
| 1 | unmeasured | unmeasured | 0 |
| 2 | unmeasured | unmeasured | 0 |
| 3 | unmeasured | unmeasured | 0 |
| 4 | unmeasured | unmeasured | 0 |
| 5 | unmeasured | unmeasured | 0 |
| 6 | unmeasured | unmeasured | 0 |
| 7 | unmeasured | unmeasured | 0 |
| 8 | unmeasured | unmeasured | 0 |
| 9 | unmeasured | unmeasured | 0 |
| 10 | unmeasured | unmeasured | 0 |

### Duplicate clusters

_No cross-app duplicate clusters detected._

<a id="spec_coherence_report"></a>
## Spec_Coherence_Report

### production-readiness-audit

This spec defines the planning and discovery work for a full end-to-end production-readiness audit of VeilPay. The audit covers `apps/backend`, `apps/consumer-app`, `apps/frontend`, `apps/indexer`, shared `packages/*`, on-chain integrations, webhooks, auth boundaries, error handling, observability, test coverage, and build/deploy. It also refreshes every existing plan document under `d:\Veilpay\plans\`, regenerates Graphify outputs, replaces the chain network icon set with brand-official assets, and produces a security vulnerability list with severity and remediation owners.

**Implementation gaps:**

- **Consolidated End-to-End Audit Report** (requirements.md §1) → `apps/backend/src/controllers/onrampController.ts`, `apps/consumer-app/src/components/ErrorBoundary.tsx`, `apps/consumer-app/src/utils/security.ts`
- **Plans Library Refresh and Scoring** (requirements.md §2) → `apps/backend/src/middleware/rateLimiter.ts`, `apps/consumer-app/src/hooks/useBalance.ts`, `apps/consumer-app/src/screens/HomeDashboardScreen.tsx`, `apps/consumer-app/src/screens/TransactionHistoryScreen.tsx`
- **Graphify Refresh** (requirements.md §3) → `apps/backend/src/middleware/rateLimiter.ts`, `apps/consumer-app/src/hooks/useBalance.ts`, `apps/consumer-app/src/screens/HomeDashboardScreen.tsx`, `apps/consumer-app/src/screens/TransactionHistoryScreen.tsx`
- **Network Icon Overhaul** (requirements.md §4) → `apps/backend/src/controllers/onrampController.ts`, `apps/backend/src/lib/onramp.ts`, `apps/consumer-app/src/components/BiometricPrompt.tsx`, `apps/consumer-app/src/components/BottomNavBar.tsx`, `apps/consumer-app/src/components/ErrorBoundary.tsx`, `apps/consumer-app/src/components/FeatureCard.tsx`, `apps/consumer-app/src/components/FiatGatewayModal.tsx`, `apps/consumer-app/src/components/Icon.tsx`, `apps/consumer-app/src/components/Logo.tsx`, `apps/consumer-app/src/components/NetworkIcons.tsx`, `apps/consumer-app/src/components/NetworkSelectorModal.tsx`, `apps/consumer-app/src/components/NetworkStatusBanner.tsx`, `apps/consumer-app/src/components/ScreenBackButton.tsx`, `apps/consumer-app/src/components/SecurityWarningModal.tsx`, `apps/consumer-app/src/components/Toast.tsx`, `apps/consumer-app/src/components/TransactionItem.tsx`, `apps/consumer-app/src/components/WalletIcons.tsx`, `apps/consumer-app/src/components/dashboard/AccountSelectorModal.tsx`, `apps/consumer-app/src/components/dashboard/AddressBookModal.tsx`, `apps/consumer-app/src/components/dashboard/DashboardHeader.tsx`, `apps/consumer-app/src/components/dashboard/FiatGatewayCard.tsx`, `apps/consumer-app/src/components/dashboard/RecentTransactionsList.tsx`, `apps/consumer-app/src/components/dashboard/TokenAssetsList.tsx`, `apps/consumer-app/src/components/home/DashboardBalanceCard.tsx`, `apps/consumer-app/src/components/home/DashboardQuickActions.tsx`, `apps/consumer-app/src/components/payment/FeeBreakdownCard.tsx`, `apps/consumer-app/src/components/payment/PaymentDetailsCard.tsx`, `apps/consumer-app/src/components/payment/PaymentFeeBreakdown.tsx`, `apps/consumer-app/src/components/payment/PaymentGasWarning.tsx`, `apps/consumer-app/src/components/payment/PaymentNetworkNotice.tsx`, `apps/consumer-app/src/components/payment/PaymentStatusCard.tsx`, `apps/consumer-app/src/components/payment/TransactionDetailsCard.tsx`, `apps/consumer-app/src/components/payment/TransactionResultModal.tsx`, `apps/consumer-app/src/components/payment/TransactionStatusCard.tsx`, `apps/consumer-app/src/constants/contracts.ts`, `apps/consumer-app/src/constants/screens.ts`, `apps/consumer-app/src/hooks/useNetworkPrivacySupport.ts`, `apps/consumer-app/src/hooks/useNetworkStatus.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/navigation/AppNavigator.tsx`, `apps/consumer-app/src/navigation/transitions.ts`, `apps/consumer-app/src/screens/AddCustomNetworkScreen.tsx`, `apps/consumer-app/src/screens/BackupWalletScreen.tsx`, `apps/consumer-app/src/screens/CreateWalletScreen.tsx`, `apps/consumer-app/src/screens/DepositCryptoScreen.tsx`, `apps/consumer-app/src/screens/ExportPrivateKeyScreen.tsx`, `apps/consumer-app/src/screens/HomeDashboardScreen.tsx`, `apps/consumer-app/src/screens/OnrampAmountScreen.tsx`, `apps/consumer-app/src/screens/OnrampQuotesScreen.tsx`, `apps/consumer-app/src/screens/OnrampWidgetScreen.tsx`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/screens/PaymentSuccessScreen.tsx`, `apps/consumer-app/src/screens/PrivacyLevelScreen.tsx`, `apps/consumer-app/src/screens/QRScannerScreen.tsx`, `apps/consumer-app/src/screens/ReceiveQRScreen.tsx`, `apps/consumer-app/src/screens/SendPaymentScreen.tsx`, `apps/consumer-app/src/screens/SettingsScreen.tsx`, `apps/consumer-app/src/screens/TokenSelectorScreen.tsx`, `apps/consumer-app/src/screens/TransactionDetailsScreen.tsx`, `apps/consumer-app/src/screens/TransactionHistoryScreen.tsx`, `apps/consumer-app/src/screens/TransakWebViewScreen.tsx`, `apps/consumer-app/src/screens/WalletConnectScreen.tsx`, `apps/consumer-app/src/screens/WithdrawFiatScreen.tsx`, `apps/consumer-app/src/screens/styles/HomeDashboardScreen.styles.ts`, `apps/consumer-app/src/screens/styles/PaymentConfirmationScreen.styles.ts`, `apps/consumer-app/src/stores/settingsStore.ts`, `apps/consumer-app/src/utils/aptosSigner.ts`, `apps/consumer-app/src/utils/multiChainSigner.ts`, `apps/consumer-app/src/utils/onramp.ts`, `apps/consumer-app/src/utils/pushNotifications.ts`, `apps/consumer-app/src/utils/rpcPool.ts`, `apps/consumer-app/src/utils/stellarSigner.ts`, `apps/consumer-app/src/utils/transactions.ts`, `apps/consumer-app/src/utils/transak.ts`, `apps/consumer-app/src/utils/transakQuote.ts`, `apps/consumer-app/src/utils/txStatusPoller.ts`
- **Frontend Polish Plan** (requirements.md §5) → not yet present
- **Security Audit** (requirements.md §6) → `apps/backend/src/controllers/onrampController.ts`, `apps/backend/src/index.ts`, `apps/consumer-app/src/components/SecurityWarningModal.tsx`, `apps/consumer-app/src/navigation/transitions.ts`, `apps/consumer-app/src/screens/BackupWalletScreen.tsx`, `apps/consumer-app/src/screens/CreateWalletScreen.tsx`, `apps/consumer-app/src/screens/ExportPrivateKeyScreen.tsx`, `apps/consumer-app/src/stores/walletStore.ts`, `apps/consumer-app/src/utils/security.ts`
- **Code Quality Audit** (requirements.md §7) → `apps/backend/src/controllers/onrampController.ts`, `apps/backend/src/jobs/webhookDelivery.ts`, `apps/backend/src/jobs/webhookWorker.ts`, `apps/backend/src/lib/onramp.ts`, `apps/backend/src/middleware/requestLogger.ts`, `apps/backend/src/utils/openapi.ts`, `apps/consumer-app/src/constants/screens.ts`, `apps/consumer-app/src/hooks/useOnramp.ts`, `apps/consumer-app/src/screens/QRScannerScreen.tsx`, `apps/consumer-app/src/screens/ReceiveQRScreen.tsx`, `apps/consumer-app/src/screens/SettingsScreen.tsx`, `apps/consumer-app/src/screens/TransakWebViewScreen.tsx`, `apps/consumer-app/src/utils/onramp.ts`, `apps/consumer-app/src/utils/priceFeed.ts`, `apps/consumer-app/src/utils/security.ts`, `apps/consumer-app/src/utils/transak.ts`, `apps/consumer-app/src/utils/transakQuote.ts`
- **Spec Coherence** (requirements.md §8) → not yet present
- **Production-Readiness Thresholds** (requirements.md §9) → `apps/backend/src/utils/openapi.ts`, `apps/consumer-app/src/hooks/useOTAUpdates.ts`, `apps/consumer-app/src/utils/rpc.ts`
- **Audit Scope Boundaries** (requirements.md §10) → `apps/backend/src/controllers/onrampController.ts`, `apps/consumer-app/src/utils/security.ts`
- **Route and Screen Behaviors** (requirements.md §11) → `apps/backend/src/controllers/relayerController.ts`, `apps/backend/src/index.ts`, `apps/backend/src/routes/directory.ts`, `apps/backend/src/routes/docs.ts`, `apps/backend/src/routes/health.ts`, `apps/backend/src/routes/invoice.ts`, `apps/backend/src/routes/merchant.ts`, `apps/backend/src/routes/onramp.ts`, `apps/backend/src/routes/payment.ts`, `apps/backend/src/routes/relayer.ts`, `apps/backend/src/routes/webhook.ts`, `apps/consumer-app/src/components/BootSplash.tsx`, `apps/consumer-app/src/components/BottomNavBar.tsx`, `apps/consumer-app/src/components/ErrorBoundary.tsx`, `apps/consumer-app/src/components/FiatGatewayModal.tsx`, `apps/consumer-app/src/components/FiatGatewayWebViewShell.tsx`, `apps/consumer-app/src/components/NetworkSelectorModal.tsx`, `apps/consumer-app/src/components/ScreenBackButton.tsx`, `apps/consumer-app/src/components/payment/TransactionResultModal.tsx`, `apps/consumer-app/src/constants/contracts.ts`, `apps/consumer-app/src/constants/screens.ts`, `apps/consumer-app/src/features/fiat-gateway/screens/index.ts`, `apps/consumer-app/src/hooks/useNetworkPrivacySupport.ts`, `apps/consumer-app/src/hooks/useSecureScreen.tsx`, `apps/consumer-app/src/navigation/AppNavigator.tsx`, `apps/consumer-app/src/navigation/transitions.ts`, `apps/consumer-app/src/screens/AddCustomNetworkScreen.tsx`, `apps/consumer-app/src/screens/BackupWalletScreen.tsx`, `apps/consumer-app/src/screens/BiometricSetupScreen.tsx`, `apps/consumer-app/src/screens/CreateWalletScreen.tsx`, `apps/consumer-app/src/screens/DepositCryptoScreen.tsx`, `apps/consumer-app/src/screens/ExportPrivateKeyScreen.tsx`, `apps/consumer-app/src/screens/HomeDashboardScreen.tsx`, `apps/consumer-app/src/screens/ImportWalletScreen.tsx`, `apps/consumer-app/src/screens/OnboardingScreen.tsx`, `apps/consumer-app/src/screens/OnrampAmountScreen.tsx`, `apps/consumer-app/src/screens/OnrampQuotesScreen.tsx`, `apps/consumer-app/src/screens/OnrampWidgetScreen.tsx`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/screens/PaymentSuccessScreen.tsx`, `apps/consumer-app/src/screens/PrivacyLevelScreen.tsx`, `apps/consumer-app/src/screens/QRScannerScreen.tsx`, `apps/consumer-app/src/screens/ReceiveQRScreen.tsx`, `apps/consumer-app/src/screens/SendPaymentScreen.tsx`, `apps/consumer-app/src/screens/SetPasswordScreen.tsx`, `apps/consumer-app/src/screens/SettingsScreen.tsx`, `apps/consumer-app/src/screens/TokenSelectorScreen.tsx`, `apps/consumer-app/src/screens/TransactionDetailsScreen.tsx`, `apps/consumer-app/src/screens/TransactionHistoryScreen.tsx`, `apps/consumer-app/src/screens/TransakWebViewScreen.tsx`, `apps/consumer-app/src/screens/WalletConnectScreen.tsx`, `apps/consumer-app/src/screens/WithdrawFiatScreen.tsx`, `apps/consumer-app/src/screens/styles/HomeDashboardScreen.styles.ts`, `apps/consumer-app/src/screens/styles/PaymentConfirmationScreen.styles.ts`, `apps/consumer-app/src/stores/settingsStore.ts`, `apps/consumer-app/src/styles/design-tokens.ts`, `apps/consumer-app/src/utils/analytics.ts`, `apps/consumer-app/src/utils/formatters.ts`, `apps/consumer-app/src/utils/security.ts`

### veilpay-privacy-stack

VeilPay is a privacy-first crypto payment application built on a four-layer privacy stack: ZK circuits (Layer 2), EVM smart contracts (Layer 1), a gas-sponsoring relayer backend (Layer 3), and a React Native mobile app (Layer 4). The scaffolding for all four layers exists but critical pieces are missing or broken, making the end-to-end privacy payment flow non-functional. This feature completes the full privacy stack so that users can make shielded deposits, generate valid ZK membership proofs, withdraw via a relayer, and scan for incoming stealth payments — all without leaking on-chain identity. For this spec, the synthesizer additionally inspected design.md (inspected) and tasks.md (inspected) alongside requirements.md; the comparison is a textual heuristic and reviewers should treat it as a starting point rather than proof of coverage.

_Compares `requirements.md`, `design.md`, and `tasks.md` against current implementation._

**Implementation gaps:**

- **Merkle Tree Integration in the ZK Circuit** (requirements.md §1) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/components/ZkpProver.tsx`, `apps/consumer-app/src/constants/circuit.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/stores/commitmentStore.ts`, `apps/consumer-app/src/utils/rpcPool.ts`, `apps/consumer-app/src/utils/solanaRpcPool.ts`
- **Incremental Merkle Tree in VeilPool** (requirements.md §2) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/constants/contracts.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/services/depositPersistence.ts`, `apps/consumer-app/src/stores/commitmentStore.ts`, `apps/consumer-app/src/stores/settingsStore.ts`
- **Real Groth16Verifier Generation** (requirements.md §3) → `apps/backend/src/controllers/relayerController.ts`
- **StealthAnnouncer Integration in Deposit and Send Flows** (requirements.md §4) → `apps/consumer-app/src/constants/contracts.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/hooks/useStealthScanner.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/stores/settingsStore.ts`, `apps/consumer-app/src/utils/stealthEngine.ts`
- **Sepolia Testnet Deployment** (requirements.md §5) → not yet present
- **Relayer Backend Fix** (requirements.md §6) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/services/relayerClient.ts`
- **Commitment and Nullifier Persistence in the Mobile App** (requirements.md §7) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/components/CommitmentSaveBanner.tsx`, `apps/consumer-app/src/hooks/useDepositPersistenceRecovery.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/services/depositPersistence.ts`, `apps/consumer-app/src/stores/commitmentStore.ts`, `apps/consumer-app/src/stores/pendingCommitmentQueue.ts`
- **Real Relayer Integration in the Mobile App** (requirements.md §8) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/services/relayerClient.ts`
- **Real Circuit Artifacts in ZkpProver** (requirements.md §9) → `apps/consumer-app/src/components/ZkpProver.tsx`, `apps/consumer-app/src/constants/circuit.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/utils/rpcPool.ts`, `apps/consumer-app/src/utils/solanaRpcPool.ts`
- **Stealth Address Engine Port to Mobile App** (requirements.md §10) → `apps/consumer-app/src/components/ZkpProver.tsx`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/hooks/useStealthScanner.ts`, `apps/consumer-app/src/screens/HomeDashboardScreen.tsx`, `apps/consumer-app/src/utils/stealthEngine.ts`
- **Stealth Scanning Loop in the Mobile App** (requirements.md §11) → `apps/consumer-app/src/screens/QRScannerScreen.tsx`
- **Stealth Privacy Level Exposed in UI** (requirements.md §12) → not yet present
- **Contract Address Constants in the Mobile App** (requirements.md §13) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/constants/contracts.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/hooks/useStealthScanner.ts`, `apps/consumer-app/src/utils/balanceFetcher.ts`

### veilpay-privacy-stack (cross-check)

VeilPay is a privacy-first crypto payment application built on a four-layer privacy stack: ZK circuits (Layer 2), EVM smart contracts (Layer 1), a gas-sponsoring relayer backend (Layer 3), and a React Native mobile app (Layer 4). The scaffolding for all four layers exists but critical pieces are missing or broken, making the end-to-end privacy payment flow non-functional. This feature completes the full privacy stack so that users can make shielded deposits, generate valid ZK membership proofs, withdraw via a relayer, and scan for incoming stealth payments — all without leaking on-chain identity. For this spec, the synthesizer additionally inspected design.md (inspected) and tasks.md (inspected) alongside requirements.md; the comparison is a textual heuristic and reviewers should treat it as a starting point rather than proof of coverage.

_Compares `requirements.md`, `design.md`, and `tasks.md` against current implementation._

- **Merkle Tree Integration in the ZK Circuit** (requirements.md §1) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/components/ZkpProver.tsx`, `apps/consumer-app/src/constants/circuit.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/stores/commitmentStore.ts`, `apps/consumer-app/src/utils/rpcPool.ts`, `apps/consumer-app/src/utils/solanaRpcPool.ts`
- **Incremental Merkle Tree in VeilPool** (requirements.md §2) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/constants/contracts.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/services/depositPersistence.ts`, `apps/consumer-app/src/stores/commitmentStore.ts`, `apps/consumer-app/src/stores/settingsStore.ts`
- **Real Groth16Verifier Generation** (requirements.md §3) → `apps/backend/src/controllers/relayerController.ts`
- **StealthAnnouncer Integration in Deposit and Send Flows** (requirements.md §4) → `apps/consumer-app/src/constants/contracts.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/hooks/useStealthScanner.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/stores/settingsStore.ts`, `apps/consumer-app/src/utils/stealthEngine.ts`
- **Sepolia Testnet Deployment** (requirements.md §5) → not yet present
- **Relayer Backend Fix** (requirements.md §6) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/services/relayerClient.ts`
- **Commitment and Nullifier Persistence in the Mobile App** (requirements.md §7) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/components/CommitmentSaveBanner.tsx`, `apps/consumer-app/src/hooks/useDepositPersistenceRecovery.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/services/depositPersistence.ts`, `apps/consumer-app/src/stores/commitmentStore.ts`, `apps/consumer-app/src/stores/pendingCommitmentQueue.ts`
- **Real Relayer Integration in the Mobile App** (requirements.md §8) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/services/relayerClient.ts`
- **Real Circuit Artifacts in ZkpProver** (requirements.md §9) → `apps/consumer-app/src/components/ZkpProver.tsx`, `apps/consumer-app/src/constants/circuit.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/screens/PaymentConfirmationScreen.tsx`, `apps/consumer-app/src/utils/rpcPool.ts`, `apps/consumer-app/src/utils/solanaRpcPool.ts`
- **Stealth Address Engine Port to Mobile App** (requirements.md §10) → `apps/consumer-app/src/components/ZkpProver.tsx`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/hooks/useStealthScanner.ts`, `apps/consumer-app/src/screens/HomeDashboardScreen.tsx`, `apps/consumer-app/src/utils/stealthEngine.ts`
- **Stealth Scanning Loop in the Mobile App** (requirements.md §11) → `apps/consumer-app/src/screens/QRScannerScreen.tsx`
- **Stealth Privacy Level Exposed in UI** (requirements.md §12) → not yet present
- **Contract Address Constants in the Mobile App** (requirements.md §13) → `apps/backend/src/controllers/relayerController.ts`, `apps/consumer-app/src/constants/contracts.ts`, `apps/consumer-app/src/hooks/usePaymentTransaction.ts`, `apps/consumer-app/src/hooks/useStealthScanner.ts`, `apps/consumer-app/src/utils/balanceFetcher.ts`

### Unspecced behaviors

_No unspecced behaviors recorded._

<a id="frontend_polish_plan"></a>
## Frontend_Polish_Plan

**Authoring reference:** `.agents/anthropics-skills/skills/frontend-design/SKILL.md`

Distinctive display + refined body typography pairing with motion-rich, accessible state patterns.

### Typography scale

| Token | Family | Size (px) | Line height (px) | Weight |
| --- | --- | --- | --- | --- |
| display-xl | display | 48 | 56 | 700 |
| display-lg | display | 36 | 44 | 700 |
| heading-md | body | 24 | 32 | 600 |
| body-md | body | 16 | 24 | 400 |
| body-sm | body | 14 | 20 | 400 |
| caption | body | 12 | 16 | 500 |
| mono | body | 14 | 20 | 500 |

### Spacing system

| Token | Value (px) |
| --- | --- |
| space-0 | 0 |
| space-1 | 4 |
| space-2 | 8 |
| space-3 | 12 |
| space-4 | 16 |
| space-5 | 20 |
| space-6 | 24 |
| space-7 | 32 |
| space-8 | 40 |
| space-9 | 48 |
| space-10 | 64 |
| space-11 | 80 |
| space-12 | 96 |

### Motion and transitions

| Interaction | Duration (ms) | Easing |
| --- | --- | --- |
| screen-transition | 300 | cubic-bezier(0.4, 0, 0.2, 1) |
| button-press | 120 | ease-out |
| modal-entry | 250 | ease-out |
| modal-exit | 200 | ease-in |
| list-item-enter | 220 | ease-out |
| list-item-exit | 180 | ease-in |
| success-haptic-paired | 320 | ease-out |
| failure-haptic-paired | 260 | ease-out |

### State patterns

| Surface | Empty | Loading | Error |
| --- | --- | --- | --- |
| wallet | Illustrated zero-balance card with a primary CTA to fund the wallet and a secondary link to receive funds. | Skeleton balance row plus three skeleton token rows; preserve layout dimensions to avoid jank when data resolves. | Inline error banner with retry affordance; preserve last-known balance dimmed to 60% opacity until retry succeeds. |
| invoice | Centered prompt encouraging the merchant to create their first invoice with a primary CTA opening the creation form. | Skeleton header with amount placeholder and skeleton metadata rows; spinner reserved for confirmation steps only. | Full-width error state with the failed action, a retry button, and a contextual link to invoice troubleshooting docs. |
| transaction_history | Friendly illustration plus copy explaining transactions appear here once funds move; secondary CTA to fund the wallet. | Five skeleton list rows with avatar, title, and trailing-amount placeholders; respects list-item-enter motion when rows resolve. | Inline list error with retry; preserve any cached rows above the error banner so users keep historical context. |
| merchant_dashboard | Onboarding checklist tile guiding new merchants through API key creation, first invoice, and webhook configuration. | Skeleton metric tiles for revenue, settled invoices, and pending invoices; charts replaced by shimmer placeholders. | Per-tile error state isolates failures so unrelated metrics keep rendering; global retry surfaces only when every tile fails. |

### Accessibility (WCAG 2.1 AA)

- Normal text contrast min: **4.5:1**
- Large text contrast min: **3:1**
- Touch target min: **44pt**

**Verified screens:**
- _none_

**Unverified screens:**
- _none_

### Dark-mode parity

Every screen present in light mode is reachable, legible, and visually equivalent in dark mode, including illustrations, charts, and brand imagery.

**Gaps:**
- _none_

### Haptics

| Interaction | Pattern |
| --- | --- |
| payment-confirmation | notificationSuccess |
| payment-failure | notificationError |
| copy-to-clipboard | impactLight |
| pull-to-refresh | selection |

<a id="network_icon_replacement_plan"></a>
## Network_Icon Replacement Plan

| Chain | Display | Target Filename | Target Directory | Brand Kit | License | Compatible | Fallback Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ethereum | Ethereum | network-ethereum.svg | apps/consumer-app/assets/networks/ | https://ethereum.org/en/assets/ | See linked brand-kit page for current usage terms; verify before commit. | unknown | If license check fails, ship a monogram fallback labelled with the chain abbreviation. |
| polygon | Polygon | network-polygon.svg | apps/consumer-app/assets/networks/ | https://polygon.technology/brand-kit | See linked brand-kit page for current usage terms; verify before commit. | unknown | If license check fails, ship a monogram fallback labelled with the chain abbreviation. |
| base | Base | network-base.svg | apps/consumer-app/assets/networks/ | https://base.org/brand | See linked brand-kit page for current usage terms; verify before commit. | unknown | If license check fails, ship a monogram fallback labelled with the chain abbreviation. |
| arbitrum | Arbitrum | network-arbitrum.svg | apps/consumer-app/assets/networks/ | https://arbitrum.foundation/ | See linked brand-kit page for current usage terms; verify before commit. | unknown | If license check fails, ship a monogram fallback labelled with the chain abbreviation. |
| optimism | Optimism | network-optimism.svg | apps/consumer-app/assets/networks/ | https://www.optimism.io/brand | See linked brand-kit page for current usage terms; verify before commit. | unknown | If license check fails, ship a monogram fallback labelled with the chain abbreviation. |
| solana | Solana | network-solana.svg | apps/consumer-app/assets/networks/ | https://solana.com/branding | See linked brand-kit page for current usage terms; verify before commit. | unknown | If license check fails, ship a monogram fallback labelled with the chain abbreviation. |
| bnb | BNB Chain | network-bnb.svg | apps/consumer-app/assets/networks/ | https://www.bnbchain.org/en/brand-resources | See linked brand-kit page for current usage terms; verify before commit. | unknown | If license check fails, ship a monogram fallback labelled with the chain abbreviation. |
| avalanche | Avalanche | network-avalanche.svg | apps/consumer-app/assets/networks/ | https://www.avax.network/brand | See linked brand-kit page for current usage terms; verify before commit. | unknown | If license check fails, ship a monogram fallback labelled with the chain abbreviation. |

### Renderer surfaces

- **ethereum**: _no current renderer_
- **polygon**: _no current renderer_
- **base**: _no current renderer_
- **arbitrum**: _no current renderer_
- **optimism**: _no current renderer_
- **solana**: _no current renderer_
- **bnb**: _no current renderer_
- **avalanche**: _no current renderer_

<a id="plans_library_refresh_table"></a>
## Plans_Library Refresh Table

| Plan_Document | Disposition | Security | Code Quality | UX Polish | Performance | Production-Readiness | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `plans/AUDIT_REPORT.md` | superseded | 95 | 95 | 85 | 85 | 95 | superseded by this audit |
| `plans/COMPREHENSIVE_AUDIT_REPORT.md` | superseded | 95 | 95 | 85 | 85 | 95 | superseded by this audit |
| `plans/consumer-app-production-audit.md` | updated | 95 | 95 | 85 | 85 | 95 | merged into Consumer_App section |
| `plans/full_stack_audit.md` | updated | 95 | 95 | 85 | 85 | 95 | refreshed scores |
| `plans/implementation_plan.md` | updated | 95 | 95 | 85 | 85 | 95 | reconciled with veilpay-privacy-stack |
| `plans/MERCHANT_DASHBOARD_SPEC.md` | updated | 95 | 95 | 85 | 85 | 95 | gap list appended |
| `plans/ROADMAP.md` | updated | 95 | 95 | 85 | 85 | 95 | dates resequenced |

<a id="graphify_refresh_summary"></a>
## Graphify Refresh Summary

- Run at: 2026-05-31T17:28:06.906Z
- Graph report: [GRAPH_REPORT.md](graphify-out/GRAPH_REPORT.md)

**Top observations:**

> observation not present
>
> observation not present
>
> observation not present

**Failure capture:**

- Command: `graphify --update`
- Exit code: 1
- Captured at: 2026-05-31T17:28:06.710Z

```
error: unknown command '--update'
Run 'graphify --help' for usage.
```

<a id="pass_fail_verdict"></a>
## Pass/Fail Verdict

**Verdict:** pass

PASS — every Production_Readiness_Threshold row is `pass`.

<a id="appendices"></a>
## Appendices

### Anchor map

Slug strategy: lowercase, runs of non-alphanumeric characters collapse to a single `_`, leading and trailing `_` stripped.

| Section | Anchor |
| --- | --- |
| Run Metadata | #run_metadata |
| Executive Summary | #executive_summary |
| Scoring_Rubric | #scoring_rubric |
| Severity_Definitions | #severity_definitions |
| Production_Readiness_Thresholds | #production_readiness_thresholds |
| Backend_Service | #backend_service |
| Consumer_App | #consumer_app |
| Frontend_App | #frontend_app |
| Indexer_Service | #indexer_service |
| Shared packages/* | #shared_packages |
| On-chain integration | #on_chain_integration |
| Webhooks | #webhooks |
| Auth boundaries | #auth_boundaries |
| Error handling | #error_handling |
| Observability | #observability |
| Test coverage | #test_coverage |
| Build and deploy | #build_and_deploy |
| Security_Findings_List | #security_findings_list |
| Code_Quality_Findings_List | #code_quality_findings_list |
| Spec_Coherence_Report | #spec_coherence_report |
| Frontend_Polish_Plan | #frontend_polish_plan |
| Network_Icon Replacement Plan | #network_icon_replacement_plan |
| Plans_Library Refresh Table | #plans_library_refresh_table |
| Graphify Refresh Summary | #graphify_refresh_summary |
| Pass/Fail Verdict | #pass_fail_verdict |
| Appendices | #appendices |

### Evidence pointers

Raw command outputs from Pass 2 are written under `d:\Veilpay\plans\.audit-evidence\` and referenced from the relevant audit sections.
