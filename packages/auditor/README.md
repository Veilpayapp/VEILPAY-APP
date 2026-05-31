# @veilpay/auditor

Planning-only production-readiness audit pipeline for the VeilPay workspace.

This package implements the four-pass auditor described in
`.kiro/specs/production-readiness-audit/design.md`:

1. **Discovery** (`src/passes/`) — captures workspace state.
2. **Static Analysis** (`src/passes/`) — runs read-only probes (graphify, tsc, eslint, jest, jscpd, gitleaks).
3. **Synthesis** (`src/passes/`) — transforms evidence into normalized findings, scores, and thresholds.
4. **Reporting** (`src/render/`) — emits `plans/PRODUCTION_READINESS_AUDIT.md` and annotates plan documents in place.

## Layout

- `src/passes/` — pipeline pass implementations (Discovery → Static Analysis → Synthesis → Reporting).
- `src/render/` — pure Markdown renderers for the audit report and plan annotations.
- `src/models/` — shared TypeScript types for the audit data model.
- `src/util/` — shared utilities (process spawning, evidence capture, ISO timestamps).
- `src/cli/` — CLI entrypoint (`auditor run`).

## Boundaries

- The auditor is **read-only** against `apps/`, `packages/*` (other than this package),
  `.kiro/specs/`, and root scripts.
- The only writable paths are `plans/`, `graphify-out/`, and this spec's own files.
- Wallet, signing, and send code paths in `apps/consumer-app` are never modified.

## Scripts

- `pnpm --filter @veilpay/auditor typecheck` — TypeScript noEmit check.
- `pnpm --filter @veilpay/auditor test` — Jest + fast-check property tests.
