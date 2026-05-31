/**
 * Property-based test for `Code_Quality_Findings` completeness (Property 10).
 *
 * Feature: production-readiness-audit, Property 10:
 *   For any app or package in the workspace, the `Code_Quality_Findings_List`
 *   SHALL record:
 *     - a TypeScript strict-mode coverage percentage in 0..100 (Requirement 7.2);
 *     - an ESLint error count and warning count as non-negative integers (Requirement 7.3);
 *     - four test coverage percentages (statements, branches, functions, lines)
 *       in 0..100 (Requirement 7.5);
 *     - exactly one root-script triage entry per file matching `tmp_*.js`,
 *       `autofix.js`, or `audit.js` at the workspace root, each with a
 *       classification ∈ {`keep`, `archive`, `remove`} and a non-empty
 *       justification (Requirement 7.4);
 *     - exactly ten complexity hotspots, each with a path, function name, and
 *       a positive integer complexity score (Requirement 7.6);
 *     - duplicate clusters whose locations span at least two of
 *       `apps/backend`, `apps/consumer-app`, `apps/frontend`,
 *       `apps/indexer` (Requirement 7.7).
 *
 * Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 *
 * Strategy:
 *   - Generate a `CodeQualityInput` whose fields independently exercise the
 *     `'unmeasured'` sentinel and the in-range numeric distributions.
 *   - Call `buildCodeQualityFindings` and assert every field of the returned
 *     `CodeQualityFindings` respects the Property 10 contract.
 *   - Each numeric range check is paired with the `'unmeasured'` sentinel
 *     check in a single predicate so both legal shapes are covered by the
 *     same assertion.
 *
 * Notes:
 *   - The synthesizer is pure, so a single composite property is enough — no
 *     mocks, no I/O, no clock.
 *   - `rawHotspots` and `rawDuplicates` are independently nullable (the
 *     `'unmeasured'` sentinel) so the generators wire those modes in via
 *     `fc.oneof` to ensure both legs of the synthesizer are exercised.
 *   - Counter-examples for any failed predicate point straight at the
 *     synthesizer's per-field branch, which keeps triage simple.
 */

import * as fc from 'fast-check';

import {
  buildCodeQualityFindings,
  type CodeQualityInput,
  type RawDuplicate,
  type RawHotspot,
} from './codeQuality';
import { UNMEASURED } from '../../models';
import type { CoverageSummary, EslintCount, Score, Unmeasured } from '../../models';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** True when `value` is an integer in the inclusive range 0..100. */
const isPercentInRange = (value: unknown): value is Score =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;

/** True when `value` is the `'unmeasured'` sentinel. */
const isUnmeasured = (value: unknown): value is Unmeasured => value === UNMEASURED;

/** True when `value` is a non-negative integer. */
const isNonNegInt = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Bucket key used to evaluate Requirement 7.7. Returns the canonical
 * `apps/<bucket>` prefix when `path` lives under one of the four apps,
 * otherwise `null`.
 */
const APP_BUCKETS = [
  'apps/backend',
  'apps/consumer-app',
  'apps/frontend',
  'apps/indexer',
] as const;

const bucketFor = (path: string): (typeof APP_BUCKETS)[number] | null => {
  for (const prefix of APP_BUCKETS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return prefix;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A target identifier — `apps/<name>` or `packages/<name>`. */
const targetNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'apps/backend',
    'apps/consumer-app',
    'apps/frontend',
    'apps/indexer',
    'packages/shared',
    'packages/core',
    'packages/types',
    'packages/auditor',
  ),
);

/** Integer percentage in 0..100 OR the `'unmeasured'` sentinel. */
const percentOrUnmeasuredArb: fc.Arbitrary<Score | Unmeasured> = fc.oneof(
  { weight: 9, arbitrary: fc.integer({ min: 0, max: 100 }) },
  { weight: 1, arbitrary: fc.constant(UNMEASURED) },
);

/** Non-negative integer count OR the `'unmeasured'` sentinel. */
const nonNegIntOrUnmeasuredArb: fc.Arbitrary<number | Unmeasured> = fc.oneof(
  { weight: 9, arbitrary: fc.integer({ min: 0, max: 1000 }) },
  { weight: 1, arbitrary: fc.constant(UNMEASURED) },
);

/** Per-target strict-mode coverage map. 0..6 targets covers small + dense cases. */
const strictCoverageArb: fc.Arbitrary<Readonly<Record<string, Score | Unmeasured>>> =
  fc
    .dictionary(targetNameArb, percentOrUnmeasuredArb, { minKeys: 0, maxKeys: 6 })
    .map((d) => Object.freeze({ ...d }));

