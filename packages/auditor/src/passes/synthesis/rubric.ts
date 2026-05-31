/**
 * Pass 3 — Synthesis: Severity_Definitions and Scoring_Rubric builders.
 *
 * Pure (no I/O) factories that emit the cross-cutting reference tables for the
 * `Audit_Report`. The Scoring_Rubric is consumed by every Plan_Score row and
 * by the Production_Readiness_Thresholds checklist; the Severity_Definitions
 * table normalizes severity language across the Security_Findings_List.
 *
 * Mirrors:
 *   - design.md "Scoring_Rubric section" — five 0..100 bands per dimension,
 *     pass threshold 85, exactly five rubric dimensions.
 *   - design.md "Severity_Definitions section" — exactly four rows
 *     (Critical / High / Medium / Low) with definition text copied verbatim.
 *
 * Validates Requirements 2.1 (Scoring_Rubric shape) and 6.2 (Severity_Definitions
 * cardinality + content). Property 15 (band partition) is exercised by the
 * companion test in task 4.2.
 */

import type {
  RubricDimension,
  RubricDimensionSpec,
  ScoringBand,
  ScoringRubric,
  Severity_Definition,
  SeverityDefinitionList,
} from '../../models';

// ---------------------------------------------------------------------------
// Bands — shared across every dimension. The five labels in this tuple are
// declared in ascending range order (Critical → Excellent) so the array also
// serves as the canonical ordering used by Property 15 (band partition).
// ---------------------------------------------------------------------------

/** Pass threshold for every rubric dimension, fixed by design at 85. */
export const RUBRIC_PASS_THRESHOLD = 85 as const;

/**
 * The five contiguous bands that partition 0..100 in every rubric dimension.
 * Encoded as a 5-tuple to match `RubricDimensionSpec.bands` exactly.
 */
const SHARED_BANDS: readonly [ScoringBand, ScoringBand, ScoringBand, ScoringBand, ScoringBand] =
  Object.freeze([
    Object.freeze({
      label: 'Critical',
      min: 0,
      max: 39,
      meaning: 'Blocking; do-not-ship.',
    }),
    Object.freeze({
      label: 'Weak',
      min: 40,
      max: 59,
      meaning: 'Not production ready; actionable plan required.',
    }),
    Object.freeze({
      label: 'Adequate',
      min: 60,
      max: 74,
      meaning: 'Acceptable for staging; gaps must be tracked.',
    }),
    Object.freeze({
      label: 'Strong',
      min: 75,
      max: 89,
      meaning: 'Production ready with minor follow-ups.',
    }),
    Object.freeze({
      label: 'Excellent',
      min: 90,
      max: 100,
      meaning: 'Production ready in this dimension; no follow-up needed.',
    }),
  ]) as readonly [ScoringBand, ScoringBand, ScoringBand, ScoringBand, ScoringBand];

/**
 * The five rubric dimensions, in the canonical order used by every renderer
 * and threshold row. Encoded as a 5-tuple so cardinality is enforced at the
 * type level (matches `ScoringRubric.dimensions`).
 */
const RUBRIC_DIMENSIONS: readonly [
  RubricDimension,
  RubricDimension,
  RubricDimension,
  RubricDimension,
  RubricDimension,
] = ['security', 'code_quality', 'ux_polish', 'performance', 'production_readiness'] as const;

/**
 * Build a `RubricDimensionSpec` for a single dimension. Each dimension shares
 * the same band shape and pass threshold, so this is just a typed factory
 * that re-uses `SHARED_BANDS`.
 */
const buildDimensionSpec = (dimension: RubricDimension): RubricDimensionSpec =>
  Object.freeze({
    dimension,
    bands: SHARED_BANDS,
    pass_threshold: RUBRIC_PASS_THRESHOLD,
  });

// ---------------------------------------------------------------------------
// Scoring_Rubric — five-dimension factory.
// ---------------------------------------------------------------------------

/**
 * Cached, deeply-frozen Scoring_Rubric instance. The factory below returns
 * this same object on every call so equality checks across the audit pipeline
 * are stable and the Property 15 test exercises a single canonical value.
 */
const SCORING_RUBRIC: ScoringRubric = Object.freeze({
  dimensions: Object.freeze([
    buildDimensionSpec(RUBRIC_DIMENSIONS[0]),
    buildDimensionSpec(RUBRIC_DIMENSIONS[1]),
    buildDimensionSpec(RUBRIC_DIMENSIONS[2]),
    buildDimensionSpec(RUBRIC_DIMENSIONS[3]),
    buildDimensionSpec(RUBRIC_DIMENSIONS[4]),
  ]) as readonly [
    RubricDimensionSpec,
    RubricDimensionSpec,
    RubricDimensionSpec,
    RubricDimensionSpec,
    RubricDimensionSpec,
  ],
});

/**
 * Return the canonical five-dimension Scoring_Rubric.
 *
 * Pure: no I/O, no clock, no randomness. The return value is deeply frozen,
 * so callers can safely treat it as a singleton.
 *
 * Validates Requirement 2.1: five dimensions, five contiguous bands per
 * dimension covering 0..100, explicit pass threshold (85) on every dimension.
 */
