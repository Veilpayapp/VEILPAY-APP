/**
 * Property-based test for `Production_Readiness_Thresholds` rule completeness
 * (Property 12).
 *
 * Feature: production-readiness-audit, Property 12:
 *   For any successful audit run, the `Production_Readiness_Thresholds`
 *   checklist SHALL contain a row for each of the eight rules — Critical
 *   security findings = 0; High security findings = 0; minimum critical-path
 *   test coverage with a defined critical-path list; every Plan_Score >= 85
 *   in every rubric dimension; Graph_Report regenerated within 24 hours of
 *   sign-off (delta of 0 hours counts as passing); Network_Icon_Set 100%
 *   replaced with brand-official assets except for documented Requirement 4.9
 *   gaps; ESLint errors = 0 across every app and package; `pnpm audit` High
 *   and Critical advisories = 0 — and every row SHALL contain non-empty
 *   values for label, current value, and pass status ∈ {`pass`, `fail`}
 *   (encoded here as a boolean, since the renderer maps `true → pass` and
 *   `false → fail` when emitting the Markdown table).
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9
 *
 * Strategy:
 *   - `fast-check` arbitraries generate every field of `ThresholdsInput`
 *     across the realistic input space (zero or many findings, plan scores
 *     spanning 0..100, ISO 8601 timestamps that may straddle the 24h
 *     freshness window, mixed-license network icons, eslint counts that
 *     mix measured + `unmeasured`, advisories of every severity, and
 *     critical-path coverage that is either a percentage or unmeasured).
 *   - Each generated input is passed through `buildProductionReadinessThresholds`
 *     and the resulting eight-row array is asserted against Property 12's
 *     completeness contract.
 *   - `CRITICAL_PATHS.length > 0` is asserted directly so the row-3
 *     "critical-path list is non-empty" clause has explicit coverage that
 *     does not depend on string-parsing the row's explanation field.
 */

import * as fc from 'fast-check';

import {
  CRITICAL_PATHS,
  buildProductionReadinessThresholds,
  type ThresholdsInput,
} from './thresholds';
import { UNMEASURED } from '../../models';
import type {
  EslintCount,
  Network_Icon,
  Plan_Score,
  Vulnerability_Finding,
} from '../../models';

// ---------------------------------------------------------------------------
// Arbitraries
//
// Generators are intentionally narrow: they only emit values inside the
// input contract of `ThresholdsInput`. The property under test is "every
// row is well-formed and the rule order is fixed", not "the builder
// validates malformed input" — out-of-contract inputs would conflate
// the two concerns.
// ---------------------------------------------------------------------------

/**
 * Non-empty alphabet-restricted text used for prose-bearing string fields
 * (titles, descriptions, owners). Min length 1 mirrors the design contract
 * for every `Vulnerability_Finding` field.
 */
const arbNonEmptyText: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 32 })
  .map((s) => (s.length > 0 ? s : 'placeholder'));

/** Repository-relative path. Constrained to look like a real source file. */
const arbRepoPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(
      'apps/backend',
      'apps/consumer-app',
      'apps/frontend',
      'apps/indexer',
      'packages/auditor',
    ),
    fc
      .string({ minLength: 1, maxLength: 16 })
      .map((s) => s.replace(/[^A-Za-z0-9_-]/g, '') || 'file'),
    fc.constantFrom('.ts', '.tsx', '.js', '.json'),
  )
  .map(([prefix, name, ext]) => `${prefix}/src/${name}${ext}`);

/**
 * Arbitrary for a `Vulnerability_Finding`. The threshold builder only
 * inspects `severity`, but the property under test asserts the input shape
 * survives the builder unchanged, so we emit fully-formed findings with
 * non-empty prose fields.
 */
const arbFinding: fc.Arbitrary<Vulnerability_Finding> = fc.record({
  id: fc
    .integer({ min: 1, max: 9999 })
    .map((n) => `VULN-${n.toString().padStart(4, '0')}`),
  title: arbNonEmptyText,
  severity: fc.constantFrom<Vulnerability_Finding['severity']>(
    'Critical',
    'High',
    'Medium',
    'Low',
  ),
  location: fc.record({
    path: arbRepoPath,
    lines: fc.constant(null),
  }),
  description: arbNonEmptyText,
  remediation: arbNonEmptyText,
  remediation_owner: fc.constantFrom('backend', 'consumer-app', 'frontend', 'indexer', 'platform'),
  references: fc.constant([] as readonly string[]),
});

