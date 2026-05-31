/**
 * Property-based tests for the Graphify failure-capture invariant
 * (Property 14 in `.kiro/specs/production-readiness-audit/design.md`).
 *
 * **Validates: Requirements 3.6**
 *
 * The property under test is the *shape contract* of the helper that builds a
 * `GraphifyRefreshSummary` from a single graphify evidence record:
 *
 *   - Invariant 1: `failure_capture` is `null` iff `record.exitCode === 0`.
 *   - Invariant 2: when `failure_capture` is non-null,
 *                  `failure_capture.output_tail.length <= 50`.
 *   - Invariant 3: when `failure_capture` is non-null,
 *                  `failure_capture.exit_code === record.exitCode`.
 *
 * The test does NOT spawn the real `graphify` binary. Instead it generates
 * synthetic `EvidenceRecord`-like objects (covering exit code 0, negative
 * spawn-error codes, and positive normal-failure codes) and asserts the
 * helper's output respects the contract regardless of input.
 *
 * The helper deliberately re-trims the tail to <= `MAX_TAIL_LINES` even when
 * a caller hands it a longer array. Property 14 is about the *summary
 * builder's* output, not the runner's input — the test exercises that
 * defensive trim by generating tails up to 200 lines.
 */

import * as fc from 'fast-check';

import {
  buildGraphifySummaryFromRecord,
  type GraphifySummaryRecordLike,
} from './graphify';
import { MAX_TAIL_LINES } from './runner';

/** Fixed inputs that don't influence the property under test. */
const WORKSPACE_ROOT = 'd:\\Veilpay';
const GRAPHIFY_OUT_DIR = 'd:\\Veilpay\\graphify-out';

/**
 * Arbitrary for an ISO 8601 timestamp string. fast-check's `date` arbitrary
 * already produces real `Date`s; we map them to the ISO form the audit
 * pipeline uses everywhere.
 */
const isoTimestampArb: fc.Arbitrary<string> = fc
  .date({ noInvalidDate: true })
  .map((d) => d.toISOString());

/**
 * Arbitrary for a graphify-shaped exit code. Covers:
 *   - 0 (success path).
 *   - Negative integers (spawn-error path; the runner reports ENOENT and
 *     similar as exit code -1, but other negative codes are possible).
 *   - Positive integers up to 255 (the normal Unix/Windows process-exit range).
 *
 * fast-check's default `integer` distribution would oversample values far
 * outside the realistic range, so we constrain it explicitly.
 */
const exitCodeArb: fc.Arbitrary<number> = fc.integer({ min: -8, max: 255 });

/**
 * Arbitrary for a single line of combined stdout/stderr. Bounded to 120
 * characters and explicitly excluding raw newlines so a "line" arbitrary
 * doesn't accidentally generate multi-line strings (which would make the
 * `output_tail.length <= 50` invariant ambiguous).
 */
const tailLineArb: fc.Arbitrary<string> = fc
  .string({ minLength: 0, maxLength: 120 })
  .map((s) => s.replace(/[\r\n]+/g, ' '));

/**
 * Arbitrary for the `tail` array. Length range 0..200 covers both the under-
 * and over-cap cases relative to `MAX_TAIL_LINES` (50). When the harness's
 * 50-line cap is bypassed by a synthetic caller, the helper must still
 * emit `output_tail.length <= 50`.
 */
const tailArb: fc.Arbitrary<readonly string[]> = fc.array(tailLineArb, {
  minLength: 0,
  maxLength: 200,
});

/** Arbitrary for the executable name passed to spawn (e.g., `"graphify"`). */
const commandArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 32 })
  .map((s) => s.replace(/\s+/g, '-'));

/** Arbitrary for the argv array passed to spawn. */
const argsArb: fc.Arbitrary<readonly string[]> = fc.array(
  fc.string({ minLength: 0, maxLength: 32 }),
  { minLength: 0, maxLength: 6 },
);

/**
 * Composite arbitrary for a synthetic `EvidenceRecord`-like object. Built via
 * `fc.record` so the shape mirrors `GraphifySummaryRecordLike` exactly.
 */