export const buildScoringRubric = (): ScoringRubric => SCORING_RUBRIC;

// ---------------------------------------------------------------------------
// Severity_Definitions — four-row factory.
// ---------------------------------------------------------------------------

/**
 * Severity_Definition rows in the canonical order Critical → High → Medium →
 * Low. Definition text is copied verbatim from design.md "Severity_Definitions
 * section"; example_findings carry placeholder VULN ids drawn from the same
 * definitions (the synthesizer in task 4.3 will replace these placeholders
 * with real ids once the Security_Findings_List is built).
 */
const SEVERITY_DEFINITIONS: SeverityDefinitionList = Object.freeze([
  Object.freeze({
    level: 'Critical',
    definition:
      'Plaintext secret exposure; private-key or mnemonic mishandling; signing flow that can be triggered by an unauthenticated request; production data deletion path with no auth.',
    example_findings: Object.freeze([
      'See VULN-XXXX (plaintext secret exposure in committed file)',
      'See VULN-XXXX (private-key or mnemonic logged or persisted outside secure store)',
      'See VULN-XXXX (signing flow reachable without authentication)',
    ]) as readonly string[],
  }) as Severity_Definition,
  Object.freeze({
    level: 'High',
    definition:
      'Missing webhook signature or timestamp window; missing auth boundary on merchant/invoice/admin route; client-bundle exposure of RPC credentials; pnpm audit advisory marked High or Critical.',
    example_findings: Object.freeze([
      'See VULN-XXXX (missing webhook signature or 5-minute timestamp window)',
      'See VULN-XXXX (missing auth boundary on merchant/invoice/admin route)',
      'See VULN-XXXX (RPC credential exposed in client bundle)',
    ]) as readonly string[],
  }) as Severity_Definition,
  Object.freeze({
    level: 'Medium',
    definition:
      'Missing input schema validation; permissive CORS; missing rate limiting; weak JWT lifetime or refresh policy.',
    example_findings: Object.freeze([
      'See VULN-XXXX (route handler without Zod/Joi/Yup schema validation)',
      'See VULN-XXXX (permissive CORS allow-list)',
      'See VULN-XXXX (missing rate limiting on public endpoint)',
    ]) as readonly string[],
  }) as Severity_Definition,
  Object.freeze({
    level: 'Low',
    definition:
      'Logging hygiene gaps that do not include secret values; deprecated API usage; non-blocking dependency advisories.',
    example_findings: Object.freeze([
      'See VULN-XXXX (logging hygiene gap with no secret values exposed)',
      'See VULN-XXXX (deprecated API usage)',
      'See VULN-XXXX (non-blocking dependency advisory)',
    ]) as readonly string[],
  }) as Severity_Definition,
]) as SeverityDefinitionList;

/**
 * Return the canonical four-row Severity_Definitions list, ordered
 * Critical → High → Medium → Low.
 *
 * Pure: no I/O. The return value is deeply frozen, so callers can treat it
 * as a singleton.
 *
 * Validates Requirement 6.2: exactly four rows, one per `Severity` level,
 * with definitions matching design.md "Severity_Definitions section".
 */
export const buildSeverityDefinitions = (): SeverityDefinitionList => SEVERITY_DEFINITIONS;


// ---------------------------------------------------------------------------
// Scoring_Rubric validator — Property 15 helper.
//
// Property 15 (Scoring_Rubric bands cover 0-100 contiguously across five
// dimensions) is exercised by `rubric.property.test.ts`. The test treats
// `buildScoringRubric()` as the canonical positive case and feeds corrupted
// variants through this same validator to assert it rejects them.
//
// The validator is intentionally structural so a `fast-check` arbitrary can
// hand it `unknown` payloads (overlapping bands, missing dimensions, off-range
// thresholds) without TypeScript complaining at the call site.
// ---------------------------------------------------------------------------

/**
 * The five dimension names required on every `ScoringRubric` per Requirement
 * 2.1. Frozen tuple so the test arbitraries and the validator share one
 * source of truth.
 */
export const REQUIRED_RUBRIC_DIMENSIONS: readonly RubricDimension[] = Object.freeze([
  'security',
  'code_quality',
  'ux_polish',
  'performance',
  'production_readiness',
]) as readonly RubricDimension[];

/** Materialized set lookup over `REQUIRED_RUBRIC_DIMENSIONS`. */
const REQUIRED_RUBRIC_DIMENSION_SET: ReadonlySet<string> = new Set<string>(
  REQUIRED_RUBRIC_DIMENSIONS,
);

/**
 * Result of `validateScoringRubric`. `ok: true` means every Property 15
 * clause holds; `ok: false` carries a short, human-readable reason that
 * the property test surfaces in counter-example output.
 */
export type ScoringRubricValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Type guard for non-negative integers in the inclusive range 0..100. */
const isScoreInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;