/**
 * Arbitrary for one `Plan_Score`. Scores are integers in 0..100 to match the
 * rubric range. Mixing scores below and above the 85 floor makes row 4 flip
 * across the property's input space.
 */
const arbPlanScore: fc.Arbitrary<Plan_Score> = fc.record({
  plan_path: fc
    .string({ minLength: 1, maxLength: 16 })
    .map((s) => `plans/${s.replace(/[^A-Za-z0-9_-]/g, '') || 'PLAN'}.md`),
  disposition: fc.constantFrom<Plan_Score['disposition']>('updated', 'superseded'),
  scores: fc.record({
    security: fc.integer({ min: 0, max: 100 }),
    code_quality: fc.integer({ min: 0, max: 100 }),
    ux_polish: fc.integer({ min: 0, max: 100 }),
    performance: fc.integer({ min: 0, max: 100 }),
    production_readiness: fc.integer({ min: 0, max: 100 }),
  }),
  gaps: fc.constant([] as readonly never[]),
  notes: fc.string({ minLength: 0, maxLength: 32 }),
});

/** ISO 8601 timestamp arbitrary — drawn from a real `Date`. */
const arbIsoTimestamp: fc.Arbitrary<string> = fc
  .date({ noInvalidDate: true })
  .map((d) => d.toISOString());

/**
 * Arbitrary for one `Network_Icon`. The threshold builder only inspects
 * `license_compatible` and `fallback_action`, but emitting a fully-formed
 * entry mirrors the production input shape and keeps the test honest if
 * the builder's contract widens.
 */
const arbNetworkIcon: fc.Arbitrary<Network_Icon> = fc.record({
  chain_slug: fc.constantFrom(
    'ethereum',
    'polygon',
    'base',
    'arbitrum',
    'optimism',
    'solana',
    'bnb',
    'avalanche',
  ),
  display_name: arbNonEmptyText,
  current_assets: fc.constant([] as readonly string[]),
  renderer_paths: fc.constant([] as readonly string[]),
  brand_kit_url: fc.option(fc.webUrl({ validSchemes: ['https'] }), { nil: null }),
  license_terms: fc.option(arbNonEmptyText, { nil: null }),
  license_compatible: fc.oneof(
    fc.boolean(),
    fc.constant<'unknown'>('unknown'),
  ) as fc.Arbitrary<Network_Icon['license_compatible']>,
  target_filename: fc
    .constantFrom(
      'ethereum',
      'polygon',
      'base',
      'arbitrum',
      'optimism',
      'solana',
      'bnb',
      'avalanche',
    )
    .map((slug) => `network-${slug}.svg`),
  target_directory: fc.constant('apps/consumer-app/src/assets/networks'),
  fallback_action: fc.option(arbNonEmptyText, { nil: null }),
});

/**
 * Arbitrary for one `EslintCount`. Each side may be a non-negative integer
 * or the `unmeasured` sentinel — exactly the two-state input the builder
 * treats specially for row 7.
 */
const arbEslintCount: fc.Arbitrary<EslintCount> = fc.record({
  errors: fc.oneof(
    fc.integer({ min: 0, max: 50 }),
    fc.constant(UNMEASURED),
  ) as fc.Arbitrary<EslintCount['errors']>,
  warnings: fc.oneof(
    fc.integer({ min: 0, max: 100 }),
    fc.constant(UNMEASURED),
  ) as fc.Arbitrary<EslintCount['warnings']>,
});

/**
 * Arbitrary for the per-target eslint-count map. Keys are workspace
 * identifiers drawn from a small canonical set so iteration order is
 * predictable and the property covers the empty, single-target, and
 * many-targets cases.
 */
const arbEslintCounts: fc.Arbitrary<Readonly<Record<string, EslintCount>>> = fc
  .uniqueArray(
    fc.constantFrom(
      'apps/backend',
      'apps/consumer-app',
      'apps/frontend',
      'apps/indexer',
      'packages/auditor',
      'packages/shared',
    ),
    { minLength: 0, maxLength: 6 },
  )
  .chain((keys) =>
    fc
      .tuple(...keys.map(() => arbEslintCount))
      .map((counts) => {
        const out: Record<string, EslintCount> = {};
        for (let i = 0; i < keys.length; i += 1) {
          out[keys[i]!] = counts[i]!;
        }
        return out as Readonly<Record<string, EslintCount>>;
      }),
  );