/** Per-target ESLint count map (errors + warnings). */
const eslintCountsArb: fc.Arbitrary<Readonly<Record<string, EslintCount>>> = fc
  .dictionary(
    targetNameArb,
    fc
      .record({
        errors: nonNegIntOrUnmeasuredArb,
        warnings: nonNegIntOrUnmeasuredArb,
      })
      .map((c) => Object.freeze(c) as EslintCount),
    { minKeys: 0, maxKeys: 6 },
  )
  .map((d) => Object.freeze({ ...d }));

/** Per-target Jest coverage summary (statements + branches + functions + lines). */
const coverageByTargetArb: fc.Arbitrary<Readonly<Record<string, CoverageSummary>>> =
  fc
    .dictionary(
      targetNameArb,
      fc
        .record({
          statements: percentOrUnmeasuredArb,
          branches: percentOrUnmeasuredArb,
          functions: percentOrUnmeasuredArb,
          lines: percentOrUnmeasuredArb,
        })
        .map((c) => Object.freeze(c) as CoverageSummary),
      { minKeys: 0, maxKeys: 6 },
    )
    .map((d) => Object.freeze({ ...d }));

/**
 * Workspace-root scripts. Discovery only emits filenames matching the three
 * patterns Requirement 7.4 calls out, so the generator restricts to that set.
 * Duplicates are intentionally allowed so the synthesizer's "exactly one
 * entry per element" contract is exercised against repeats too.
 */
const rootScriptsArb: fc.Arbitrary<readonly string[]> = fc.array(
  fc.constantFrom('audit.js', 'autofix.js', 'tmp_foo.js', 'tmp_bar.js'),
  { minLength: 0, maxLength: 6 },
);

/** A raw cyclomatic-complexity row with a positive integer score. */
const rawHotspotArb: fc.Arbitrary<RawHotspot> = fc
  .record({
    path: fc
      .tuple(
        fc.constantFrom('apps/backend', 'apps/consumer-app', 'packages/shared'),
        fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/[/\\\s]/g, '_') || 'mod'),
      )
      .map(([base, name]) => `${base}/src/${name}.ts`),
    function: fc.string({ minLength: 1, maxLength: 24 }).map((s) => s || 'fn'),
    // Positive integer 1..100; required by Requirement 7.6.
    score: fc.integer({ min: 1, max: 100 }),
  })
  .map((r) => Object.freeze(r) as RawHotspot);

/**
 * Raw hotspots input: either the `'unmeasured'` sentinel or an array of
 * 0..20 rows. The size range straddles the top-10 cap so both the "fewer
 * than 10 measured" and "more than 10 measured" branches of
 * `buildComplexityHotspots` are exercised.
 */
const rawHotspotsArb: fc.Arbitrary<readonly RawHotspot[] | Unmeasured> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(UNMEASURED) },
  {
    weight: 9,
    arbitrary: fc
      .array(rawHotspotArb, { minLength: 0, maxLength: 20 })
      .map((rows) => Object.freeze([...rows])),
  },
);

/**
 * Path arbitrary for one location inside a duplicate cluster. The path is
 * always anchored at one of the four canonical app prefixes so the
 * cross-app filter has a chance to retain the cluster.
 */
const appLocationArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...APP_BUCKETS),
    fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/[/\\\s]/g, '_') || 'mod'),
  )
  .map(([prefix, mod]) => `${prefix}/src/${mod}.ts`);

/** A raw duplicate cluster — non-empty `locations`, positive `sharedLines`. */
const rawDuplicateArb: fc.Arbitrary<RawDuplicate> = fc
  .record({
    locations: fc
      .array(appLocationArb, { minLength: 2, maxLength: 6 })
      .map((arr) => Object.freeze([...arr])),
    sharedLines: fc.integer({ min: 1, max: 500 }),
  })
  .map((d) => Object.freeze(d) as RawDuplicate);

/** Raw duplicates input — `'unmeasured'` or up to 8 clusters. */
const rawDuplicatesArb: fc.Arbitrary<readonly RawDuplicate[] | Unmeasured> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(UNMEASURED) },
  {
    weight: 9,
    arbitrary: fc
      .array(rawDuplicateArb, { minLength: 0, maxLength: 8 })
      .map((rows) => Object.freeze([...rows])),
  },
);

