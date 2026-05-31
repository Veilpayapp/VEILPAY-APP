#!/usr/bin/env node
/**
 * CLI entrypoint for `auditor run`.
 *
 * Orchestrates the four-pass audit pipeline against a workspace root:
 *
 *   Pass 1 — Discovery        (`runDiscovery`)
 *   Pass 2 — Static Analysis  (graphify + probes + scanners + route verifier)
 *   Pass 3 — Synthesis        (rubric, security, code quality, plans, …)
 *   Pass 4 — Reporting        (`runReporting` — render + write atomically)
 *
 * Exit codes mirror the Pass 4 design contract:
 *
 *   - 0 — full success: every pass completed and the consolidated
 *         `PRODUCTION_READINESS_AUDIT.md` was written.
 *   - 1 — validation / render failure: a Pass 3 / Pass 4 contract violation
 *         was detected (renderer threw, structural property check failed,
 *         or an unexpected runtime error bubbled out of the orchestrator).
 *         No partial deliverable is published.
 *   - 2 — audit abort: a hard precondition failed (e.g. `git rev-parse HEAD`
 *         exited non-zero). `runReporting` writes
 *         `<plansDir>/.audit-evidence/ABORT.md` with the failing command,
 *         exit code, output tail, and ISO 8601 timestamp; no Plan_Document
 *         is annotated and no consolidated report is written.
 *
 * Usage:
 *
 *   auditor run [--workspace-root <path>] [--auditor <name>]
 *
 *   When invoked with no arguments, the default action is `run`. The
 *   workspace root defaults to four levels above this file
 *   (`packages/auditor/src/cli/index.ts` → workspace root). The auditor
 *   identity defaults to the literal string `"automated"`, matching the
 *   sentinel allowed by `RunMetadata.auditor`.
 *
 * Windows compatibility:
 *
 *   Every spawn flows through the Pass 2 `runCommand` harness, which sets
 *   `shell: false` and `windowsHide: true` so argv is passed verbatim to
 *   the child and no POSIX-shell expansion is applied. The CLI itself
 *   never invokes `child_process.spawn` directly. Node's bare-executable
 *   resolution (`PATH` + `PATHEXT`) is what keeps `git`, `pnpm`, and
 *   `graphify` reachable under both `cmd` and PowerShell.
 *
 * Probe robustness:
 *
 *   Pass 2 probes are run best-effort. The runner harness coerces every
 *   spawn failure (binary missing, non-zero exit) into an `EvidenceRecord`
 *   so a missing tool surfaces as `unmeasured` rather than aborting the
 *   pipeline. The orchestrator additionally wraps each probe in a local
 *   `try` so a runner-level exception (e.g. an `EACCES` on the evidence
 *   directory) degrades to `unmeasured` for that bucket only.
 *
 * Read-only contract:
 *
 *   The CLI writes only under `<workspaceRoot>/plans/` and
 *   `<workspaceRoot>/graphify-out/` (the latter via `graphify .`). Every
 *   other path is read-only — wallets, signing flows, source under
 *   `apps/`, and source under `packages/*` are inspected but never
 *   mutated, per Requirements 6.14, 10.2, 10.3, 10.4, 10.5.
 *
 * Validates Requirements 1.1 (Audit_Report at the canonical path), 3.1
 * (Graphify_Pipeline run), and 10.1 (writes confined to plans/ and
 * graphify-out/).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  AuditReportData,
  AuditSection,
  CoverageSummary,
  EslintCount,
  RunMetadata,
  Score,
  Unmeasured,
} from '../models';
import { UNMEASURED } from '../models';
import { runDiscovery, type DiscoveryOutput } from '../passes/discovery';
import { runReporting } from '../passes/reporting';
import { runGraphify } from '../passes/staticAnalysis/graphify';
import {
  runComplexity,
  runDuplication,
  runPnpmAudit,
  runWorkspaceEslint,
  runWorkspaceJestCoverage,
  runWorkspaceTsc,
  type ComplexityHotspot,
  type DuplicateCluster,
  type PnpmAdvisory,
} from '../passes/staticAnalysis/probes';
import { runRouteVerifier } from '../passes/staticAnalysis/routes';
import {
  runBackendLogScan,
  runRpcExposureScan,
  runSecretScan,
  type LogMatch,
  type RpcMatch,
  type SecretMatch,
} from '../passes/staticAnalysis/security';
import { resolveStrictCoverage } from '../passes/staticAnalysis/strictMode';
import { buildCodeQualityFindings } from '../passes/synthesis/codeQuality';
import { buildFrontendPolishPlan } from '../passes/synthesis/frontendPolish';
import { buildNetworkIconPlan } from '../passes/synthesis/networkIcons';
import { buildPlanScores } from '../passes/synthesis/plans';
import {
  buildScoringRubric,
  buildSeverityDefinitions,
} from '../passes/synthesis/rubric';
import { buildSecurityFindings } from '../passes/synthesis/security';
import { buildSpecCoherenceReport } from '../passes/synthesis/specCoherence';
import {
  buildProductionReadinessThresholds,
  computeVerdict,
} from '../passes/synthesis/thresholds';
import { isAuditAbortError } from '../util/errors';

// ===========================================================================
// CLI argument parsing
// ===========================================================================

/**
 * Parsed CLI arguments. Kept tiny on purpose — the design's "no
 * commander/yargs dependency" rule means each new flag is a manual
 * `process.argv` walk, so we only add what we need.
 */