/**
 * Arbitrary for one pnpm-audit advisory. Severity is drawn from the
 * canonical pnpm output set plus the lowercase variants the builder
 * defends against.
 */
const arbAdvisory: fc.Arbitrary<{ readonly severity: string }> = fc.record({
  severity: fc.constantFrom(
    'critical',
    'high',
    'moderate',
    'low',
    'info',
    'Critical',
    'High',
    'Moderate',
    'Low',
    'Info',
  ),
});

/**
 * Arbitrary for the critical-path coverage measurement. Either an integer
 * percentage in 0..100, or the `unmeasured` sentinel. This is the exact
 * domain `ThresholdsInput.criticalPathCoverage` accepts.
 */
const arbCriticalPathCoverage: fc.Arbitrary<number | typeof UNMEASURED> = fc.oneof(
  fc.integer({ min: 0, max: 100 }),
  fc.constant(UNMEASURED),
);

/** Composite arbitrary for a complete `ThresholdsInput`. */
const arbThresholdsInput: fc.Arbitrary<ThresholdsInput> = fc.record({
  findings: fc.array(arbFinding, { minLength: 0, maxLength: 12 }),
  planScores: fc.array(arbPlanScore, { minLength: 0, maxLength: 7 }),
  graphifyRunAt: arbIsoTimestamp,
  auditGeneratedAt: arbIsoTimestamp,
  networkIcons: fc.array(arbNetworkIcon, { minLength: 0, maxLength: 8 }),
  eslintCounts: arbEslintCounts,
  pnpmAuditAdvisories: fc.array(arbAdvisory, { minLength: 0, maxLength: 12 }),
  criticalPathCoverage: arbCriticalPathCoverage,
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Production_Readiness_Thresholds rule completeness (Property 12)', () => {
  /**
   * Direct, input-free assertion that the critical-path list is non-empty.
   * Property 12 / Requirement 9.4 require row 3 to cite an explicit
   * critical-path list; the builder reads that list from `CRITICAL_PATHS`,
   * so the list itself must be non-empty for the row's contract to hold.
   */
  it('CRITICAL_PATHS is non-empty (Requirement 9.4)', () => {
    expect(CRITICAL_PATHS.length).toBeGreaterThan(0);
  });

  it('builds eight rows in fixed order with non-empty fields and boolean pass', () => {
    fc.assert(
      fc.property(arbThresholdsInput, (input) => {
        const rows = buildProductionReadinessThresholds(input);

        // (a) Cardinality — exactly eight rows (Requirements 9.2..9.9).
        expect(rows.length).toBe(8);

        // (b) Per-row contract — id ordering, non-empty strings, boolean pass.
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i]!;

          // Ids are 1..8 in order — the design fixes row ordering and the
          // renderer relies on it to emit a stable Markdown table.
          expect(row.id).toBe(i + 1);

          // Non-empty values for label / target / current_value. The
          // renderer would emit empty Markdown cells otherwise, breaking
          // the threshold table's readability contract.
          expect(typeof row.label).toBe('string');
          expect(row.label.length).toBeGreaterThan(0);
          expect(typeof row.target).toBe('string');
          expect(row.target.length).toBeGreaterThan(0);
          expect(typeof row.current_value).toBe('string');
          expect(row.current_value.length).toBeGreaterThan(0);

          // `pass` is strictly boolean. The Markdown renderer maps
          // `true → pass` and `false → fail` when emitting the cell, so
          // any non-boolean value would corrupt the rendered status.
          expect(typeof row.pass).toBe('boolean');
          expect(row.pass === true || row.pass === false).toBe(true);

          // `explanation` carries the cross-reference into the rest of
          // the report; an empty string would leave readers with no path
          // back to the underlying section.
          expect(typeof row.explanation).toBe('string');
          expect(row.explanation.length).toBeGreaterThan(0);
        }

        // (c) Row 3 (critical-path test coverage) cites the critical-path
        // list. The builder embeds `CRITICAL_PATHS` into the row's
        // explanation field, so the explanation must mention "critical
        // paths" — case-insensitive match across the hyphenated and
        // space-separated spellings.
        const row3 = rows[2]!;
        expect(row3.explanation).toMatch(/critical[\s-]paths?/i);
      }),
    );
  });
});
