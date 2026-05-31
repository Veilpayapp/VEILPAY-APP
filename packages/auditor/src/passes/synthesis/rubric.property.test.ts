/**
 * Property-based test for `Scoring_Rubric` band partition (Property 15).
 *
 * Feature: production-readiness-audit, Property 15:
 *   The `Scoring_Rubric` defined inside the Audit_Report contains exactly
 *   five rubric dimensions; each dimension's bands, when sorted ascending,
 *   partition the inclusive range 0..100 with no gaps and no overlaps; and
 *   each dimension declares an explicit pass threshold (integer in 0..100).
 *
 * Validates: Requirements 2.1
 *
 * Strategy:
 *   - Property 1 (positive): the canonical `buildScoringRubric()` value is
 *     accepted by `validateScoringRubric` on every run. The property is
 *     trivially true for the singleton, but threading it through the
 *     validator exercises the same code path the corruption arm uses, and
 *     guards against future refactors that change the canonical shape
 *     without updating the validator.
 *   - Property 2 (negative): a `fast-check` arbitrary builds rubrics that
 *     deviate from Property 15 in one of four ways — overlapping ranges,
 *     gaps, missing dimensions, off-range pass thresholds — and asserts
 *     `validateScoringRubric` rejects every variant.
 *
 * Notes:
 *   - The corruption arm uses `fc.tuple` to compose the deviation (which
 *     dimension to corrupt, which kind of corruption, the bad value) per
 *     the task notes.
 *   - Default fast-check run count (100) is sufficient — the input space
 *     is small and the validator is deterministic.
 */

import * as fc from 'fast-check';

import {
  REQUIRED_RUBRIC_DIMENSIONS,
  buildScoringRubric,
  validateScoringRubric,
} from './rubric';
import type { ScoringRubric } from '../../models';

// ---------------------------------------------------------------------------
// Positive property — canonical rubric is always accepted.
// ---------------------------------------------------------------------------