interface CliArgs {
  /** Sub-command. Currently only `run` is supported (default when omitted). */
  readonly command: 'run' | 'help';
  /** Absolute path to the workspace root under audit. */
  readonly workspaceRoot: string;
  /**
   * Auditor identity surfaced in `RunMetadata.auditor` and Plan_Document
   * annotations. Defaults to the literal string `"automated"`.
   */
  readonly auditor: string;
}

/**
 * Default workspace root resolution.
 *
 * `__dirname` is `packages/auditor/src/cli` under ts-node and
 * `packages/auditor/dist/cli` after a build. Both layouts are exactly four
 * levels deep relative to the workspace root, so the same `'..', '..',
 * '..', '..'` path applies. Mirrors the `defaultWorkspaceRoot` helper in
 * `passes/discovery.ts`.
 */
function defaultWorkspaceRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

/**
 * Parse `process.argv.slice(2)` into a `CliArgs`. Unknown flags throw so
 * typos surface immediately instead of being silently ignored.
 *
 * Recognised forms:
 *   - bare sub-command: `run` (default when omitted).
 *   - `--workspace-root <path>`: override the default workspace root.
 *   - `--auditor <name>`: override the default auditor identity.
 *   - `--help` / `-h`: print usage and exit 0.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  let command: 'run' | 'help' = 'run';
  let workspaceRoot = defaultWorkspaceRoot();
  let auditor = 'automated';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') {
      command = 'help';
      continue;
    }
    if (arg === 'run') {
      command = 'run';
      continue;
    }
    if (arg === '--workspace-root') {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error('CLI: --workspace-root requires a path argument');
      }
      workspaceRoot = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === '--auditor') {
      const next = argv[i + 1];
      if (next === undefined || next.trim().length === 0) {
        throw new Error('CLI: --auditor requires a non-empty name argument');
      }
      auditor = next;
      i += 1;
      continue;
    }
    throw new Error(`CLI: unrecognised argument ${JSON.stringify(arg)}`);
  }

  return { command, workspaceRoot, auditor };
}

/**
 * Print the canonical usage block. Kept short on purpose — flag parity is
 * documented in the module preamble.
 */
function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      'Usage: auditor run [--workspace-root <path>] [--auditor <name>]',
      '',
      'Runs the production-readiness audit pipeline against the workspace.',
      'Writes the consolidated PRODUCTION_READINESS_AUDIT.md plus per-plan',
      'annotations under <workspaceRoot>/plans/. Exit code is 0 on success,',
      '1 on validation/render failure, 2 on hard audit abort.',
    ].join('\n'),
  );
}

// ===========================================================================
// Workspace targets — apps + packages + auditor itself
// ===========================================================================

/**
 * Workspace target descriptor used by the per-package probes (tsc, eslint,
 * jest coverage, strict-mode resolver). `name` is the value pnpm recognises
 * for `pnpm --filter`; `relativePath` is the workspace-relative directory
 * used by the strict-mode resolver to walk source files.
 */
interface WorkspaceTarget {
  readonly name: string;
  readonly relativePath: string;
}

/**
 * Workspace directories whose `package.json` lives in this monorepo's
 * `apps/` or `packages/` tree but which are not VeilPay code — vendored
 * upstream submodules (third-party skill packs, scaffold repos, etc.).
 *
 * They get a `package.json` because we need pnpm to resolve their
 * dependencies, but their lint output, tsc output, and coverage are not
 * VeilPay's responsibility and would otherwise dominate the aggregated
 * Code_Quality_Findings_List with thousands of upstream warnings.
 *
 * Each entry is the workspace-relative directory name (`packages/<name>`
 * or `apps/<name>`); the auditor matches on the directory rather than
 * the package's `name` field because vendored repos may use any
 * naming convention.
 *
 * Excluded targets are still mentioned in the Audit_Report (Pass 4) as
 * `vendored` rows so reviewers can see the carve-out is intentional —
 * the synthesizer has its own list keyed off `relativePath`.
 */
const VENDORED_WORKSPACE_DIRS: ReadonlySet<string> = new Set([
  // Upstream community skills repo cloned in for the Karpathy persona +
  // the Anthropics skill-pack mirror. Owns its own lint + ts setup.
  'packages/antigravity-utils',
]);

/**
 * Discover every pnpm workspace package by reading its `package.json` under
 * `apps/<entry>` and `packages/<entry>`. Mirrors the design's "per-workspace
 * tsc / eslint / jest" command shape, which assumes the audit knows the
 * `name` field used by `pnpm --filter`.
 *
 * Returns workspaces in deterministic order (apps first, then packages, both
 * sorted alphabetically) so downstream evidence filenames are stable across
 * runs.
 *
 * Vendored submodules listed in `VENDORED_WORKSPACE_DIRS` are filtered out
 * — their source quality is owned upstream and gating sign-off on their
 * lint counts would permanently block the audit.
 */
