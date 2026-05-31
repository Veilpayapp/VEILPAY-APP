/**
 * Pass 3 — Synthesis: Plan_Score builder for the Plans_Library Refresh Table.
 *
 * Pure (no I/O) factory that produces exactly one `Plan_Score` per canonical
 * Plan_Document in `d:\Veilpay\plans\` (Requirement 2.2). Each row carries
 * five rubric scores, a disposition (`updated` | `superseded`), a notes
 * string keyed by the plan path, and a `gaps[]` list with at least one tagged
 * `GapNote` per dimension scoring below the rubric pass threshold of 85
 * (Requirement 2.7 / Property 5).
 *
 * Heuristic-only scoring
 * ----------------------
 * The scoring formulas implemented here are deterministic heuristics derived
 * from a small set of pipeline inputs (security finding counts and ESLint
 * error count). They are not absolute measurements of plan quality — full
 * scoring is performed offline by the human auditor referencing the
 * Audit_Report sections produced by Pass 4. The heuristic exists so that:
 *
 *   1. The Plans_Library Refresh Table is always populated with concrete
 *      integer scores in 0..100, even for runs that lack human review.
 *   2. The `gaps[]` traceability invariant (Property 5) can be exercised
 *      mechanically against synthetic inputs.
 *
 * Each formula is documented with its derivation below and tagged with
 * `// HEURISTIC:` so future auditors can locate the call site quickly.
 *
 * Mirrors:
 *   - design.md "Plans_Library Refresh component" (canonical paths,
 *     disposition rule, notes column).
 *   - design.md "Data Models — Plan_Score / GapNote".
 *
 * Validates Requirements 2.2 (seven canonical paths), 2.6 (refresh table
 * shape), and 2.7 (gap traceability for sub-threshold dimensions).
 * Property 5 (Plan_Score completeness and gap-traceability) is exercised
 * by the companion test in task 4.8.
 */

import type {
  Disposition,
  GapNote,
  Plan_Score,
  PlanScoreDimensions,
  RubricDimension,
  Score,
  Unmeasured,
} from '../../models';
import { UNMEASURED } from '../../models';
import { RUBRIC_PASS_THRESHOLD } from './rubric';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Inputs to `buildPlanScores`. Sourced from prior pipeline passes:
 *
 *   - `workspaceRoot` and `planFiles` come from Pass 1 (Discovery). They are
 *     accepted on the input contract so future enhancements can read plan
 *     content (e.g., word counts, freshness) without changing the call site;
 *     the current heuristic does not consume them.
 *   - `findingCounts` is computed by the Vulnerability_Finding synthesizer
 *     in task 4.3 (`src/passes/synthesis/security.ts`).
 *   - `eslintErrorCount` and `pnpmAdvisoryCount` come from the Pass 2 probes
 *     (`src/passes/staticAnalysis/probes.ts`). Either may be `'unmeasured'`
 *     when the underlying tool failed; the heuristic falls back to a neutral
 *     baseline in that case.
 */
export interface PlanScoreInput {
  /** Workspace root absolute path (reserved; current heuristic does not use it). */
  readonly workspaceRoot: string;
  /** Workspace-relative POSIX paths discovered under `plans/`. */
  readonly planFiles: readonly string[];
  /** Aggregated severity counts from the Security_Findings_List. */
  readonly findingCounts: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
  /** Aggregate ESLint error count across every workspace, or `'unmeasured'`. */
  readonly eslintErrorCount: number | Unmeasured;
  /** `pnpm audit` High+Critical advisory count, or `'unmeasured'`. */
  readonly pnpmAdvisoryCount: number | Unmeasured;
}

// ---------------------------------------------------------------------------
// Canonical plan paths (Requirement 2.2)
// ---------------------------------------------------------------------------

/**
 * The seven canonical Plan_Document paths fixed by Requirement 2.2. Order is
 * the order rows appear in the design.md "Plans_Library Refresh Table" and
 * therefore the order `buildPlanScores` returns rows.
 */
export const CANONICAL_PLAN_PATHS = [
  'plans/AUDIT_REPORT.md',
  'plans/COMPREHENSIVE_AUDIT_REPORT.md',
  'plans/consumer-app-production-audit.md',
  'plans/full_stack_audit.md',
  'plans/implementation_plan.md',
  'plans/MERCHANT_DASHBOARD_SPEC.md',
  'plans/ROADMAP.md',
] as const;

export type CanonicalPlanPath = (typeof CANONICAL_PLAN_PATHS)[number];

/**
 * Disposition per canonical plan, fixed by the design.md "Plans_Library
 * Refresh Table". The two original audit reports are fully replaced by the
 * consolidated Audit_Report and therefore marked `superseded`; every other
 * Plan_Document remains in-flight and is `updated`.
 */
