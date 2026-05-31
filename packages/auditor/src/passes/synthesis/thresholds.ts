/**
 * Pass 3 — Synthesis: Production_Readiness_Thresholds + verdict builders.
 *
 * Pure (no I/O) factories that compute the eight-row production-readiness
 * checklist and the overall pass/fail verdict that anchor the Audit_Report.
 *
 * Mirrors:
 *   - design.md "Production_Readiness_Thresholds component" — eight-row
 *     Markdown table in the fixed order id 1..8.
 *   - design.md "Production_Readiness_Threshold row" YAML schema — id,
 *     label, target, current_value, pass, explanation.
 *
 * Validates Requirements:
 *   - 9.1 (checklist with one row per threshold)
 *   - 9.2 (Critical security findings = 0)
 *   - 9.3 (High security findings = 0)
 *   - 9.4 (critical-path coverage with explicit critical-path list)
 *   - 9.5 (every Plan_Score >= 85 in every rubric dimension)
 *   - 9.6 (Graph_Report regenerated within 24h, delta=0 passes)
 *   - 9.7 (Network_Icon_Set 100% replaced with documented exceptions)
 *   - 9.8 (ESLint errors = 0 across every app and package)
 *   - 9.9 (pnpm audit High+Critical advisories = 0)
 *   - 9.10 (verdict is the conjunction of every row's pass field)
 *
 * Property 12 (rule completeness) and Property 13 (verdict conjunction) are
 * exercised by the companion tests in tasks 4.16 and 4.17.
 */

import {
  UNMEASURED,
  type EslintCount,
  type Network_Icon,
  type Plan_Score,
  type Production_Readiness_Threshold,
  type RubricDimension,
  type Verdict,
  type Vulnerability_Finding,
} from '../../models';

// ---------------------------------------------------------------------------
// Critical paths (Requirement 9.4)
//
// Defined inline per design.md "Production_Readiness_Thresholds component":
// "The 'critical paths' referenced in row 3 are defined inline (Requirement
// 9.4) as: invoice creation, invoice settlement, webhook delivery, webhook
// signature verification, wallet send flow, balance fetch, transaction status
// polling, and auth/JWT issuance/refresh."
// ---------------------------------------------------------------------------

/**
 * The eight critical paths whose test coverage drives threshold row 3.
 *
 * Frozen so the array is identity-stable across the audit pipeline (Property
 * 12 walks this list to assert the coverage rule cites a non-empty set).
 */
export const CRITICAL_PATHS: readonly string[] = Object.freeze([
  'invoice creation',
  'invoice settlement',
  'webhook delivery',
  'webhook signature verification',
  'wallet send flow',
  'balance fetch',
  'transaction status polling',
  'auth/JWT issuance/refresh',
]);

// ---------------------------------------------------------------------------
// Threshold tuning constants
// ---------------------------------------------------------------------------

/** Critical-path coverage target in percent (Requirement 9.4). */
const CRITICAL_PATH_COVERAGE_TARGET = 80 as const;

/** Plan_Score floor across every rubric dimension (Requirement 9.5). */
const PLAN_SCORE_FLOOR = 85 as const;

/** Graph_Report freshness window in hours (Requirement 9.6). */
const GRAPH_REPORT_MAX_AGE_HOURS = 24 as const;

/** Severity strings (case-insensitive) that fail threshold row 8. */
const BLOCKING_ADVISORY_SEVERITIES: readonly string[] = ['high', 'critical'];

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/**
 * Aggregated synthesis-pass output consumed by the threshold builder.
 *
 * Each field corresponds to one or more threshold rows:
 *   - findings → rows 1, 2 (Critical / High counts)
 *   - criticalPathCoverage → row 3
 *   - planScores → row 4 (per-dimension floor)
 *   - graphifyRunAt + auditGeneratedAt → row 5 (delta in hours)
 *   - networkIcons → row 6 (license-compatible OR documented fallback)
 *   - eslintCounts → row 7 (errors across every workspace)
 *   - pnpmAuditAdvisories → row 8 (High + Critical advisory count)
 */