/**
 * Validate a candidate `Scoring_Rubric` against Property 15:
 *
 *   1. `dimensions` is an array of length exactly 5.
 *   2. The set of `dimension.dimension` names equals the canonical five
 *      (security, code_quality, ux_polish, performance, production_readiness).
 *   3. Each dimension has `pass_threshold` ∈ 0..100 (integer).
 *   4. Each dimension has `bands.length === 5`.
 *   5. For each dimension, after sorting bands ascending by `min`:
 *        - `bands[0].min === 0`
 *        - `bands[4].max === 100`
 *        - `bands[i+1].min === bands[i].max + 1` for `i` in 0..3
 *      i.e., the bands partition 0..100 with no gaps and no overlaps.
 *
 * Accepts `unknown` so corrupted variants from the property test can be
 * routed through the same code path the production rubric exercises.
 *
 * @param rubric - Candidate Scoring_Rubric (typed `unknown` to allow corrupted
 *                 variants from the property test).
 * @returns `{ ok: true }` when every clause holds; `{ ok: false, reason }`
 *          otherwise. The reason text is short and references the failing
 *          clause so counter-examples are self-explanatory.
 */
export function validateScoringRubric(rubric: unknown): ScoringRubricValidation {
  if (typeof rubric !== 'object' || rubric === null) {
    return { ok: false, reason: 'rubric must be an object' };
  }

  const dimensions = (rubric as { dimensions?: unknown }).dimensions;
  if (!Array.isArray(dimensions)) {
    return { ok: false, reason: 'rubric.dimensions must be an array' };
  }
  if (dimensions.length !== 5) {
    return {
      ok: false,
      reason: `rubric.dimensions must have length 5 (got ${dimensions.length})`,
    };
  }

  const seen = new Set<string>();
  for (let i = 0; i < dimensions.length; i += 1) {
    const dim: unknown = dimensions[i];
    if (typeof dim !== 'object' || dim === null) {
      return { ok: false, reason: `dimensions[${i}] must be an object` };
    }

    const name = (dim as { dimension?: unknown }).dimension;
    if (typeof name !== 'string' || !REQUIRED_RUBRIC_DIMENSION_SET.has(name)) {
      return {
        ok: false,
        reason: `dimensions[${i}].dimension must be one of ${REQUIRED_RUBRIC_DIMENSIONS.join(', ')}`,
      };
    }
    if (seen.has(name)) {
      return { ok: false, reason: `duplicate dimension name: ${name}` };
    }
    seen.add(name);

    const passThreshold = (dim as { pass_threshold?: unknown }).pass_threshold;
    if (!isScoreInt(passThreshold)) {
      return {
        ok: false,
        reason: `dimensions[${i}].pass_threshold must be an integer in 0..100`,
      };
    }

    const bands = (dim as { bands?: unknown }).bands;
    if (!Array.isArray(bands)) {
      return { ok: false, reason: `dimensions[${i}].bands must be an array` };
    }
    if (bands.length !== 5) {
      return {
        ok: false,
        reason: `dimensions[${i}].bands must have length 5 (got ${bands.length})`,
      };
    }

    // Validate each band has integer min/max in 0..100 with min <= max,
    // then sort ascending and assert the contiguous partition.
    const ranges: Array<{ min: number; max: number }> = [];
    for (let b = 0; b < bands.length; b += 1) {
      const band: unknown = bands[b];
      if (typeof band !== 'object' || band === null) {
        return { ok: false, reason: `dimensions[${i}].bands[${b}] must be an object` };
      }
      const min = (band as { min?: unknown }).min;
      const max = (band as { max?: unknown }).max;
      if (!isScoreInt(min)) {
        return {
          ok: false,
          reason: `dimensions[${i}].bands[${b}].min must be an integer in 0..100`,
        };
      }
      if (!isScoreInt(max)) {
        return {
          ok: false,
          reason: `dimensions[${i}].bands[${b}].max must be an integer in 0..100`,
        };
      }
      if (min > max) {
        return {
          ok: false,
          reason: `dimensions[${i}].bands[${b}] has min > max (${min} > ${max})`,
        };
      }
      ranges.push({ min, max });
    }

    ranges.sort((a, b) => a.min - b.min);

    if (ranges[0]!.min !== 0) {
      return {
        ok: false,
        reason: `dimensions[${i}] lowest band must start at 0 (got ${ranges[0]!.min})`,
      };
    }
    if (ranges[4]!.max !== 100) {
      return {
        ok: false,
        reason: `dimensions[${i}] highest band must end at 100 (got ${ranges[4]!.max})`,
      };
    }
    for (let r = 0; r < ranges.length - 1; r += 1) {
      const current = ranges[r]!;
      const next = ranges[r + 1]!;
      if (next.min !== current.max + 1) {
        return {
          ok: false,
          reason:
            `dimensions[${i}] band partition has gap or overlap between ` +
            `[${current.min}..${current.max}] and [${next.min}..${next.max}]`,
        };
      }
    }
  }

  // `seen.size === 5` is guaranteed by the length-5 array + duplicate check
  // above, but the explicit assertion here keeps the validator self-evident.
  if (seen.size !== 5) {
    return {
      ok: false,
      reason: `rubric must declare all five canonical dimensions (got ${seen.size})`,
    };
  }

  return { ok: true };
}