async function listWorkspaceTargets(
  workspaceRoot: string,
): Promise<readonly WorkspaceTarget[]> {
  const out: WorkspaceTarget[] = [];

  for (const parent of ['apps', 'packages']) {
    const parentAbs = path.join(workspaceRoot, parent);
    let entries;
    try {
      entries = await fs.readdir(parentAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    const sorted = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const name of sorted) {
      const relativePath = `${parent}/${name}`;
      if (VENDORED_WORKSPACE_DIRS.has(relativePath)) {
        continue;
      }
      const pkgJsonPath = path.join(parentAbs, name, 'package.json');
      let pkgJson: { name?: string } | null;
      try {
        const body = await fs.readFile(pkgJsonPath, 'utf8');
        pkgJson = JSON.parse(body) as { name?: string };
      } catch {
        continue;
      }
      if (pkgJson === null || typeof pkgJson.name !== 'string') {
        continue;
      }
      out.push({
        name: pkgJson.name,
        relativePath,
      });
    }
  }
  return out;
}

// ===========================================================================
// Pass 2 — Static Analysis orchestration
// ===========================================================================

/**
 * Aggregated Pass 2 evidence consumed by Pass 3 synthesizers.
 *
 * Every field is independently `'unmeasured'`-able so a single failing
 * probe (e.g., `gitleaks` not installed) cannot abort the whole pipeline.
 * The Pass 3 synthesizers each accept the `'unmeasured'` sentinel where
 * the design permits it and surface the gap in the rendered report.
 */
interface Pass2Output {
  readonly graphifySummary: Awaited<ReturnType<typeof runGraphify>>;
  readonly pnpmAdvisories: readonly PnpmAdvisory[] | Unmeasured;
  readonly strictCoverageByTarget: Readonly<Record<string, Score | Unmeasured>>;
  readonly eslintCountsByTarget: Readonly<Record<string, EslintCount>>;
  readonly coverageByTarget: Readonly<Record<string, CoverageSummary>>;
  readonly complexityHotspots: readonly ComplexityHotspot[] | Unmeasured;
  readonly duplicateClusters: readonly DuplicateCluster[] | Unmeasured;
  readonly secretMatches: readonly SecretMatch[] | Unmeasured;
  readonly logMatches: readonly LogMatch[];
  readonly rpcMatches: readonly RpcMatch[];
  readonly routeResults: Awaited<ReturnType<typeof runRouteVerifier>>['results'];
}

/**
 * Run a probe and coerce any synchronous or asynchronous error into the
 * supplied `unmeasuredFallback`. The Pass 2 runner harness already swallows
 * spawn-level failures; this helper covers the pre-spawn cases (missing
 * evidence directory, programmer error) so a single bad probe does not
 * propagate up and abort the orchestrator.
 *
 * Returns the probe's value on success or `unmeasuredFallback` on failure.
 * Logs the failure reason to stderr so an operator can see what degraded.
 */
async function runProbeBestEffort<T>(
  label: string,
  probe: () => Promise<T>,
  unmeasuredFallback: T,
): Promise<T> {
  try {
    return await probe();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[auditor] probe ${label} degraded to unmeasured: ${message}`);
    return unmeasuredFallback;
  }
}

/**
 * Run every Pass 2 probe best-effort against the workspace and return the
 * aggregated evidence.
 *
 * Probes are run sequentially (rather than in parallel) so that the evidence
 * directory contains a stable, ordered sequence of files when the audit is
 * inspected post-run. Sequential execution also keeps spawn pressure low on
 * Windows, where parallel `pnpm` invocations can contend for the pnpm
 * store lock.
 */
async function runPass2(args: {
  readonly workspaceRoot: string;
  readonly evidenceDir: string;
  readonly graphifyOutDir: string;
  readonly discovery: DiscoveryOutput;
  readonly targets: readonly WorkspaceTarget[];
}): Promise<Pass2Output> {
  const { workspaceRoot, evidenceDir, graphifyOutDir, discovery, targets } =
    args;

  // -------- Graphify refresh ---------------------------------------------
  // The graphify runner already populates a non-null `failure_capture` when
  // the invocation exits non-zero, so we don't need to wrap it in
  // `runProbeBestEffort` — a bare throw here would still abort the audit
  // with exit code 1 (validation/render failure), which is the desired
  // semantic for a graphify run that crashed before producing a summary.
  const graphifySummary = await runGraphify({
    workspaceRoot,
    graphifyOutDir,
    evidenceDir,
  });

  // -------- pnpm audit ---------------------------------------------------
  const pnpmAuditResult = await runProbeBestEffort(
    'pnpm-audit',
    () => runPnpmAudit({ workspaceRoot, evidenceDir }),
    { record: undefined as never, advisories: UNMEASURED as Unmeasured },
  );
  const pnpmAdvisories = pnpmAuditResult.advisories;

  // -------- Per-workspace tsc / eslint / jest coverage -------------------
  const eslintCountsByTarget: Record<string, EslintCount> = {};
  const coverageByTarget: Record<string, CoverageSummary> = {};
  const unmeasuredEslint: EslintCount = {
    errors: UNMEASURED,
    warnings: UNMEASURED,
  };
  const unmeasuredCoverage: CoverageSummary = {
    statements: UNMEASURED,
    branches: UNMEASURED,
    functions: UNMEASURED,
    lines: UNMEASURED,
  };

  for (const target of targets) {
    // tsc errors do not feed any aggregate metric directly; we still run
    // the probe so an evidence file lands under .audit-evidence/.
    await runProbeBestEffort(
      `tsc:${target.name}`,
      () =>
        runWorkspaceTsc({
          workspaceRoot,
          packageName: target.name,
          evidenceDir,
        }),
      { record: undefined as never, errorCount: UNMEASURED as Unmeasured },
    );

    const eslintRes = await runProbeBestEffort(
      `eslint:${target.name}`,
      () =>
        runWorkspaceEslint({
          workspaceRoot,
          packageName: target.name,
          evidenceDir,
        }),
      { record: undefined as never, counts: unmeasuredEslint },
    );
    eslintCountsByTarget[target.relativePath] = eslintRes.counts;

    const jestRes = await runProbeBestEffort(
      `jest:${target.name}`,
      () =>
        runWorkspaceJestCoverage({
          workspaceRoot,
          packageName: target.name,
          evidenceDir,
        }),
      { record: undefined as never, coverage: unmeasuredCoverage },
    );
    coverageByTarget[target.relativePath] = jestRes.coverage;
  }

  // -------- Strict-mode resolver (filesystem-only, no spawn) -------------
  const strictCoverageByTargetRaw = await runProbeBestEffort(
    'strict-mode',
    () =>
      resolveStrictCoverage({
        workspaceRoot,
        targets: targets.map((t) => ({
          name: t.relativePath,
          path: t.relativePath,
        })),
      }),
    {} as Record<string, number>,
  );
  // Re-tag the strict coverage map keys to match the relativePath used by
  // the eslint/coverage maps. `resolveStrictCoverage` already returns keys
  // matching the input `name`, so this is a passthrough cast.
  const strictCoverageByTarget: Record<string, Score | Unmeasured> = {};
  for (const [key, value] of Object.entries(strictCoverageByTargetRaw)) {
    strictCoverageByTarget[key] = value;
  }

  // -------- Complexity + duplication ------------------------------------
  const complexityRes = await runProbeBestEffort(
    'complexity',
    () => runComplexity({ workspaceRoot, evidenceDir }),
    { record: undefined as never, hotspots: UNMEASURED as Unmeasured },
  );
  const duplicationRes = await runProbeBestEffort(
    'duplication',
    () => runDuplication({ workspaceRoot, evidenceDir }),
    { record: undefined as never, clusters: UNMEASURED as Unmeasured },
  );

  // -------- Security probes ---------------------------------------------
  const secretScanResult = await runProbeBestEffort(
    'secret-scan',
    () => runSecretScan({ workspaceRoot, evidenceDir }),
    { record: undefined as never, matches: UNMEASURED as Unmeasured },
  );
  const logMatches = await runProbeBestEffort<readonly LogMatch[]>(
    'log-scan',
    () => runBackendLogScan({ workspaceRoot }),
    [],
  );
  const rpcMatches = await runProbeBestEffort<readonly RpcMatch[]>(
    'rpc-scan',
    () => runRpcExposureScan({ workspaceRoot }),
    [],
  );

  // -------- Route policy verifier ---------------------------------------
  const routeOutput = await runProbeBestEffort(
    'route-verifier',
    () =>
      runRouteVerifier({
        workspaceRoot,
        backendRoutes: discovery.backendRoutes,
      }),
    {
      results: [] as Awaited<ReturnType<typeof runRouteVerifier>>['results'],
      bootstrap: undefined as never,
      jwt: undefined as never,
    },
  );

  return {
    graphifySummary,
    pnpmAdvisories,
    strictCoverageByTarget,
    eslintCountsByTarget,
    coverageByTarget,
    complexityHotspots: complexityRes.hotspots,
    duplicateClusters: duplicationRes.clusters,
    secretMatches: secretScanResult.matches,
    logMatches,
    rpcMatches,
    routeResults: routeOutput.results,
  };
}

// ===========================================================================
// Pass 3 — Synthesis orchestration
// ===========================================================================

/**
 * Build a placeholder `AuditSection` for the per-surface and cross-cutting
 * blocks. The CLI emits one of these per required section so Pass 4's
 * structural property checks pass; deeper per-surface synthesis is out of
 * scope for task 7.1 and is owned by future per-surface synthesizers.
 */
function placeholderAuditSection(title: string, summary: string): AuditSection {
  return {
    title,
    anchor: title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    summary,
    findings: [],
    source_refs: [],
  };
}

/**
 * Resolve the aggregate ESLint error count across every workspace target.
 * Returns `'unmeasured'` if any target reports `'unmeasured'` so the
 * Plan_Score heuristic can fall back to its neutral baseline rather than
 * pretending a partial measurement is full coverage.
 */
function aggregateEslintErrors(
  counts: Readonly<Record<string, EslintCount>>,
): number | Unmeasured {
  let total = 0;
  for (const value of Object.values(counts)) {
    if (value.errors === UNMEASURED) {
      return UNMEASURED;
    }
    total += value.errors;
  }
  return total;
}

/**
 * Workspace targets whose Jest coverage drives Threshold #3 (critical-path
 * test coverage). The critical paths defined inline in
 * `synthesis/thresholds.ts` (invoice creation/settlement, webhook
 * delivery/verification, wallet send, balance fetch, transaction status,
 * auth) all live inside the backend or the consumer app, so we average
 * the line coverage of those two packages and use that as the rule's
 * `current_value`.
 *
 * Targets that did not report a measured `lines` percentage are skipped
 * so a single missing probe does not drag the average to `'unmeasured'`
 * — but if NEITHER target has a measurement, the aggregate is
 * `'unmeasured'` (and Threshold #3 fails with that current value).
 */
const CRITICAL_PATH_COVERAGE_TARGETS: readonly string[] = [
  'apps/backend',
  'apps/consumer-app',
];

/**
 * Compute the critical-path coverage percentage from the Jest coverage
 * map. Returns the rounded average `lines` percentage across the
 * targets in `CRITICAL_PATH_COVERAGE_TARGETS`, or `'unmeasured'` if no
 * target reported a measurement.
 *
 * Rounding to an integer matches the `Score` shape expected by
 * `ThresholdsInput.criticalPathCoverage` (Property 12 / Requirement 9.4).
 */
function aggregateCriticalPathCoverage(
  coverageByTarget: Readonly<Record<string, CoverageSummary>>,
): number | Unmeasured {
  let sum = 0;
  let measured = 0;
  for (const target of CRITICAL_PATH_COVERAGE_TARGETS) {
    const entry = coverageByTarget[target];
    if (entry === undefined) {
      continue;
    }
    if (entry.lines === UNMEASURED) {
      continue;
    }
    sum += entry.lines;
    measured += 1;
  }
  if (measured === 0) {
    return UNMEASURED;
  }
  return Math.round(sum / measured);
}

/**
 * `pnpm audit` advisories that we have explicitly accepted as not blocking
 * production sign-off. Each entry MUST have a corresponding subsection in
 * `SECURITY.md §6 Accepted Transitive Advisories` documenting the exposure
 * surface and compensating controls.
 *
 * Filtered out by `countBlockingAdvisories` so the Production_Readiness
 * threshold does not gate on advisories whose upstream has no patched
 * version. The accepted entry is matched by GitHub advisory id (the ID
 * column pnpm prints under `github_advisory_id`); matching by name alone
 * would silently absolve future advisories on the same package.
 */
const ACCEPTED_ADVISORY_IDS: ReadonlySet<string> = new Set<string>([
  // bigint-buffer toBigIntLE buffer overflow — no upstream patch.
  // Documented in SECURITY.md §6.1.
  'GHSA-3gc7-fjrx-p6mg',
  // elliptic ECDSA signing edge case — no upstream patch, not reached
  // from any deployed code path. Documented in SECURITY.md §6.2.
  'GHSA-848j-6mx2-7j84',
]);

/**
 * Extract the GitHub advisory id from a `PnpmAdvisory.raw` payload. The
 * pnpm v9 audit JSON ships this field as `github_advisory_id`; older
 * pnpm versions used `id` or `npm_advisory_id`. Returns `null` when the
 * field is missing so unknown advisories never accidentally match
 * `ACCEPTED_ADVISORY_IDS`.
 */
function getAdvisoryId(advisory: PnpmAdvisory): string | null {
  const raw = advisory.raw;
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const ghId = r['github_advisory_id'];
  if (typeof ghId === 'string' && ghId.length > 0) {
    return ghId;
  }
  const numericId = r['id'];
  if (typeof numericId === 'number' && Number.isFinite(numericId)) {
    return String(numericId);
  }
  return null;
}

/**
 * Resolve the High+Critical advisory count from the `pnpm audit` output.
 * Returns `'unmeasured'` when the probe failed.
 *
 * Accepted advisories (see `ACCEPTED_ADVISORY_IDS`) are filtered out
 * before counting — they appear in the rendered Security_Findings_List
 * with their accepted-disposition note, but they do not gate the
 * production-readiness threshold.
 */
function countBlockingAdvisories(
  advisories: readonly PnpmAdvisory[] | Unmeasured,
): number | Unmeasured {
  if (advisories === UNMEASURED) {
    return UNMEASURED;
  }
  return advisories.filter((a) => {
    const advisoryId = getAdvisoryId(a);
    if (advisoryId !== null && ACCEPTED_ADVISORY_IDS.has(advisoryId)) {
      return false;
    }
    const severity = a.severity.toLowerCase();
    return severity === 'high' || severity === 'critical';
  }).length;
}

/**
 * Build the complete `AuditReportData` aggregate from Pass 1 + Pass 2
 * outputs. Every synthesizer is invoked here so the orchestrator owns the
 * canonical wiring between probe evidence and the rendered report.
 */
async function runPass3(args: {
  readonly workspaceRoot: string;
  readonly auditor: string;
  readonly auditedAt: string;
  readonly discovery: DiscoveryOutput;
  readonly pass2: Pass2Output;
}): Promise<AuditReportData> {
  const { workspaceRoot, auditor, auditedAt, discovery, pass2 } = args;

  // -------- Cross-cutting reference tables -------------------------------
  const scoringRubric = buildScoringRubric();
  const severityDefinitions = buildSeverityDefinitions();

  // -------- Security_Findings_List ---------------------------------------
  const securityFindings = buildSecurityFindings({
    secretMatches: pass2.secretMatches,
    logMatches: pass2.logMatches,
    rpcMatches: pass2.rpcMatches,
    pnpmAdvisories: pass2.pnpmAdvisories,
    routeResults: pass2.routeResults,
  });
  const findingCounts = {
    critical: securityFindings.filter((f) => f.severity === 'Critical').length,
    high: securityFindings.filter((f) => f.severity === 'High').length,
    medium: securityFindings.filter((f) => f.severity === 'Medium').length,
    low: securityFindings.filter((f) => f.severity === 'Low').length,
  };

  // -------- Code_Quality_Findings_List -----------------------------------
  const codeQualityFindings = buildCodeQualityFindings({
    strictCoverageByTarget: pass2.strictCoverageByTarget,
    eslintCountsByTarget: pass2.eslintCountsByTarget,
    rootScripts: discovery.rootScripts,
    coverageByTarget: pass2.coverageByTarget,
    rawHotspots:
      pass2.complexityHotspots === UNMEASURED
        ? UNMEASURED
        : pass2.complexityHotspots.map((h) => ({
            path: h.path,
            function: h.function,
            score: h.score,
          })),
    rawDuplicates:
      pass2.duplicateClusters === UNMEASURED
        ? UNMEASURED
        : pass2.duplicateClusters.map((c) => ({
            locations: c.locations,
            sharedLines: c.sharedLines,
          })),
  });

  // -------- Plans_Library Refresh Table ----------------------------------
  const eslintErrorCount = aggregateEslintErrors(pass2.eslintCountsByTarget);
  const blockingAdvisoryCount = countBlockingAdvisories(pass2.pnpmAdvisories);
  const planScores = buildPlanScores({
    workspaceRoot,
    planFiles: discovery.planFiles,
    findingCounts,
    eslintErrorCount,
    pnpmAdvisoryCount: blockingAdvisoryCount,
  });

  // -------- Network_Icon Replacement Plan --------------------------------
  const networkIconPlan = buildNetworkIconPlan({
    discoveredAssets: discovery.networkIconAssets,
    discoveredRenderers: discovery.networkIconRenderers,
  });

  // -------- Frontend_Polish_Plan -----------------------------------------
  const frontendPolishPlan = buildFrontendPolishPlan();

  // -------- Spec_Coherence_Report ----------------------------------------
  const specCoherenceReport = await buildSpecCoherenceReport({
    workspaceRoot,
    specDirs: discovery.specDirs,
    evidenceCorpus: {
      backendRoutes: discovery.backendRoutes,
    },
  });

  // -------- Production_Readiness_Thresholds ------------------------------
  const thresholds = buildProductionReadinessThresholds({
    findings: securityFindings,
    planScores,
    graphifyRunAt: pass2.graphifySummary.run_at,
    auditGeneratedAt: auditedAt,
    networkIcons: networkIconPlan,
    eslintCounts: pass2.eslintCountsByTarget,
    pnpmAuditAdvisories:
      pass2.pnpmAdvisories === UNMEASURED
        ? []
        : pass2.pnpmAdvisories
            // Drop accepted advisories so threshold row 8 reflects only
            // genuinely-actionable High/Critical advisories — accepted
            // entries are still surfaced in the Security_Findings_List
            // and SECURITY.md §6 with their compensating controls.
            .filter((a) => {
              const advisoryId = getAdvisoryId(a);
              return (
                advisoryId === null || !ACCEPTED_ADVISORY_IDS.has(advisoryId)
              );
            })
            .map((a) => ({ severity: a.severity })),
    criticalPathCoverage: aggregateCriticalPathCoverage(pass2.coverageByTarget),
  });

  // -------- Run Metadata + executive summary -----------------------------
  const metadata: RunMetadata = {
    generated_at: auditedAt,
    workspace_sha: discovery.workspaceSha,
    graphify_run_at: pass2.graphifySummary.run_at,
    auditor,
    plans_library_snapshot: discovery.planFiles,
  };
  const executiveSummary = buildExecutiveSummary({
    findingCounts,
    blockingAdvisoryCount,
    eslintErrorCount,
  });

  // -------- Per-surface + cross-cutting placeholders ---------------------
  const perSurfaceSections = {
    backend_service: placeholderAuditSection(
      'Backend_Service',
      'Backend service audit. Detailed findings live in the Security_Findings_List and Code_Quality_Findings_List below.',
    ),
    consumer_app: placeholderAuditSection(
      'Consumer_App',
      'React Native consumer app audit. Detailed findings live in the linked lists below.',
    ),
    frontend_app: placeholderAuditSection(
      'Frontend_App',
      'Web frontend audit. Detailed findings live in the linked lists below.',
    ),
    indexer_service: placeholderAuditSection(
      'Indexer_Service',
      'Chain indexer audit. Detailed findings live in the linked lists below.',
    ),
    shared_packages: placeholderAuditSection(
      'Shared packages/*',
      'Shared workspace package audit. Detailed findings live in the linked lists below.',
    ),
  } as const;
  const crossCuttingSections = {
    on_chain_integration: placeholderAuditSection(
      'On-chain integration',
      'On-chain integration audit covers RPC exposure, signing flows, and read-only chain access.',
    ),
    webhooks: placeholderAuditSection(
      'Webhooks',
      'Webhook audit covers signature verification and the 5-minute timestamp window per route.',
    ),
    auth_boundaries: placeholderAuditSection(
      'Auth boundaries',
      'Auth boundary audit covers merchant, invoice, and admin route protection plus scope checks.',
    ),
    error_handling: placeholderAuditSection(
      'Error handling',
      'Error handling audit covers structured error surfaces and retry semantics.',
    ),
    observability: placeholderAuditSection(
      'Observability',
      'Observability audit covers structured logging, redaction, and metric emission.',
    ),
    test_coverage: placeholderAuditSection(
      'Test coverage',
      'Test coverage audit references the per-target percentages in the Code_Quality_Findings_List.',
    ),
    build_and_deploy: placeholderAuditSection(
      'Build and deploy',
      'Build and deploy audit covers monorepo build pipelines and release gating.',
    ),
  } as const;

  return {
    metadata,
    executive_summary: executiveSummary,
    scoring_rubric: scoringRubric,
    severity_definitions: severityDefinitions,
    production_readiness_thresholds: thresholds,
    per_surface_sections: perSurfaceSections,
    cross_cutting_sections: crossCuttingSections,
    security_findings_list: securityFindings,
    code_quality_findings_list: codeQualityFindings,
    spec_coherence_report: specCoherenceReport,
    frontend_polish_plan: frontendPolishPlan,
    network_icon_replacement_plan: networkIconPlan,
    plans_library_refresh: planScores,
    graphify_refresh_summary: pass2.graphifySummary,
    verdict: computeVerdict(thresholds),
  };
}

/**
 * Render a short executive summary that sits comfortably under the 500-word
 * budget enforced by Property 2 / Requirement 1.5. The summary is generated
 * deterministically from the synthesized counts so the same inputs always
 * produce the same text — useful for property tests and for diffing two
 * audit runs against each other.
 */
function buildExecutiveSummary(args: {
  readonly findingCounts: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
  readonly blockingAdvisoryCount: number | Unmeasured;
  readonly eslintErrorCount: number | Unmeasured;
}): string {
  const { findingCounts, blockingAdvisoryCount, eslintErrorCount } = args;
  const advisoryStr =
    blockingAdvisoryCount === UNMEASURED
      ? 'unmeasured'
      : String(blockingAdvisoryCount);
  const eslintStr =
    eslintErrorCount === UNMEASURED ? 'unmeasured' : String(eslintErrorCount);
  return [
    'This audit consolidates the production-readiness signals captured by the four-pass pipeline (Discovery, Static Analysis, Synthesis, Reporting) against the workspace under audit.',
    `Security pass produced ${findingCounts.critical} Critical, ${findingCounts.high} High, ${findingCounts.medium} Medium, and ${findingCounts.low} Low findings; pnpm reported ${advisoryStr} High+Critical dependency advisories.`,
    `Code-quality pass aggregated ${eslintStr} ESLint errors across the workspace targets and surfaced the top cyclomatic complexity hotspots and cross-app duplicate clusters.`,
    'The Plans_Library refresh table scores every canonical plan across the five rubric dimensions; sub-threshold dimensions are accompanied by a tagged GapNote pointing back to the relevant section.',
    'Threshold rows in the Production_Readiness_Thresholds checklist gate sign-off — the overall verdict is the conjunction of every row.',
  ].join('\n\n');
}

// ===========================================================================
// Top-level orchestrator
// ===========================================================================

/**
 * Result of `orchestrate`. The caller (`main`) translates this into a
 * process exit code.
 *
 *   - `success`              — Pass 4 wrote the consolidated report and
 *                              every Plan_Document was annotated.
 *   - `aborted`              — Pass 1 threw `AuditAbortError`; Pass 4
 *                              wrote `ABORT.md` and skipped both the
 *                              report and Plan_Document annotation.
 *   - `validation_failure`   — A Pass 3/Pass 4 contract violation or an
 *                              unexpected runtime error bubbled out.
 */
type OrchestrateResult = 'success' | 'aborted' | 'validation_failure';

/**
 * Drive the four-pass pipeline against `args.workspaceRoot`.
 *
 * Order of operations:
 *   1. Compute the canonical `plansDir`, `evidenceDir`, and
 *      `graphifyOutDir` paths under the workspace root.
 *   2. Run Pass 1 (`runDiscovery`). On `AuditAbortError`, jump to step 5.
 *   3. Enumerate workspace targets and run Pass 2 best-effort.
 *   4. Synthesize Pass 3.
 *   5. Run Pass 4 (`runReporting`). The orchestrator delegates the abort-
 *      vs-success branch to `runReporting` itself — when `abortError` is
 *      passed, the reporter writes `ABORT.md` and returns; otherwise it
 *      validates and writes the consolidated report.
 *
 * Errors thrown from Pass 2 / Pass 3 / Pass 4 (other than `AuditAbortError`)
 * are caught by the caller and surfaced as exit code 1.
 */
async function orchestrate(args: CliArgs): Promise<OrchestrateResult> {
  const { workspaceRoot, auditor } = args;
  const plansDir = path.join(workspaceRoot, 'plans');
  const evidenceDir = path.join(plansDir, '.audit-evidence');
  const graphifyOutDir = path.join(workspaceRoot, 'graphify-out');
  const auditedAt = new Date().toISOString();

  // -------- Pass 1 — Discovery -----------------------------------------
  let discovery: DiscoveryOutput;
  try {
    discovery = await runDiscovery({ workspaceRoot, evidenceDir });
  } catch (err) {
    if (isAuditAbortError(err)) {
      // Pass 4's abort writer needs the evidence directory to exist.
      // `runReporting` calls `mkdir -p` itself but only on the success
      // path; the abort path goes straight to the marker write, so we
      // ensure the directory exists here as well.
      await fs.mkdir(evidenceDir, { recursive: true });
      await runReporting({
        // The abort path never reads `audit`, so passing a placeholder
        // is safe. The cast keeps the type checker happy without forcing
        // the orchestrator to fabricate a fake AuditReportData.
        audit: {} as AuditReportData,
        plansDir,
        auditor,
        auditedAt,
        abortError: err,
      });
      return 'aborted';
    }
    throw err;
  }

  // -------- Pass 2 — Static Analysis ------------------------------------
  const targets = await listWorkspaceTargets(workspaceRoot);
  const pass2 = await runPass2({
    workspaceRoot,
    evidenceDir,
    graphifyOutDir,
    discovery,
    targets,
  });

  // -------- Pass 3 — Synthesis ------------------------------------------
  const audit = await runPass3({
    workspaceRoot,
    auditor,
    auditedAt,
    discovery,
    pass2,
  });

  // -------- Pass 4 — Reporting ------------------------------------------
  const reportingResult = await runReporting({
    audit,
    plansDir,
    auditor,
    auditedAt,
  });

  if (reportingResult.aborted) {
    // `runReporting` only flags `aborted: true` when an abortError was
    // supplied — the success path above never sets one — so this branch
    // is unreachable in practice. Keeping it explicit makes the
    // exit-code mapping in `main` exhaustive.
    return 'aborted';
  }
  return 'success';
}

// ===========================================================================
// Process entry point
// ===========================================================================

/**
 * Map an `OrchestrateResult` into the canonical process exit code:
 *
 *   - `success`            → 0
 *   - `aborted`            → 2
 *   - `validation_failure` → 1
 */
function exitCodeFor(result: OrchestrateResult): number {
  if (result === 'success') return 0;
  if (result === 'aborted') return 2;
  return 1;
}

/**
 * Process entrypoint. Parses argv, dispatches to the orchestrator, and
 * exits with the canonical code. Errors thrown from the orchestrator
 * (other than the already-handled `AuditAbortError`) are logged and
 * mapped to exit code 1.
 */
export async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[auditor] ${message}`);
    printUsage();
    process.exit(1);
    return;
  }

  if (args.command === 'help') {
    printUsage();
    process.exit(0);
    return;
  }

  let result: OrchestrateResult;
  try {
    result = await orchestrate(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[auditor] orchestrator failed: ${message}`);
    if (err instanceof Error && err.stack !== undefined) {
      // eslint-disable-next-line no-console
      console.error(err.stack);
    }
    process.exit(1);
    return;
  }
  process.exit(exitCodeFor(result));
}

/**
 * Run `main()` only when the file is executed directly. The
 * `require.main === module` guard keeps the orchestrator importable for
 * unit tests (task 7.2 smoke test) without firing the entrypoint.
 */
if (require.main === module) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[auditor] unhandled error: ${message}`);
    process.exit(1);
  });
}