/** Composite arbitrary for the full `CodeQualityInput`. */
const codeQualityInputArb: fc.Arbitrary<CodeQualityInput> = fc.record({
  strictCoverageByTarget: strictCoverageArb,
  eslintCountsByTarget: eslintCountsArb,
  rootScripts: rootScriptsArb,
  coverageByTarget: coverageByTargetArb,
  rawHotspots: rawHotspotsArb,
  rawDuplicates: rawDuplicatesArb,
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('buildCodeQualityFindings — Property 10 (Code_Quality_Findings completeness)', () => {
  it('respects every Property 10 invariant on arbitrary input', () => {
    fc.assert(
      fc.property(codeQualityInputArb, (input) => {
        const findings = buildCodeQualityFindings(input);

        // ---------- Requirement 7.2: strict-mode coverage ------------------
        for (const [target, value] of Object.entries(findings.ts_strict_coverage)) {
          expect(typeof target).toBe('string');
          expect(isPercentInRange(value) || isUnmeasured(value)).toBe(true);
        }

        // ---------- Requirement 7.3: ESLint counts -------------------------
        for (const [target, count] of Object.entries(findings.eslint_counts)) {
          expect(typeof target).toBe('string');
          expect(isNonNegInt(count.errors) || isUnmeasured(count.errors)).toBe(true);
          expect(isNonNegInt(count.warnings) || isUnmeasured(count.warnings)).toBe(true);
        }

        // ---------- Requirement 7.5: four test coverage percentages --------
        for (const [target, summary] of Object.entries(findings.test_coverage)) {
          expect(typeof target).toBe('string');
          for (const metric of ['statements', 'branches', 'functions', 'lines'] as const) {
            const v = summary[metric];
            expect(isPercentInRange(v) || isUnmeasured(v)).toBe(true);
          }
        }

        // ---------- Requirement 7.4: root-script triage --------------------
        // Exactly one entry per element of rootScripts (preserving order),
        // with a recognized classification and a non-empty justification.
        expect(findings.root_script_triage.length).toBe(input.rootScripts.length);
        for (let i = 0; i < input.rootScripts.length; i++) {
          const entry = findings.root_script_triage[i]!;
          expect(entry.path).toBe(input.rootScripts[i]);
          expect(['keep', 'archive', 'remove']).toContain(entry.classification);
          expect(typeof entry.justification).toBe('string');
          expect(entry.justification.length).toBeGreaterThan(0);
        }

        // ---------- Requirement 7.6: exactly ten complexity hotspots -------
        expect(findings.complexity_hotspots.length).toBe(10);

        const measuredCount =
          input.rawHotspots === UNMEASURED
            ? 0
            : Math.min(input.rawHotspots.length, 10);

        for (let rank = 1; rank <= 10; rank++) {
          const row = findings.complexity_hotspots[rank - 1]!;
          expect(row.rank).toBe(rank);

          if (rank <= measuredCount) {
            // Real entries — score must be a positive integer (Property 10
            // explicitly requires "positive integer complexity score").
            expect(typeof row.path).toBe('string');
            expect(row.path.length).toBeGreaterThan(0);
            expect(typeof row.function).toBe('string');
            expect(row.function.length).toBeGreaterThan(0);
            expect(Number.isInteger(row.score)).toBe(true);
            expect(row.score).toBeGreaterThan(0);
          } else {
            // Padded sentinel rows — `path === 'unmeasured'`,
            // `function === 'unmeasured'` per the synthesizer contract.
            expect(row.path).toBe(UNMEASURED);
            expect(row.function).toBe(UNMEASURED);
          }
        }

        // ---------- Requirement 7.7: cross-app duplicate clusters ----------
        for (const cluster of findings.duplicate_clusters) {
          expect(cluster.locations.length).toBeGreaterThanOrEqual(2);
          const buckets = new Set<string>();
          for (const loc of cluster.locations) {
            const bucket = bucketFor(loc);
            if (bucket !== null) {
              buckets.add(bucket);
            }
          }
          // Property 10: every retained cluster spans ≥ 2 of the four apps.
          expect(buckets.size).toBeGreaterThanOrEqual(2);

          // cluster_id and recommendation are emitted as non-empty strings
          // by the synthesizer; verifying here is cheap and pinpoints
          // schema regressions to this property test.
          expect(typeof cluster.cluster_id).toBe('string');
          expect(cluster.cluster_id.length).toBeGreaterThan(0);
          expect(typeof cluster.recommendation).toBe('string');
          expect(cluster.recommendation.length).toBeGreaterThan(0);
          expect(Number.isInteger(cluster.shared_lines)).toBe(true);
        }
      }),
    );
  });
});
