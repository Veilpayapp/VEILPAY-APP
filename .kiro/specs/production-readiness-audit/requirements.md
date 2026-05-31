# Requirements Document

## Introduction

This spec defines the planning and discovery work for a full end-to-end production-readiness audit of VeilPay. The audit covers `apps/backend`, `apps/consumer-app`, `apps/frontend`, `apps/indexer`, shared `packages/*`, on-chain integrations, webhooks, auth boundaries, error handling, observability, test coverage, and build/deploy. It also refreshes every existing plan document under `d:\Veilpay\plans\`, regenerates Graphify outputs, replaces the chain network icon set with brand-official assets, and produces a security vulnerability list with severity and remediation owners.

The output of this spec is a single consolidated audit deliverable plus per-area scores, a refreshed Graphify report, an icon replacement plan, a UI/UX polish plan grounded in the `frontend-design` skill, and an explicit set of measurable production-readiness thresholds.

This spec is planning-only. Implementation, refactors, dependency upgrades, and asset commits are explicitly out of scope and will be handled by follow-up specs once these requirements and the resulting design are accepted. The existing `veilpay-privacy-stack` spec is referenced rather than duplicated; gaps between that spec and current implementation are surfaced through the spec coherence requirement.

## Glossary

- **Auditor**: The role responsible for executing the audit and producing all deliverables defined in this spec. May be an engineer, an automated agent, or a combination.
- **Audit_Report**: The single consolidated production-readiness audit document produced by this spec, located at `d:\Veilpay\plans\PRODUCTION_READINESS_AUDIT.md`.
- **Plans_Library**: The collection of Markdown documents under `d:\Veilpay\plans\` that capture VeilPay audits, roadmaps, and implementation plans.
- **Plan_Document**: A single Markdown file inside the Plans_Library.
- **Scoring_Rubric**: The 0-100 scoring definition applied to each Plan_Document across the dimensions security, code quality, UX polish, performance, and production-readiness.
- **Plan_Score**: The set of five rubric scores assigned to a single Plan_Document.
- **Graphify_Pipeline**: The Graphify tool invocation that regenerates `d:\Veilpay\graphify-out\` artifacts, including `GRAPH_REPORT.md`, `graph.json`, and `manifest.json`.
- **Graph_Report**: The Markdown report at `d:\Veilpay\graphify-out\GRAPH_REPORT.md` produced by the Graphify_Pipeline.
- **Network_Icon_Set**: The collection of chain and network brand icons rendered by the Consumer_App, including at minimum Ethereum, Polygon, Base, Arbitrum, Optimism, Solana, BNB Chain, and Avalanche.
- **Network_Icon_Component**: The React Native component or components in `apps/consumer-app` that render entries from the Network_Icon_Set.
- **Consumer_App**: The React Native / Expo application at `apps/consumer-app`.
- **Backend_Service**: The HTTP API at `apps/backend`.
- **Frontend_App**: The web application at `apps/frontend`.
- **Indexer_Service**: The chain indexer at `apps/indexer`.
- **Security_Findings_List**: The structured list of security issues produced by the Auditor, with one entry per Vulnerability_Finding.
- **Vulnerability_Finding**: A single security issue with fields id, title, severity, location, description, remediation, and remediation owner.
- **Severity_Level**: One of `Critical`, `High`, `Medium`, or `Low`, defined in the Scoring_Rubric section of the Audit_Report.
- **Code_Quality_Findings_List**: The structured list of code quality issues produced by the Auditor, scoped to TypeScript strict coverage, lint cleanliness, dead code, duplication, and complexity hotspots.
- **Spec_Coherence_Report**: The section of the Audit_Report that compares each spec under `.kiro/specs/` against current implementation and lists gaps.
- **Frontend_Polish_Plan**: The section of the Audit_Report describing UI/UX upgrades for the Consumer_App and Frontend_App, derived from the `frontend-design` skill at `.agents/anthropics-skills/skills/frontend-design/`.
- **Production_Readiness_Thresholds**: The set of measurable pass/fail criteria that determine whether VeilPay is considered production ready by this spec.
- **Superseded_Marker**: A standard header block added to a Plan_Document indicating that the document has been superseded, including a link to the Audit_Report and the supersession date.

## Requirements

### Requirement 1: Consolidated End-to-End Audit Report

**User Story:** As a product owner, I want a single consolidated audit report covering every VeilPay surface, so that I have one authoritative document to drive production-readiness decisions.

#### Acceptance Criteria

1. THE Auditor SHALL produce the Audit_Report at `d:\Veilpay\plans\PRODUCTION_READINESS_AUDIT.md`.
2. THE Audit_Report SHALL contain a dedicated section for each of Backend_Service, Consumer_App, Frontend_App, Indexer_Service, and shared `packages/*`.
3. THE Audit_Report SHALL contain a section covering on-chain integration, webhooks, auth boundaries, error handling, observability, test coverage, and build and deploy.
4. THE Audit_Report SHALL include a generation timestamp in ISO 8601 format and the Git commit SHA of the workspace at audit time.
5. THE Audit_Report SHALL include a top-level executive summary of no more than 500 words.
6. WHERE a finding references source code, THE Audit_Report SHALL include the repository-relative file path, and SHALL include a line range only when the finding pinpoints specific lines.
7. THE Audit_Report SHALL link to the Security_Findings_List, the Code_Quality_Findings_List, the Spec_Coherence_Report, the Frontend_Polish_Plan, and the Network_Icon_Set replacement plan.

### Requirement 2: Plans Library Refresh and Scoring

**User Story:** As a lead engineer, I want every existing plan in `d:\Veilpay\plans\` either refreshed in place or explicitly superseded, so that the Plans_Library has a single source of truth and no stale guidance.

#### Acceptance Criteria

1. THE Auditor SHALL define the Scoring_Rubric inside the Audit_Report, with explicit 0-100 bands and pass thresholds for each of security, code quality, UX polish, performance, and production-readiness.
2. FOR each Plan_Document at `d:\Veilpay\plans\AUDIT_REPORT.md`, `d:\Veilpay\plans\COMPREHENSIVE_AUDIT_REPORT.md`, `d:\Veilpay\plans\consumer-app-production-audit.md`, `d:\Veilpay\plans\full_stack_audit.md`, `d:\Veilpay\plans\implementation_plan.md`, `d:\Veilpay\plans\MERCHANT_DASHBOARD_SPEC.md`, and `d:\Veilpay\plans\ROADMAP.md`, THE Auditor SHALL produce a refreshed Plan_Score covering all five rubric dimensions.
3. THE Auditor SHALL preserve every existing Plan_Document file on disk.
4. WHEN a Plan_Document is superseded by the Audit_Report, THE Auditor SHALL prepend a Superseded_Marker to the Plan_Document that links to the Audit_Report and records the supersession date in ISO 8601 format.
5. WHEN a Plan_Document is updated rather than superseded, THE Auditor SHALL append a `## Audit Refresh` section to the Plan_Document containing the refreshed Plan_Score, the refresh date in ISO 8601 format, and a summary of changes.
6. THE Audit_Report SHALL include a table listing every Plan_Document, its disposition of `updated` or `superseded`, and the five rubric scores.
7. IF a Plan_Score in any rubric dimension falls below the rubric pass threshold, THEN THE Audit_Report SHALL list the specific gaps that drove the score for that dimension.

### Requirement 3: Graphify Refresh

**User Story:** As a lead engineer, I want a freshly regenerated Graphify report, so that architecture conversations and the Audit_Report cite current code structure rather than stale snapshots.

#### Acceptance Criteria

1. THE Auditor SHALL run the Graphify_Pipeline against the workspace root.
2. THE Graphify_Pipeline SHALL regenerate `d:\Veilpay\graphify-out\GRAPH_REPORT.md`, `d:\Veilpay\graphify-out\graph.json`, and `d:\Veilpay\graphify-out\manifest.json`.
3. WHERE `d:\Veilpay\graphify-out\wiki\index.md` exists, THE Auditor SHALL verify that the file regenerates and reflects the current workspace.
4. THE Audit_Report SHALL link to the regenerated Graph_Report and quote its top three architectural observations.
5. THE Audit_Report SHALL record the Graphify_Pipeline run timestamp in ISO 8601 format.
6. IF the Graphify_Pipeline fails, THEN THE Auditor SHALL record the failure mode in the Audit_Report and capture the failing command, exit code, and the last 50 lines of output; on a successful run, no failure capture is required.

### Requirement 4: Network Icon Overhaul

**User Story:** As a design lead, I want the Consumer_App chain icons replaced with brand-official assets, so that VeilPay stops looking like a knockoff and signals legitimacy at first glance.

#### Acceptance Criteria

1. THE Auditor SHALL inventory every chain or network icon currently shipped in the Consumer_App and record the file path of each asset and the file path of the Network_Icon_Component that renders the asset.
2. THE Network_Icon_Set SHALL include at minimum brand-official icons for Ethereum, Polygon, Base, Arbitrum, Optimism, Solana, BNB Chain, and Avalanche.
3. THE Auditor SHALL identify the official brand kit URL for each network in the Network_Icon_Set and record the URL in the Audit_Report.
4. THE Auditor SHALL record the licensing terms for each official brand kit and confirm in the Audit_Report that VeilPay's intended use complies with those terms.
5. THE Audit_Report SHALL specify SVG as the primary asset format and SHALL specify PNG at 1x, 2x, and 3x as the fallback format.
6. THE Audit_Report SHALL define a naming convention of the form `network-<chain-slug>.svg` where `<chain-slug>` is the lowercase canonical chain identifier.
7. THE Audit_Report SHALL specify the target directory inside `apps/consumer-app` where the Network_Icon_Set assets are placed.
8. THE Audit_Report SHALL list the Network_Icon_Component file or files that consume the Network_Icon_Set and describe the import surface the replacement must preserve.
9. IF a network in the Network_Icon_Set lacks an officially licensed asset, THEN THE Audit_Report SHALL list the network as a known gap with a recommended fallback.

### Requirement 5: Frontend Polish Plan

**User Story:** As a design lead, I want a concrete UI/UX polish plan grounded in the `frontend-design` skill, so that the team has unambiguous targets for what "million dollar app" means.

#### Acceptance Criteria

1. THE Auditor SHALL produce the Frontend_Polish_Plan as a section of the Audit_Report.
2. THE Frontend_Polish_Plan SHALL cite the `frontend-design` skill at `.agents/anthropics-skills/skills/frontend-design/SKILL.md` as its authoring reference.
3. THE Frontend_Polish_Plan SHALL define a typography scale with named tokens and pixel sizes.
4. THE Frontend_Polish_Plan SHALL define a spacing system with named tokens and pixel values.
5. THE Frontend_Polish_Plan SHALL define motion and transition specifications, including duration in milliseconds and easing curve, for screen transitions, button presses, and modal entry and exit.
6. THE Frontend_Polish_Plan SHALL specify empty state, loading skeleton, and error state patterns for at least the wallet, invoice, transaction history, and merchant dashboard surfaces.
7. THE Frontend_Polish_Plan SHALL set a WCAG 2.1 Level AA target for color contrast and touch target size and SHALL list the screens that have been verified against that target.
8. THE Frontend_Polish_Plan SHALL define dark mode parity expectations and SHALL list any screen that lacks dark mode parity at audit time.
9. THE Frontend_Polish_Plan SHALL specify haptic feedback patterns for payment confirmation, payment failure, copy-to-clipboard, and pull-to-refresh interactions in the Consumer_App.

### Requirement 6: Security Audit

**User Story:** As a security reviewer, I want a complete vulnerability list with severity and remediation owners, so that critical and high-severity issues are blocked from production and lower-severity issues are tracked.

#### Acceptance Criteria

1. THE Auditor SHALL produce the Security_Findings_List as a section of the Audit_Report.
2. THE Security_Findings_List SHALL define the four Severity_Level values `Critical`, `High`, `Medium`, and `Low` with explicit definitions.
3. EACH Vulnerability_Finding SHALL include the fields id, title, severity, location, description, remediation, and remediation owner.
4. THE Auditor SHALL inspect the workspace for plaintext secrets, including private keys, mnemonics, API tokens, and database credentials, and SHALL record any match as a Vulnerability_Finding with severity `Critical`.
5. THE Auditor SHALL inspect Backend_Service log statements for secret values, request bodies containing tokens, and full Authorization headers, and SHALL record any match as a Vulnerability_Finding.
6. THE Auditor SHALL verify that every webhook endpoint in the Backend_Service validates a signature and a timestamp window, and SHALL record any endpoint that lacks either check as a Vulnerability_Finding with severity `High` or higher.
7. THE Auditor SHALL verify auth boundaries on every merchant, invoice, and admin endpoint in the Backend_Service and SHALL record missing or weak boundaries as Vulnerability_Findings.
8. THE Auditor SHALL run `pnpm audit` at the workspace root and SHALL include the dependency advisories with severity `High` or higher in the Security_Findings_List.
9. THE Auditor SHALL verify input validation on every Backend_Service API route and SHALL record routes that lack schema validation as Vulnerability_Findings.
10. THE Auditor SHALL verify rate limiting and CORS configuration on the Backend_Service and SHALL record missing or permissive configuration as a Vulnerability_Finding.
11. THE Auditor SHALL verify JWT and session handling, including signing algorithm, token lifetime, and refresh strategy, and SHALL record deviations from documented policy as Vulnerability_Findings.
12. THE Auditor SHALL verify that RPC URLs and chain provider credentials are not exposed to client bundles in the Consumer_App or the Frontend_App and SHALL record any exposure as a Vulnerability_Finding with severity `High` or higher.
13. THE Auditor SHALL verify that mnemonic and private-key handling code paths in the Consumer_App do not log, network-transmit, or persist key material outside of the documented secure store, and SHALL record any deviation as a Vulnerability_Finding with severity `Critical`.
14. THE Auditor SHALL preserve all wallet, signing, and send code paths without modification during the audit.

### Requirement 7: Code Quality Audit

**User Story:** As a QA lead, I want a structured code quality audit, so that strictness gaps, lint debt, dead code, and duplication are visible and prioritizable.

#### Acceptance Criteria

1. THE Auditor SHALL produce the Code_Quality_Findings_List as a section of the Audit_Report.
2. THE Auditor SHALL record TypeScript strict mode coverage per app and per package as the percentage of source files compiled with `strict: true`.
3. THE Auditor SHALL run the workspace eslint configuration and SHALL record the count of errors and warnings per app and per package.
4. THE Auditor SHALL list every script file at the workspace root whose name matches the patterns `tmp_*.js`, `autofix.js`, or `audit.js`, and SHALL classify each file as `keep`, `archive`, or `remove` with a justification.
5. THE Auditor SHALL record current test coverage per app and per package as a percentage of statements, branches, functions, and lines.
6. THE Auditor SHALL identify the top ten cyclomatic complexity hotspots across the workspace and SHALL record the file path, function name, and complexity score for each hotspot.
7. THE Auditor SHALL identify duplicate logic that appears in two or more of Backend_Service, Consumer_App, Frontend_App, and Indexer_Service and SHALL record each duplicate cluster with its file paths and a deduplication recommendation.

### Requirement 8: Spec Coherence

**User Story:** As a lead engineer, I want every existing spec under `.kiro/specs/` cross-checked against current implementation, so that drift between intent and code is surfaced before it ships.

#### Acceptance Criteria

1. THE Auditor SHALL produce the Spec_Coherence_Report as a section of the Audit_Report.
2. FOR each spec directory under `d:\Veilpay\.kiro\specs\`, THE Spec_Coherence_Report SHALL include a subsection that summarizes the spec scope and lists implementation gaps.
3. THE Spec_Coherence_Report SHALL include a subsection for `veilpay-privacy-stack` that compares its `requirements.md`, `design.md`, and `tasks.md` against current implementation.
4. WHERE a spec describes behavior that is not implemented, THE Spec_Coherence_Report SHALL list the behavior, the spec section reference, and the affected source files or "not yet present".
5. WHERE current implementation contains behavior not described in any spec, THE Spec_Coherence_Report SHALL list the behavior, the source file path, and a recommendation to either spec the behavior or remove it.
6. THE Auditor SHALL preserve all files under `d:\Veilpay\.kiro\specs\` without modification.

### Requirement 9: Production-Readiness Thresholds

**User Story:** As a product owner, I want explicit measurable thresholds for "production ready", so that sign-off is a checklist rather than a vibe.

#### Acceptance Criteria

1. THE Audit_Report SHALL define the Production_Readiness_Thresholds as a checklist with one row per threshold and columns for threshold, current value, and pass status.
2. THE Production_Readiness_Thresholds SHALL include `Critical security findings = 0`.
3. THE Production_Readiness_Thresholds SHALL include `High security findings = 0`.
4. THE Production_Readiness_Thresholds SHALL include a minimum test coverage percentage on critical paths and SHALL define which paths are critical.
5. THE Production_Readiness_Thresholds SHALL include `Every Plan_Document Plan_Score >= 85 in every rubric dimension`.
6. THE Production_Readiness_Thresholds SHALL include `Graph_Report regenerated within 24 hours of Audit_Report sign-off`, and a regeneration delta of zero hours SHALL count as passing.
7. THE Production_Readiness_Thresholds SHALL include `Network_Icon_Set 100 percent replaced with brand-official assets`, and any unreplaced network icon SHALL fail this threshold unless the network appears in the documented exception list defined by Requirement 4 acceptance criterion 9.
8. THE Production_Readiness_Thresholds SHALL include `Eslint errors = 0 across every app and package`.
9. THE Production_Readiness_Thresholds SHALL include `pnpm audit High and Critical advisories = 0`.
10. THE Audit_Report SHALL state an overall pass or fail verdict that is `pass` only when every Production_Readiness_Threshold row has pass status `pass`.

### Requirement 10: Audit Scope Boundaries

**User Story:** As a lead engineer, I want explicit boundaries on what the audit may change, so that the planning phase does not silently mutate production behavior.

#### Acceptance Criteria

1. THE Auditor SHALL limit file modifications to documents under `d:\Veilpay\plans\`, the Audit_Report, the regenerated `d:\Veilpay\graphify-out\` artifacts, and this spec's own files.
2. THE Auditor SHALL preserve all source files under `apps/`, `packages/`, and the workspace root scripts during the planning phase of this spec.
3. WHEN a finding requires source code change, THE Auditor SHALL record the change as a recommendation in the Audit_Report and SHALL defer the change to a follow-up spec.
4. THE Auditor SHALL preserve every existing Plan_Document file on disk in accordance with Requirement 2 acceptance criterion 3.
5. THE Auditor SHALL preserve all wallet, signing, and send code paths in accordance with Requirement 6 acceptance criterion 14.
6. THE Auditor SHALL prefer read-only chain data access during audit verification steps.

### Requirement 11: Route and Screen Behaviors

**User Story:** As an auditor, I need all existing API routes and consumer app screens to be specced so that they are officially recognized and audited rather than flagged as undocumented code.

#### Acceptance Criteria

1. THE Backend_Service SHALL implement the following routes in `apps/backend/src/routes/`: `directory.ts`, `docs.ts`, `health.ts`, `invoice.ts`, `merchant.ts`, `onramp.ts`, `payment.ts`, `relayer.ts`, `webhook.ts`.
2. THE Consumer_App SHALL implement the following screens in `apps/consumer-app/src/screens/`: `BiometricSetupScreen.tsx`, `ImportWalletScreen.tsx`, `OnboardingScreen.tsx`, `SetPasswordScreen.tsx`.