const evidenceRecordArb: fc.Arbitrary<GraphifySummaryRecordLike> = fc.record({
  command: commandArb,
  args: argsArb,
  exitCode: exitCodeArb,
  runAt: isoTimestampArb,
  tail: tailArb,
});

describe('buildGraphifySummaryFromRecord — Property 14', () => {
  it('failure_capture is null iff exitCode === 0 (Invariant 1)', () => {
    fc.assert(
      fc.property(
        evidenceRecordArb,
        isoTimestampArb,
        (record, runAtIso) => {
          const summary = buildGraphifySummaryFromRecord(record, {
            workspaceRoot: WORKSPACE_ROOT,
            graphifyOutDir: GRAPHIFY_OUT_DIR,
            runAtIso,
          });

          if (record.exitCode === 0) {
            expect(summary.failure_capture).toBeNull();
          } else {
            expect(summary.failure_capture).not.toBeNull();
          }
        },
      ),
    );
  });

  it('failure_capture.output_tail.length <= 50 when present (Invariant 2)', () => {
    fc.assert(
      fc.property(
        evidenceRecordArb,
        isoTimestampArb,
        (record, runAtIso) => {
          const summary = buildGraphifySummaryFromRecord(record, {
            workspaceRoot: WORKSPACE_ROOT,
            graphifyOutDir: GRAPHIFY_OUT_DIR,
            runAtIso,
          });

          if (summary.failure_capture !== null) {
            expect(
              summary.failure_capture.output_tail.length,
            ).toBeLessThanOrEqual(MAX_TAIL_LINES);
          }
        },
      ),
    );
  });

  it('failure_capture.exit_code matches the record exit code when present (Invariant 3)', () => {
    fc.assert(
      fc.property(
        evidenceRecordArb,
        isoTimestampArb,
        (record, runAtIso) => {
          const summary = buildGraphifySummaryFromRecord(record, {
            workspaceRoot: WORKSPACE_ROOT,
            graphifyOutDir: GRAPHIFY_OUT_DIR,
            runAtIso,
          });

          if (summary.failure_capture !== null) {
            expect(summary.failure_capture.exit_code).toBe(record.exitCode);
            // Sanity: the same exit code must therefore be non-zero.
            expect(summary.failure_capture.exit_code).not.toBe(0);
          }
        },
      ),
    );
  });

  it('preserves the original tail order when trimming to the last 50 lines', () => {
    // This isn't one of the three numbered invariants, but it complements
    // Invariant 2 by checking that the trim takes the *trailing* slice
    // rather than an arbitrary 50 entries — without this, a buggy slice
    // could still satisfy `length <= 50`.
    fc.assert(
      fc.property(
        // Force the failure path by seeding a non-zero exit code, and force
        // a tail strictly longer than the cap so trimming is observable.
        fc.record({
          command: commandArb,
          args: argsArb,
          exitCode: fc.oneof(
            fc.integer({ min: -8, max: -1 }),
            fc.integer({ min: 1, max: 255 }),
          ),
          runAt: isoTimestampArb,
          tail: fc.array(tailLineArb, {
            minLength: MAX_TAIL_LINES + 1,
            maxLength: 200,
          }),
        }),
        isoTimestampArb,
        (record, runAtIso) => {
          const summary = buildGraphifySummaryFromRecord(record, {
            workspaceRoot: WORKSPACE_ROOT,
            graphifyOutDir: GRAPHIFY_OUT_DIR,
            runAtIso,
          });

          // Failure path is forced, so this must hold.
          expect(summary.failure_capture).not.toBeNull();
          if (summary.failure_capture === null) {
            return;
          }

          const trimmed = summary.failure_capture.output_tail;
          expect(trimmed.length).toBe(MAX_TAIL_LINES);

          // The trimmed tail must equal the last 50 entries of the original.
          const expectedTail = record.tail.slice(
            record.tail.length - MAX_TAIL_LINES,
          );
          expect([...trimmed]).toEqual([...expectedTail]);
        },
      ),
    );
  });
});
