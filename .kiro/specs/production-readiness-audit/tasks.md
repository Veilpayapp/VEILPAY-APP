# Implementation Plan: Production Readiness Audit

## Overview

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

This plan implements the planning-only Auditor as a TypeScript package at `packages/auditor` (a pnpm workspace member) plus a CLI entrypoint that the Auditor invokes from the workspace root. Implementation language is TypeScript (Jest + fast-check + remark), per the Testing Strategy in `design.md`. The Auditor produces a single consolidated `Audit_Report` at `d:\Veilpay\plans\PRODUCTION_READINESS_AUDIT.md`, regenerates Graphify artifacts under `d:\Veilpay\graphify-out\`, and annotates every `Plan_Document` under `d:\Veilpay\plans\` in place. No source files under `apps/`, `packages/*` (other than the new `packages/auditor`), or workspace root scripts are modified.

Each property-based test references a property from the design's Correctness Properties section by number and validates the corresponding requirements clauses.

## Tasks

- [x] 1. Set up auditor package and shared types
  - [x] 1.1 Scaffold `packages/auditor` workspace
    - Create `packages/auditor/package.json` (private, name `@veilpay/auditor`), `tsconfig.json` extending the workspace base, `jest.config.ts`, and `src/` directory structure (`src/passes/`, `src/render/`, `src/models/`, `src/util/`, `src/cli/`)
    - Add dev dependencies: `typescript`, `ts-node`, `jest`, `ts-jest`, `@types/jest`, `fast-check`, `remark`, `remark-parse`, `unified`, `unist-util-visit`
    - Wire the package into `pnpm-workspace.yaml` resolution (it is already covered by `packages/*`) and confirm `pnpm -r exec tsc --noEmit` includes it
    - _Requirements: 1.1, 10.1_

  - [x] 1.2 Define core data model types
    - In `src/models/index.ts`, declare TypeScript types for `Vulnerability_Finding`, `Plan_Score`, `GapNote`, `Network_Icon`, `Complexity_Hotspot`, `Duplicate_Cluster`, `Production_Readiness_Threshold`, `Severity_Definition`, `Scoring_Rubric`, `AuditSection`, `FrontendPolishPlan`, `GraphifyRefreshSummary`, `FailureCapture`, `RunMetadata`, `AuditReportData`
    - Mirror the YAML schemas in `design.md` "Data Models" exactly: severity union, score ranges, required vs nullable fields, fixed-length lists (e.g., 10 complexity hotspots, 4 severity definitions, 3 graphify observations)
    - Export branded helpers (`Severity`, `Disposition`, `Verdict`) as string-literal unions
    - _Requirements: 1.6, 2.6, 6.2, 6.3, 7.6, 9.1_

  - [x] 1.3 Write property test for data model invariants
    - **Property 3: Every Vulnerability_Finding is well-formed**
    - **Validates: Requirements 1.6, 6.3**
    - Use `fast-check` arbitraries to generate `Vulnerability_Finding` objects and assert id/title/severity/location.path/description/remediation/remediation_owner are non-empty strings, severity is in {Critical, High, Medium, Low}, and `location.lines` is present iff the finding pinpoints lines

- [x] 2. Implement Pass 1: Discovery
  - [x] 2.1 Implement workspace discovery
    - In `src/passes/discovery.ts`, implement `runDiscovery(): Promise<DiscoveryOutput>` that captures `git rev-parse HEAD`, ISO 8601 generation timestamp, and inventories spec dirs under `d:\Veilpay\.kiro\specs\`, plan files under `d:\Veilpay\plans\`, network icon assets/renderers under `apps/consumer-app/`, root scripts matching `tmp_*.js|autofix.js|audit.js`, and webhook/merchant/invoice/admin routes under `apps/backend/src/`
    - On `git rev-parse HEAD` failure, throw `AuditAbortError` carrying command, exit code, last 50 lines of output, and timestamp (consumed by Pass 4 abort writer)
    - Use Windows-`cmd`-compatible spawning (no POSIX expansion)
    - _Requirements: 1.4, 4.1, 7.4, 8.2, 10.6_

  - [x] 2.2 Write unit tests for discovery
    - Test `runDiscovery` against a fixture workspace tree; assert each inventory bucket is populated and ISO timestamps parse
    - Test the abort path: stub `git rev-parse HEAD` to exit non-zero and assert `AuditAbortError` carries command, exit code, and trailing output
    - _Requirements: 1.4, 10.6_

- [x] 3. Implement Pass 2: Static Analysis runners
  - [x] 3.1 Implement evidence-capture harness
    - In `src/passes/staticAnalysis/runner.ts`, implement `runCommand(cmd, args, evidencePath): Promise<EvidenceRecord>` that writes stdout/stderr to `d:\Veilpay\plans\.audit-evidence\<name>.{json,txt}` atomically (temp file + rename) and returns `{ command, exitCode, runAt, evidencePath }`
    - Capture last 50 lines of combined output on non-zero exit per Requirement 3.6 / Property 14
    - _Requirements: 3.6_

  - [x] 3.2 Implement Graphify refresh runner
    - In `src/passes/staticAnalysis/graphify.ts`, implement `runGraphify(): Promise<GraphifyRefreshSummary>` that runs `graphify .`, falls back to `graphify --update` when cache is stale, verifies regeneration of `GRAPH_REPORT.md`, `graph.json`, `manifest.json`, and `wiki/index.md` (when present), and parses the top three observations from `GRAPH_REPORT.md`
    - On non-zero exit, populate `failure_capture` with command, exit code, and last 50 lines of output; on success, leave `failure_capture: null`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.3 Write property test for Graphify failure-capture invariant
    - **Property 14: Graphify failure capture matches exit code**
    - **Validates: Requirements 3.6**
    - Generate synthetic graphify invocation outcomes (exit code, stdout/stderr) and assert `failure_capture` is non-null iff exit code is non-zero, and that captured output is at most 50 lines

  - [x] 3.4 Implement dependency, type, lint, coverage, complexity, duplication probes
    - In `src/passes/staticAnalysis/probes.ts`, implement runners for `pnpm audit --json`, per-workspace `pnpm --filter <pkg> exec tsc --noEmit`, per-workspace `eslint . --format json`, per-workspace `jest --coverage --coverageReporters=json-summary`, `ts-complexity-report`, and `jscpd`
    - Each runner returns a structured result and an `EvidenceRecord` pointing to the raw output file under `.audit-evidence/`
    - On per-workspace tool failure, mark that workspace's metric as `unmeasured` (soft failure per Error Handling)
    - _Requirements: 6.8, 7.2, 7.3, 7.5, 7.6, 7.7_

  - [x] 3.5 Implement strict-mode resolver
    - In `src/passes/staticAnalysis/strictMode.ts`, walk each `tsconfig.json`, follow `extends`, resolve effective `strict` per file, and compute strict coverage percentage per app/package
    - _Requirements: 7.2_

  - [x] 3.6 Implement secret scan and RPC exposure probes
    - In `src/passes/staticAnalysis/security.ts`, implement (a) `gitleaks detect --no-git` runner plus regex sweep for `BEGIN PRIVATE KEY`, `mnemonic`, `JWT_SECRET=`, AWS-style keys, and 64-char hex, (b) backend log-statement scanner over `apps/backend/src/**` flagging args containing token-shaped values, `Authorization`, or full request bodies, and (c) RPC exposure scanner that greps client bundles in `apps/consumer-app` and `apps/frontend` for `RPC_URL|INFURA|ALCHEMY|QUICKNODE`
    - Open wallet/signing/send paths read-only; never write
    - _Requirements: 6.4, 6.5, 6.12, 6.13, 6.14, 10.5_

  - [x] 3.7 Implement route-policy verifier
    - In `src/passes/staticAnalysis/routes.ts`, walk webhook routes (verify signature middleware + 5-minute timestamp window), merchant/invoice/admin routes (verify auth middleware and scope check), every API route (verify Zod/Joi/Yup schema), server bootstrap (verify rate limiting + CORS allow-list), and JWT/session config (verify signing alg, TTL, refresh strategy)
    - Emit one structured evidence record per route per check
    - _Requirements: 6.6, 6.7, 6.9, 6.10, 6.11_

  - [x] 3.8 Write unit tests for probe failure handling
    - For each probe, simulate non-zero exit / missing tool and assert the runner returns a structured `unmeasured` result with the evidence pointer rather than crashing the pipeline
    - _Requirements: 3.6, 6.8, 7.2, 7.3, 7.5, 7.6, 7.7_

- [x] 4. Implement Pass 3: Synthesis
  - [x] 4.1 Implement Severity_Definitions and Scoring_Rubric synthesis
    - In `src/passes/synthesis/rubric.ts`, build the four `Severity_Definition` rows (Critical/High/Medium/Low) and the five-dimension `Scoring_Rubric` with the 0-39/40-59/60-74/75-89/90-100 bands and pass threshold 85
    - _Requirements: 2.1, 6.2_

  - [x] 4.2 Write property test for Scoring_Rubric band partition
    - **Property 15: Scoring_Rubric bands cover 0-100 contiguously across five dimensions**
    - **Validates: Requirements 2.1**
    - Assert exactly five dimensions, each with bands whose ranges (sorted) partition 0..100 with no gaps or overlaps, and each dimension declares an explicit pass threshold

  - [x] 4.3 Implement Vulnerability_Finding synthesizer
    - In `src/passes/synthesis/security.ts`, transform Pass 2 evidence into `Vulnerability_Finding[]`: secret hits → Critical, log-secret hits → up to Critical, missing webhook signature/timestamp → High floor, missing auth → up to Critical, pnpm audit High/Critical → High floor, missing schema validation → Medium floor, permissive CORS / missing rate limiting → Medium floor, JWT deviations → up to High, RPC exposure → High floor, mnemonic/key deviations → Critical
    - Assign sequential zero-padded ids (`VULN-0001` …) and a `remediation_owner` per surface
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13_

  - [x] 4.4 Write property test for evidence-to-finding traceability
    - **Property 4: Evidence-to-finding traceability**
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13**
    - Generate synthetic evidence entries across all sources and assert the synthesizer produces a `Vulnerability_Finding` whose `location` references the evidence and whose `severity` meets the floor for that source

  - [x] 4.5 Implement Code_Quality_Findings synthesizer
    - In `src/passes/synthesis/codeQuality.ts`, aggregate strict-mode percentages, ESLint counts, root-script triage entries (one per matching file with `keep|archive|remove` + justification), test-coverage summaries, top-ten complexity hotspots, and duplicate clusters spanning at least two of `apps/backend|apps/consumer-app|apps/frontend|apps/indexer`
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 4.6 Write property test for Code_Quality completeness
    - **Property 10: Code_Quality_Findings completeness**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6, 7.7**
    - Assert per-target strict % ∈ 0..100, ESLint counts are non-negative integers, four coverage percentages ∈ 0..100, exactly one root-script triage entry per matching file with classification ∈ {keep,archive,remove} and non-empty justification, exactly ten complexity hotspots with positive integer scores, and every duplicate cluster spans ≥ 2 of the four apps

  - [x] 4.7 Implement Plan_Score synthesizer
    - In `src/passes/synthesis/plans.ts`, score each of the seven canonical Plan_Documents across the five rubric dimensions (security, code quality, UX polish, performance, production-readiness), assign disposition `updated|superseded`, and populate `gaps[]` with a tagged GapNote for every dimension scored below 85
    - _Requirements: 2.2, 2.6, 2.7_

  - [x] 4.8 Write property test for Plan_Score completeness and gap traceability
    - **Property 5: Plan_Score completeness and gap-traceability**
    - **Validates: Requirements 2.2, 2.6, 2.7**
    - Assert exactly one row per canonical Plan_Document, scores are integers in 0..100, disposition ∈ {updated, superseded}, and every dimension < 85 has at least one tagged GapNote

  - [x] 4.9 Implement Network_Icon synthesizer
    - In `src/passes/synthesis/networkIcons.ts`, build a `Network_Icon` entry for each of `ethereum|polygon|base|arbitrum|optimism|solana|bnb|avalanche` with chain_slug, display_name, current_assets[], renderer_paths[], brand_kit_url, license_terms, license_compatible, target_filename `network-<chain-slug>.svg`, target_directory under `apps/consumer-app/`, and fallback_action when license is incompatible or asset missing
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 4.10 Write property test for Network_Icon well-formedness
    - **Property 8: Network_Icon entries are well-formed and licensed-or-gapped**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 4.9**
    - For each canonical chain slug, assert exactly one entry, target_filename matches `^network-[a-z0-9-]+\.svg$`, target_directory starts with `apps/consumer-app/`, renderer_paths is non-empty or explicitly documents absence, and licensing rule holds (URL+terms non-null with compatibility flag, or fallback_action set when not compatible)

  - [x] 4.11 Implement Frontend_Polish_Plan synthesizer
    - In `src/passes/synthesis/frontendPolish.ts`, build the typography scale (named tokens + px sizes + line heights + weights), spacing system (`space-0..space-12` on a base-4 scale), motion table (screen transitions, button presses, modal entry/exit, list enter/exit, success/failure), state patterns (empty/loading/error) for wallet/invoice/transaction history/merchant dashboard, WCAG 2.1 AA target with verified-screens list, dark-mode parity definition with non-parity gap list, and haptic patterns for payment confirmation/payment failure/copy/pull-to-refresh
    - Cite `.agents/anthropics-skills/skills/frontend-design/SKILL.md` as the authoring reference
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [x] 4.12 Write property test for Frontend_Polish_Plan token and surface coverage
    - **Property 9: Frontend_Polish_Plan token and surface coverage**
    - **Validates: Requirements 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9**
    - Assert typography entries have name + positive integer px size, spacing entries have name + non-negative integer px, motion table covers required entries each with ms duration + easing, state patterns cover the four required surfaces, AA target plus verified-screens list, dark-mode parity definition + gap list, and haptic entries for the four required interactions

  - [x] 4.13 Implement Spec_Coherence_Report synthesizer
    - In `src/passes/synthesis/specCoherence.ts`, for each spec dir under `.kiro/specs/` produce a subsection summarizing scope and listing implementation gaps (mapping satisfied requirements to source files, unsatisfied to "not yet present"); add an explicit `veilpay-privacy-stack` subsection comparing requirements/design/tasks; surface unspecced behaviors with file path + recommendation
    - Open all spec files read-only; never write under `.kiro/specs/`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 4.14 Write property test for Spec_Coherence subsection coverage
    - **Property 11: Spec_Coherence subsection coverage**
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5**
    - Assert exactly one subsection per spec dir, the privacy-stack subsection compares requirements + design + tasks, every gap entry has behavior + spec section ref + (file path or `not yet present`), and every unspecced entry has behavior + file path + recommendation

  - [x] 4.15 Implement Production_Readiness_Thresholds + verdict synthesizer
    - In `src/passes/synthesis/thresholds.ts`, build the eight-row checklist (Critical=0, High=0, critical-path coverage with explicit critical-path list, every Plan_Score ≥ 85, Graph_Report regenerated within 24h with delta=0 passing, Network_Icon_Set 100% replaced with documented exceptions, ESLint errors = 0, pnpm audit High+Critical = 0) with current value and pass status per row
    - Compute the overall `verdict` as the conjunction of every row's `pass` field
    - Define critical paths inline: invoice creation, invoice settlement, webhook delivery, webhook signature verification, wallet send flow, balance fetch, transaction status polling, auth/JWT issuance/refresh
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [x] 4.16 Write property test for Threshold completeness
    - **Property 12: Production_Readiness_Thresholds rule completeness**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9**
    - Assert all eight rule rows are present with non-empty label / current value / pass ∈ {pass, fail}, and the critical-path list is non-empty for the coverage rule

  - [x] 4.17 Write property test for verdict conjunction
    - **Property 13: Verdict is the conjunction of threshold rows**
    - **Validates: Requirements 9.10**
    - Generate threshold tables with arbitrary mixes of pass/fail rows and assert verdict is `pass` iff every row is `pass`

- [x] 5. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Pass 4: Reporting
  - [x] 6.1 Implement pure Markdown renderer
    - In `src/render/renderAuditReport.ts`, implement `renderAuditReport(input: AuditReportData): string` as a pure function that emits the 16 fixed-order sections (Title + Run Metadata, Executive Summary ≤ 500 words, Scoring_Rubric, Severity_Definitions, Production_Readiness_Thresholds, five per-surface sections, seven cross-cutting sections, Security_Findings_List, Code_Quality_Findings_List, Spec_Coherence_Report, Frontend_Polish_Plan, Network_Icon Replacement Plan, Plans_Library Refresh Table, Graphify Refresh Summary, Pass/Fail Verdict, Appendices)
    - Emit intra-document links to the five lists referenced by Requirement 1.7
    - Render Run Metadata block with ISO 8601 `Generated`, non-empty `Workspace SHA`, ISO 8601 `Graphify Run`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 2.1, 3.4, 3.5, 5.1, 6.1, 7.1, 8.1, 9.1_

  - [x] 6.2 Write property test for required sections, links, metadata, and word budget
    - **Property 1: Audit_Report contains every required section and link**
    - **Property 2: Run Metadata parses to valid ISO 8601 and the executive summary fits the word budget**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7, 2.6, 3.4, 3.5, 5.1, 6.1, 7.1, 8.1, 9.1**
    - Parse rendered output with `remark`; assert headings/anchors for every required section exist, intra-document links resolve to those anchors, ISO 8601 timestamps parse, Workspace SHA is non-empty, and executive summary contains ≤ 500 words

  - [x] 6.3 Implement Plan_Document annotator
    - In `src/render/annotatePlans.ts`, implement `annotatePlan(path, planScore)` that prepends a `Superseded_Marker` block (with link to `PRODUCTION_READINESS_AUDIT.md` and ISO 8601 supersession date) when disposition is `superseded`, or appends an `## Audit Refresh` section (with refreshed Plan_Score, ISO 8601 refresh date, summary list, cross-reference link) when disposition is `updated`
    - Handle annotation conflicts per Error Handling: update existing Superseded_Marker date in place; append `## Audit Refresh — <ISO date>` after an existing refresh section
    - Preserve original content as a contiguous substring (Property 7)
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 6.4 Write property test for Plan_Document annotation invariant
    - **Property 6: Plan_Document annotation invariant**
    - **Validates: Requirements 2.4, 2.5**
    - For arbitrary plan content + disposition, assert superseded files start with the marker block and contain the audit link + ISO 8601 date; updated files end with `## Audit Refresh` containing the score, ISO date, and non-empty summary

  - [x] 6.5 Implement Pass 4 orchestrator with abort handling
    - In `src/passes/reporting.ts`, implement `runReporting(audit: AuditReportData)` that (a) writes evidence atomically, (b) runs the 15 PBT properties against the in-memory `AuditReportData` and aborts before any write if any property fails, (c) renders and writes `d:\Veilpay\plans\PRODUCTION_READINESS_AUDIT.md` last using temp-file + rename, and (d) annotates each Plan_Document via `annotatePlan`
    - On `AuditAbortError` from earlier passes, write `d:\Veilpay\plans\.audit-evidence\ABORT.md` with command/exit-code/output/timestamp and skip both the report write and plan annotations
    - _Requirements: 1.1, 2.3, 2.4, 2.5, 3.6, 10.1, 10.2, 10.3, 10.4_

  - [x] 6.6 Write integration test for abort path and write-set
    - Simulate `git rev-parse HEAD` failure; assert `ABORT.md` is written under `.audit-evidence/`, `PRODUCTION_READINESS_AUDIT.md` is not written, and no Plan_Document is annotated
    - Run the full pipeline against a fixture workspace; assert the only files written under `d:\Veilpay\plans\` are the report, evidence files under `.audit-evidence/`, and the in-place plan annotations
    - _Requirements: 1.1, 10.1_

  - [x] 6.7 Write property test for modification-set invariant
    - **Property 7: Modification-set invariant**
    - **Validates: Requirements 2.3, 6.14, 8.6, 10.1, 10.2, 10.3, 10.4, 10.5**
    - Snapshot SHA-256 of every file in a fixture workspace before and after a simulated audit run; assert files outside `d:\Veilpay\plans\`, `d:\Veilpay\graphify-out\`, and `d:\Veilpay\.kiro\specs\production-readiness-audit\` are byte-equal, and that annotated Plan_Documents preserve the original content as a contiguous substring

- [x] 7. Wire CLI and run end-to-end
  - [x] 7.1 Implement CLI entrypoint
    - In `src/cli/index.ts`, expose `auditor run` that orchestrates Pass 1 → Pass 2 → Pass 3 → Pass 4 and exits non-zero on `AuditAbortError`
    - Wire as `bin` in `packages/auditor/package.json` and as a workspace-root script `pnpm audit:prod` that invokes the CLI
    - Use Windows-`cmd`-compatible spawning throughout
    - _Requirements: 1.1, 3.1, 10.1_

  - [x] 7.2 Write smoke test for CLI against a fixture workspace
    - Invoke `auditor run` against a fixture; assert exit code 0, `PRODUCTION_READINESS_AUDIT.md` is created, the Run Metadata block is well-formed, and at least one Plan_Document annotation is present
    - _Requirements: 1.1, 1.4, 2.4, 2.5_

- [x] 8. Final checkpoint - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. Core synthesis and rendering tasks are not optional.
- Each task references specific requirements for traceability; property tests reference both their property number and the validated requirement clauses.
- The Auditor is read-only against `apps/`, `packages/*` (other than `packages/auditor`), `.kiro/specs/`, and root scripts. The only writable paths are `d:\Veilpay\plans\`, `d:\Veilpay\graphify-out\`, and this spec's own files.
- Property tests run before Pass 4 writes, so any property failure aborts the report write and prevents inconsistent deliverables from reaching `d:\Veilpay\plans\`.
- Critical paths for Threshold #3 (test coverage) are defined inline in Pass 3 synthesis: invoice creation, invoice settlement, webhook delivery, webhook signature verification, wallet send flow, balance fetch, transaction status polling, auth/JWT issuance/refresh.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "3.1"] },
    { "id": 2, "tasks": ["1.3", "2.1", "3.2", "3.4", "3.5", "3.6", "3.7", "4.1"] },
    { "id": 3, "tasks": ["2.2", "3.3", "3.8", "4.2", "4.3", "4.5", "4.7", "4.9", "4.11", "4.13", "4.15"] },
    { "id": 4, "tasks": ["4.4", "4.6", "4.8", "4.10", "4.12", "4.14", "4.16", "4.17", "6.1", "6.3"] },
    { "id": 5, "tasks": ["6.2", "6.4", "6.5"] },
    { "id": 6, "tasks": ["6.6", "6.7", "7.1"] },
    { "id": 7, "tasks": ["7.2"] }
  ]
}
```