export interface ThresholdsInput {
  readonly findings: readonly Vulnerability_Finding[];
  readonly planScores: readonly Plan_Score[];
  /** ISO 8601 timestamp at which `graphify .` (or `--update`) completed. */
  readonly graphifyRunAt: string;
  /** ISO 8601 timestamp at which the audit run started. */
  readonly auditGeneratedAt: string;
  readonly networkIcons: readonly Network_Icon[];
  readonly eslintCounts: Readonly<Record<string, EslintCount>>;
  readonly pnpmAuditAdvisories: ReadonlyArray<{ readonly severity: string }>;
  /**
   * Aggregate test coverage on the `CRITICAL_PATHS` list, expressed as a
   * percentage in the inclusive range 0..100, or `UNMEASURED` when the
   * jest coverage probe failed for a critical-path target.
   */
  readonly criticalPathCoverage: number | typeof UNMEASURED;
}

// ---------------------------------------------------------------------------
// Row builders — one helper per threshold row, each returning a frozen row.
// ---------------------------------------------------------------------------

/** Row 1: Critical security findings = 0 (Requirement 9.2). */
const buildRow1 = (findings: readonly Vulnerability_Finding[]): Production_Readiness_Threshold => {
  const count = findings.filter((f) => f.severity === 'Critical').length;
  return Object.freeze({
    id: 1,
    label: 'Critical security findings = 0',
    target: '= 0',
    current_value: String(count),
    pass: count === 0,
    explanation: 'See Security_Findings_List',
  });
};

/** Row 2: High security findings = 0 (Requirement 9.3). */
const buildRow2 = (findings: readonly Vulnerability_Finding[]): Production_Readiness_Threshold => {
  const count = findings.filter((f) => f.severity === 'High').length;
  return Object.freeze({
    id: 2,
    label: 'High security findings = 0',
    target: '= 0',
    current_value: String(count),
    pass: count === 0,
    explanation: 'See Security_Findings_List',
  });
};

/** Row 3: critical-path test coverage >= 80% (Requirement 9.4). */
const buildRow3 = (
  coverage: number | typeof UNMEASURED,
): Production_Readiness_Threshold => {
  const measured = coverage !== UNMEASURED;
  const pass = measured && coverage >= CRITICAL_PATH_COVERAGE_TARGET;
  const currentValue = measured ? `${coverage}%` : UNMEASURED;
  return Object.freeze({
    id: 3,
    label: `Critical-path test coverage >= ${CRITICAL_PATH_COVERAGE_TARGET}%`,
    target: `>= ${CRITICAL_PATH_COVERAGE_TARGET}%`,
    current_value: currentValue,
    pass,
    explanation: `Critical paths: ${CRITICAL_PATHS.join(', ')}. See Code_Quality_Findings_List > Test Coverage`,
  });
};

/** The five rubric dimension keys, in canonical order. */
const PLAN_SCORE_DIMENSIONS: readonly RubricDimension[] = [
  'security',
  'code_quality',
  'ux_polish',
  'performance',
  'production_readiness',
];

/**
 * Row 4: every Plan_Document Plan_Score >= 85 in every rubric dimension
 * (Requirement 9.5).
 *
 * `current_value` is the minimum dimension score observed across every plan
 * × every dimension. With no plans, the minimum is undefined; treat that as
 * a hard fail and surface `'no plans'` so the report makes the cause obvious.
 */