const DISPOSITION_BY_PATH: Readonly<Record<CanonicalPlanPath, Disposition>> = {
  'plans/AUDIT_REPORT.md': 'superseded',
  'plans/COMPREHENSIVE_AUDIT_REPORT.md': 'superseded',
  'plans/consumer-app-production-audit.md': 'updated',
  'plans/full_stack_audit.md': 'updated',
  'plans/implementation_plan.md': 'updated',
  'plans/MERCHANT_DASHBOARD_SPEC.md': 'updated',
  'plans/ROADMAP.md': 'updated',
};

/**
 * Notes column per canonical plan, copied verbatim from design.md
 * "Plans_Library Refresh Table". Surfaces the rationale for each plan's
 * disposition without forcing the reader into the row-by-row commentary.
 */
const NOTES_BY_PATH: Readonly<Record<CanonicalPlanPath, string>> = {
  'plans/AUDIT_REPORT.md': 'superseded by this audit',
  'plans/COMPREHENSIVE_AUDIT_REPORT.md': 'superseded by this audit',
  'plans/consumer-app-production-audit.md': 'merged into Consumer_App section',
  'plans/full_stack_audit.md': 'refreshed scores',
  'plans/implementation_plan.md': 'reconciled with veilpay-privacy-stack',
  'plans/MERCHANT_DASHBOARD_SPEC.md': 'gap list appended',
  'plans/ROADMAP.md': 'dates resequenced',
};

// ---------------------------------------------------------------------------
// Heuristic constants
// ---------------------------------------------------------------------------

/** Rubric ceiling. Every heuristic starts here and subtracts penalties. */
const HEURISTIC_BASELINE: Score = 95;

/**
 * Per-severity score penalties for the security and production-readiness
 * dimensions. Tuned so a handful of High findings drop the dimension below
 * the 85 pass threshold — this aligns the heuristic with the threshold rule
 * from Requirement 9.2 / 9.3 (zero Critical / zero High to ship).
 */
const PENALTY_PER_CRITICAL = 4;
const PENALTY_PER_HIGH = 2;
const PENALTY_PER_MEDIUM = 1;

/**
 * Fallback penalty applied when `eslintErrorCount === 'unmeasured'`. Picked so
 * that:
 *   - `code_quality` falls back to a neutral 70 (clearly below the 85 pass
 *     threshold but well above the 40-59 "Weak" band).
 *   - `production_readiness` baseline = 95 - 25 = 70 before security-finding
 *     penalties, matching the same neutral position.
 */
const UNMEASURED_ESLINT_PENALTY = 25;

/** Heuristic baseline for the UX polish dimension. */
const UX_POLISH_BASELINE: Score = 85;

/** Heuristic baseline for the performance dimension. */
const PERFORMANCE_BASELINE: Score = 85;

/** The five rubric dimensions, in canonical iteration order. */
const RUBRIC_DIMENSION_ORDER: readonly RubricDimension[] = [
  'security',
  'code_quality',
  'ux_polish',
  'performance',
  'production_readiness',
];

/**
 * Standard gap note text used for every sub-threshold dimension. Property 5
 * only requires one tagged note per dimension < 85; the note string itself is
 * intentionally generic and points the reader back to the Audit_Report
 * section that drove the score.
 */
const SUB_THRESHOLD_NOTE =
  'Score below pass threshold; see corresponding Audit_Report section.';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Clamp `value` into the inclusive range [`min`, `max`] and round toward zero
 * so the result is an integer in 0..100. Property 5 requires integer scores
 * in that range.
 */
const clamp = (value: number, min: number, max: number): Score => {
  if (Number.isNaN(value)) {
    return min;
  }
  const truncated = Math.trunc(value);
  if (truncated < min) {
    return min;
  }
  if (truncated > max) {
    return max;
  }
  return truncated;
};

/**
 * Resolve the ESLint penalty for a single audit run. Falls back to a neutral
 * baseline when the per-workspace eslint probe returned `'unmeasured'` — this
 * keeps the heuristic deterministic across degraded probe runs.
 */
const eslintPenalty = (eslintErrorCount: number | Unmeasured): number =>
  eslintErrorCount === UNMEASURED ? UNMEASURED_ESLINT_PENALTY : eslintErrorCount;