describe('Scoring_Rubric band partition (Property 15)', () => {
  it('buildScoringRubric() always returns a value validateScoringRubric accepts', () => {
    // The canonical rubric is a frozen singleton, so the property body
    // does not depend on a generator. Wrapping it in fc.assert keeps the
    // test shape uniform with the corruption arm and makes the assertion
    // resilient if the factory ever becomes input-driven.
    fc.assert(
      fc.property(fc.constant(null), () => {
        const rubric = buildScoringRubric();
        const result = validateScoringRubric(rubric);
        expect(result).toEqual({ ok: true });
      }),
    );
  });

  it('canonical rubric declares exactly five dimensions with pass_threshold ∈ 0..100', () => {
    // Spot-checks the structural invariants the validator relies on so a
    // corruption test failing later is unambiguously the validator and not
    // the canonical value.
    const rubric = buildScoringRubric();
    expect(rubric.dimensions.length).toBe(5);
    const names = rubric.dimensions.map((d) => d.dimension).sort();
    expect(names).toEqual([...REQUIRED_RUBRIC_DIMENSIONS].sort());
    for (const dim of rubric.dimensions) {
      expect(dim.pass_threshold).toBeGreaterThanOrEqual(0);
      expect(dim.pass_threshold).toBeLessThanOrEqual(100);
      expect(Number.isInteger(dim.pass_threshold)).toBe(true);
      expect(dim.bands.length).toBe(5);
    }
  });

  // -------------------------------------------------------------------------
  // Negative property — corrupted variants are always rejected.
  //
  // The corruption arbitrary picks one of four mutually exclusive modes:
  //
  //   - 'overlap': two adjacent bands overlap by 1.
  //   - 'gap'    : two adjacent bands leave a 1-point gap.
  //   - 'missing': one of the five required dimension names is dropped or
  //                replaced with a non-canonical name.
  //   - 'threshold': one dimension's pass_threshold is set outside 0..100.
  //
  // Each mode produces a value that violates Property 15 in exactly one
  // way, which keeps counter-examples easy to triage.
  // -------------------------------------------------------------------------
  describe('rejects corrupted rubrics', () => {
    /**
     * Deep-clone the canonical rubric into a mutable shape we can corrupt.
     * The factory returns a frozen singleton, so callers cannot mutate it
     * directly; this helper produces a writable copy that mirrors the
     * canonical structure exactly.
     */
    const cloneRubric = (): {
      dimensions: Array<{
        dimension: string;
        pass_threshold: number;
        bands: Array<{ label: string; min: number; max: number; meaning: string }>;
      }>;
    } => {
      const canonical = buildScoringRubric();
      return {
        dimensions: canonical.dimensions.map((d) => ({
          dimension: d.dimension as string,
          pass_threshold: d.pass_threshold,
          bands: d.bands.map((b) => ({
            label: b.label as string,
            min: b.min,
            max: b.max,
            meaning: b.meaning,
          })),
        })),
      };
    };

    /** Corruption modes covered by the negative property. */
    const arbCorruption = fc.constantFrom<'overlap' | 'gap' | 'missing' | 'threshold'>(
      'overlap',
      'gap',
      'missing',
      'threshold',
    );

    /** Index of the dimension to corrupt (0..4). */
    const arbDimensionIndex = fc.integer({ min: 0, max: 4 });

    /** Index of the band-pair to corrupt (0..3 → pair (i, i+1)). */
    const arbBandPairIndex = fc.integer({ min: 0, max: 3 });

    /**
     * Off-range threshold values. Picks negatives, values > 100, and a
     * non-integer to cover the three failure modes the validator checks.
     */
    const arbBadThreshold = fc.oneof(
      fc.integer({ min: -1000, max: -1 }),
      fc.integer({ min: 101, max: 1000 }),
      fc.double({ min: 0, max: 100, noNaN: true }).filter((n) => !Number.isInteger(n)),
    );

    it('overlap / gap / missing / threshold variants all fail validation', () => {
      fc.assert(
        fc.property(
          fc.tuple(arbCorruption, arbDimensionIndex, arbBandPairIndex, arbBadThreshold),
          ([mode, dimIndex, pairIndex, badThreshold]) => {
            const corrupted = cloneRubric();

            switch (mode) {
              case 'overlap': {
                // Make bands[pairIndex] reach into bands[pairIndex+1].
                // The canonical rubric's bands are already sorted by min,
                // so pushing this band's max one step into the next band
                // creates a single-point overlap that the validator must
                // detect.
                const dim = corrupted.dimensions[dimIndex]!;
                const left = dim.bands[pairIndex]!;
                const right = dim.bands[pairIndex + 1]!;
                // Guard: only mutate if the bands are non-degenerate.
                left.max = right.min;
                break;
              }
              case 'gap': {
                // Pull bands[pairIndex+1].min one step away from
                // bands[pairIndex].max, opening a 1-point gap.
                const dim = corrupted.dimensions[dimIndex]!;
                const right = dim.bands[pairIndex + 1]!;
                right.min = right.min + 1;
                // Keep min <= max so the per-band check does not fire
                // before the partition check (we want the partition
                // failure to be the rejection reason).
                if (right.min > right.max) {
                  right.max = right.min;
                }
                break;
              }
              case 'missing': {
                // Replace the dimension name with one not in the
                // canonical set. The validator's name-set check rejects
                // this without needing to inspect the bands.
                const dim = corrupted.dimensions[dimIndex]!;
                dim.dimension = '__not_a_real_dimension__';
                break;
              }
              case 'threshold': {
                // Drop pass_threshold off the 0..100 lattice in one of
                // three ways (negative, > 100, or non-integer).
                const dim = corrupted.dimensions[dimIndex]!;
                dim.pass_threshold = badThreshold;
                break;
              }
            }

            const result = validateScoringRubric(corrupted as unknown as ScoringRubric);
            expect(result.ok).toBe(false);
          },
        ),
      );
    });

    it('rejects rubrics whose dimensions array is the wrong length', () => {
      // A four-dimension and a six-dimension variant exercise the
      // length-5 cardinality check directly. Both must be rejected with
      // a clear reason.
      const fourDim = {
        dimensions: buildScoringRubric().dimensions.slice(0, 4),
      };
      expect(validateScoringRubric(fourDim).ok).toBe(false);

      const canonical = buildScoringRubric();
      const sixDim = {
        dimensions: [...canonical.dimensions, canonical.dimensions[0]],
      };
      expect(validateScoringRubric(sixDim).ok).toBe(false);
    });

    it('rejects rubrics with a duplicated dimension name', () => {
      // Dropping `production_readiness` and replacing it with a duplicate
      // of `security` leaves length 5 but violates the unique-name clause.
      const corrupted = {
        dimensions: buildScoringRubric().dimensions.map((d, idx) =>
          idx === 4 ? { ...d, dimension: 'security' as const } : d,
        ),
      };
      expect(validateScoringRubric(corrupted).ok).toBe(false);
    });

    it('rejects rubrics whose lowest band does not start at 0', () => {
      const canonical = buildScoringRubric();
      const corrupted = {
        dimensions: canonical.dimensions.map((d, idx) => {
          if (idx !== 0) return d;
          // Shift the lowest band's min from 0 → 1; the partition
          // contract requires bands[0].min === 0.
          const bands = d.bands.map((b, bIdx) =>
            bIdx === 0 ? { ...b, min: 1 } : b,
          );
          return {
            ...d,
            bands: bands as unknown as typeof d.bands,
          };
        }),
      };
      expect(validateScoringRubric(corrupted).ok).toBe(false);
    });

    it('rejects rubrics whose highest band does not end at 100', () => {
      const canonical = buildScoringRubric();
      const corrupted = {
        dimensions: canonical.dimensions.map((d, idx) => {
          if (idx !== 0) return d;
          const bands = d.bands.map((b, bIdx) =>
            bIdx === 4 ? { ...b, max: 99 } : b,
          );
          return {
            ...d,
            bands: bands as unknown as typeof d.bands,
          };
        }),
      };
      expect(validateScoringRubric(corrupted).ok).toBe(false);
    });
  });
});