const buildRow4 = (planScores: readonly Plan_Score[]): Production_Readiness_Threshold => {
  if (planScores.length === 0) {
    return Object.freeze({
      id: 4,
      label: 'Every Plan_Document Plan_Score >= 85 in every rubric dimension',
      target: '>= 85',
      current_value: 'no plans',
      pass: false,
      explanation: 'See Plans_Library Refresh Table',
    });
  }
  let minScore = Number.POSITIVE_INFINITY;
  for (const plan of planScores) {
    for (const dimension of PLAN_SCORE_DIMENSIONS) {
      const score = plan.scores[dimension];
      if (score < minScore) {
        minScore = score;
      }
    }
  }
  return Object.freeze({
    id: 4,
    label: 'Every Plan_Document Plan_Score >= 85 in every rubric dimension',
    target: '>= 85',
    current_value: String(minScore),
    pass: minScore >= PLAN_SCORE_FLOOR,
    explanation: 'See Plans_Library Refresh Table',
  });
};

/**
 * Row 5: Graph_Report regenerated within 24h of sign-off (Requirement 9.6).
 *
 * Delta is computed as `auditGeneratedAt - graphifyRunAt` in hours. Per
 * Requirement 9.6 a delta of zero hours passes; a freshly regenerated graph
 * is the ideal case, not a failure. If either timestamp fails to parse, the
 * row fails with an explicit `'invalid timestamp'` current value so the
 * cause is visible in the rendered report.
 */
const buildRow5 = (
  graphifyRunAt: string,
  auditGeneratedAt: string,
): Production_Readiness_Threshold => {
  const graphifyMs = Date.parse(graphifyRunAt);
  const auditMs = Date.parse(auditGeneratedAt);
  if (Number.isNaN(graphifyMs) || Number.isNaN(auditMs)) {
    return Object.freeze({
      id: 5,
      label: 'Graph_Report regenerated within 24h',
      target: '<= 24h',
      current_value: 'invalid timestamp',
      pass: false,
      explanation: 'See Graphify Refresh Summary',
    });
  }
  const deltaHours = (auditMs - graphifyMs) / (1000 * 60 * 60);
  // Negative delta means graphify ran after the audit started — treat it as
  // zero (the report is fresher than the audit clock claims). Property 12
  // and Requirement 9.6 both treat delta=0 as passing.
  const normalizedDelta = Math.max(0, deltaHours);
  return Object.freeze({
    id: 5,
    label: 'Graph_Report regenerated within 24h',
    target: '<= 24h',
    current_value: `${normalizedDelta.toFixed(2)}h`,
    pass: normalizedDelta <= GRAPH_REPORT_MAX_AGE_HOURS,
    explanation: 'See Graphify Refresh Summary',
  });
};

/**
 * Row 6: Network_Icon_Set 100% replaced with brand-official assets, with
 * documented gaps counted as exceptions (Requirements 9.7 + 4.9).
 *
 * Per the task notes: pass iff every Network_Icon entry has
 *   `license_compatible === true` OR `fallback_action !== null`.
 *
 * The `fallback_action` carries the documented exception text (Requirement
 * 4.9), so a non-null fallback is the explicit gap acknowledgement.
 */
const buildRow6 = (icons: readonly Network_Icon[]): Production_Readiness_Threshold => {
  if (icons.length === 0) {
    return Object.freeze({
      id: 6,
      label: 'Network_Icon_Set 100% replaced with brand-official assets (excluding documented gaps)',
      target: '100%',
      current_value: 'no icons',
      pass: false,
      explanation: 'See Network_Icon Replacement Plan',
    });
  }
  const compliant = icons.filter(
    (icon) => icon.license_compatible === true || icon.fallback_action !== null,
  ).length;
  const percentage = (compliant / icons.length) * 100;
  return Object.freeze({
    id: 6,
    label: 'Network_Icon_Set 100% replaced with brand-official assets (excluding documented gaps)',
    target: '100%',
    current_value: `${percentage.toFixed(0)}%`,
    pass: compliant === icons.length,
    explanation: 'See Network_Icon Replacement Plan',
  });
};

/**
 * Row 7: ESLint errors = 0 across every app and package (Requirement 9.8).
 *
 * Aggregates per-target counts. If any target reports `UNMEASURED`, the row
 * fails with current value `unmeasured` (an unmeasured target is treated as
 * a hard fail per the task notes — we cannot certify zero errors without
 * data). When every target is measured, the row passes iff every target's
 * error count is exactly zero.
 */