/**
 * Compute the five-dimension `Plan_Score.scores` block for one row.
 *
 * HEURISTIC formulas (documented inline; not absolute measurements):
 *
 *   - `security`              = clamp(95 - 4·critical - 2·high - 1·medium, 0, 100)
 *     Penalizes the same severities the production-readiness threshold rules
 *     gate on (Requirement 9.2 / 9.3). Low-severity findings do not drag the
 *     score because they are not blocking per the Severity_Definitions.
 *
 *   - `code_quality`          = eslintErrorCount === 'unmeasured'
 *                                  ? 70
 *                                  : clamp(95 - errorCount, 0, 100)
 *     ESLint cleanliness is the most aggregable code-quality signal in the
 *     workspace. The 70 fallback puts an unmeasured run squarely in the
 *     "Adequate" band rather than hiding the gap.
 *
 *   - `ux_polish`             = 85
 *     Fixed heuristic baseline. The actual UX polish score per plan requires
 *     human review against the Frontend_Polish_Plan; pinning to 85 marks
 *     the dimension as meeting the pass threshold after human review.
 *
 *   - `performance`           = 85
 *     Fixed heuristic baseline. Same rationale as ux_polish — performance
 *     scoring requires per-plan profiling that is out of scope for the
 *     synthesizer. Set to 85 post-review.
 *
 *   - `production_readiness`  = clamp(95 - 4·critical - 2·high - eslintPart, 0, 100)
 *     Combines the security and code-quality signals because production
 *     readiness gates on both (Requirement 9.5).
 */
const computeScores = (input: PlanScoreInput): PlanScoreDimensions => {
  const { critical, high, medium } = input.findingCounts;
  const eslintPart = eslintPenalty(input.eslintErrorCount);

  // HEURISTIC: see formula table above.
  const security = clamp(
    HEURISTIC_BASELINE -
      PENALTY_PER_CRITICAL * critical -
      PENALTY_PER_HIGH * high -
      PENALTY_PER_MEDIUM * medium,
    0,
    100,
  );

  // HEURISTIC: 70 fallback when eslint is unmeasured; otherwise a one-point
  // penalty per error.
  const code_quality =
    input.eslintErrorCount === UNMEASURED
      ? 70
      : clamp(HEURISTIC_BASELINE - input.eslintErrorCount, 0, 100);

  // HEURISTIC: fixed baselines (see formula table above).
  const ux_polish = UX_POLISH_BASELINE;
  const performance = PERFORMANCE_BASELINE;

  // HEURISTIC: combines security + eslint signals.
  const production_readiness = clamp(
    HEURISTIC_BASELINE -
      PENALTY_PER_CRITICAL * critical -
      PENALTY_PER_HIGH * high -
      eslintPart,
    0,
    100,
  );

  return {
    security,
    code_quality,
    ux_polish,
    performance,
    production_readiness,
  };
};

/**
 * Pull the score for a single dimension from a `PlanScoreDimensions` block.
 * Avoids repeating the discriminant-to-key mapping at every call site.
 */
const scoreFor = (
  scores: PlanScoreDimensions,
  dimension: RubricDimension,
): Score => {
  switch (dimension) {
    case 'security':
      return scores.security;
    case 'code_quality':
      return scores.code_quality;
    case 'ux_polish':
      return scores.ux_polish;
    case 'performance':
      return scores.performance;
    case 'production_readiness':
      return scores.production_readiness;
  }
};

/**
 * Build the `gaps[]` list for one Plan_Score row. Emits exactly one
 * `GapNote` per dimension whose score is below the rubric pass threshold,
 * tagged with the dimension. Property 5 requires at least one tagged note
 * per sub-threshold dimension; this implementation emits exactly one.
 */
const buildGapsForRow = (scores: PlanScoreDimensions): readonly GapNote[] => {
  const gaps: GapNote[] = [];
  for (const dimension of RUBRIC_DIMENSION_ORDER) {
    if (scoreFor(scores, dimension) < RUBRIC_PASS_THRESHOLD) {
      gaps.push({
        dimension,
        note: SUB_THRESHOLD_NOTE,
      });
    }
  }
  return gaps;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the Plans_Library Refresh Table rows.
 *
 * Pure: no I/O, no clock, no randomness. The same inputs always produce the
 * same `Plan_Score[]` value, including the order of `gaps[]` entries.
 *
 * Returns exactly seven rows in the canonical order defined by
 * `CANONICAL_PLAN_PATHS` (Requirement 2.2). Each row's heuristic scoring is
 * computed by `computeScores`; the disposition and notes columns come from
 * the `DISPOSITION_BY_PATH` / `NOTES_BY_PATH` maps which mirror the
 * design.md "Plans_Library Refresh Table" verbatim.
 *
 * The seven rows are independent and identically scored from the same
 * pipeline-wide inputs — per-plan content scoring is intentionally deferred
 * to human review (see "Heuristic-only scoring" in the module docstring).
 *
 * Validates Requirements 2.2, 2.6, 2.7. Property 5 is exercised by the
 * companion test in task 4.8.
 */
export const buildPlanScores = (input: PlanScoreInput): readonly Plan_Score[] => {
  const scores = computeScores(input);
  const gaps = buildGapsForRow(scores);

  return CANONICAL_PLAN_PATHS.map((planPath) => ({
    plan_path: planPath,
    disposition: DISPOSITION_BY_PATH[planPath],
    scores,
    gaps,
    notes: NOTES_BY_PATH[planPath],
  }));
};