const buildRow7 = (
  eslintCounts: Readonly<Record<string, EslintCount>>,
): Production_Readiness_Threshold => {
  const targets = Object.values(eslintCounts);
  if (targets.length === 0) {
    return Object.freeze({
      id: 7,
      label: 'ESLint errors = 0 across every app and package',
      target: '= 0',
      current_value: 'no targets',
      pass: false,
      explanation: 'See Code_Quality_Findings_List > ESLint',
    });
  }
  const hasUnmeasured = targets.some((t) => t.errors === UNMEASURED);
  if (hasUnmeasured) {
    return Object.freeze({
      id: 7,
      label: 'ESLint errors = 0 across every app and package',
      target: '= 0',
      current_value: UNMEASURED,
      pass: false,
      explanation: 'See Code_Quality_Findings_List > ESLint',
    });
  }
  let totalErrors = 0;
  for (const target of targets) {
    // Narrowed by the unmeasured guard above, but TypeScript needs the check.
    if (typeof target.errors === 'number') {
      totalErrors += target.errors;
    }
  }
  return Object.freeze({
    id: 7,
    label: 'ESLint errors = 0 across every app and package',
    target: '= 0',
    current_value: String(totalErrors),
    pass: totalErrors === 0,
    explanation: 'See Code_Quality_Findings_List > ESLint',
  });
};

/**
 * Row 8: pnpm audit High and Critical advisories = 0 (Requirement 9.9).
 *
 * Severity comparison is case-insensitive so that variations in `pnpm audit`
 * output (`High` vs `high`) do not silently miss advisories.
 */
const buildRow8 = (
  advisories: ReadonlyArray<{ readonly severity: string }>,
): Production_Readiness_Threshold => {
  const blocking = advisories.filter((a) =>
    BLOCKING_ADVISORY_SEVERITIES.includes(a.severity.toLowerCase()),
  ).length;
  return Object.freeze({
    id: 8,
    label: '`pnpm audit` High and Critical advisories = 0',
    target: '= 0',
    current_value: String(blocking),
    pass: blocking === 0,
    explanation: 'See Security_Findings_List > Dependency Advisories',
  });
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the eight-row Production_Readiness_Thresholds checklist.
 *
 * Pure: no I/O, no clock, no randomness — every measurement is supplied via
 * the typed `ThresholdsInput`. The return value is a frozen array of frozen
 * rows so callers can treat it as an immutable singleton for the run.
 *
 * Row ordering is fixed at id 1..8 to match the design.md threshold table
 * and Property 12 (rule completeness).
 *
 * Validates Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9.
 */
export const buildProductionReadinessThresholds = (
  input: ThresholdsInput,
): readonly Production_Readiness_Threshold[] =>
  Object.freeze([
    buildRow1(input.findings),
    buildRow2(input.findings),
    buildRow3(input.criticalPathCoverage),
    buildRow4(input.planScores),
    buildRow5(input.graphifyRunAt, input.auditGeneratedAt),
    buildRow6(input.networkIcons),
    buildRow7(input.eslintCounts),
    buildRow8(input.pnpmAuditAdvisories),
  ]);

/**
 * Compute the overall production-readiness verdict.
 *
 * The verdict is `'pass'` if and only if every row's `pass` field is `true`,
 * matching Requirement 9.10 / Property 13 exactly. An empty input yields
 * `'pass'` per the standard semantics of conjunction over an empty set; in
 * practice the threshold builder always emits eight rows, so this branch is
 * unreachable from a real audit run but is left intentional for the property
 * test that walks arbitrary row mixes.
 *
 * Pure: no I/O, no clock.
 *
 * Validates Requirement 9.10.
 */
export const computeVerdict = (
  rows: readonly Production_Readiness_Threshold[],
): Verdict => (rows.every((row) => row.pass) ? 'pass' : 'fail');
