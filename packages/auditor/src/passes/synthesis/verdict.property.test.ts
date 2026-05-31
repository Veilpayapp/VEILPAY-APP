/**
 * Property-based test for the production-readiness verdict (Property 13).
 *
 * Feature: production-readiness-audit, Property 13:
 *   *For any* `Production_Readiness_Thresholds` table emitted by the audit,
 *   the overall `Pass/Fail Verdict` SHALL be `pass` if and only if every row
 *   in the table has pass status `pass`.
 *
 * Validates: Requirements 9.10
 *
 * Strategy:
 *   - Use `fast-check` to generate arbitrary-length (0..16) arrays of
 *     synthetic `Production_Readiness_Threshold` rows whose `pass` field is
 *     uniformly random. Walk the table with a hand-rolled
 *     `rows.every(r => r.pass)` reference and assert `computeVerdict`
 *     agrees on every shape.
 *   - Assert the vacuous-truth edge case explicitly:
 *     `computeVerdict([]) === 'pass'`. The synthesizer never emits an empty
 *     table, but Property 13 is stated over arbitrary tables, so the
 *     verdict function must honour the standard semantics of conjunction
 *     over an empty set.
 *   - Assert the canonical 8-row case directly: starting from a table where
 *     every row passes, flipping any single row to fail flips the verdict
 *     from `'pass'` to `'fail'`. This pins the "iff" direction at the row
 *     count the synthesizer actually emits.
 *
 * Notes:
 *   - The other row fields (`id`, `label`, `target`, `current_value`,
 *     `explanation`) are fixed to short, valid placeholders. They do not
 *     affect the verdict, and Property 12 (rule completeness) covers their
 *     non-emptiness for real synthesizer output.
 *   - Default fast-check run count (100) is sufficient — the verdict is a
 *     pure boolean reduction over the array's `pass` field.
 */

import * as fc from 'fast-check';

import { computeVerdict } from './thresholds';
import type { Production_Readiness_Threshold } from '../../models';

// ---------------------------------------------------------------------------
// Generator — build a synthetic threshold row whose `pass` field is the only
// degree of freedom that matters for the verdict.
// ---------------------------------------------------------------------------

/**
 * Build a placeholder row that satisfies the `Production_Readiness_Threshold`
 * type without claiming to mirror the synthesizer's eight-row output. The id
 * is supplied by the caller so the generated table can carry monotonically
 * increasing ids.
 */
const makeRow = (id: number, pass: boolean): Production_Readiness_Threshold =>
  Object.freeze({
    id,
    label: `synthetic row ${id}`,
    target: '= 0',
    current_value: pass ? '0' : '1',
    pass,
    explanation: 'synthetic row for Property 13',
  });

/**
 * Arbitrary table of 0..16 synthetic rows with random pass booleans. The
 * upper bound of 16 is twice the canonical row count, which is enough to
 * exercise both short and longer tables without paying for huge arrays the
 * verdict function does not care about.
 */
const arbThresholdTable = fc
  .array(fc.boolean(), { minLength: 0, maxLength: 16 })
  .map((passFlags) => passFlags.map((pass, idx) => makeRow(idx + 1, pass)));

describe('computeVerdict (Property 13: verdict is conjunction of rows)', () => {
  // -------------------------------------------------------------------------
  // Edge case: empty table.
  //
  // Conjunction over the empty set is `true`, so an empty threshold table
  // must yield `'pass'`. The synthesizer never emits this shape, but the
  // property is stated over *any* table, so the function must honour it.
  // -------------------------------------------------------------------------
  it('returns "pass" for an empty table (vacuous truth)', () => {
    expect(computeVerdict([])).toBe('pass');
  });

  // -------------------------------------------------------------------------
  // Universal property: verdict matches a hand-rolled `every` reference.
  // -------------------------------------------------------------------------
  it('returns "pass" iff every row passes, else "fail"', () => {
    fc.assert(
      fc.property(arbThresholdTable, (rows) => {
        const allPass = rows.every((r) => r.pass);
        const expected = allPass ? 'pass' : 'fail';
        expect(computeVerdict(rows)).toBe(expected);
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Canonical 8-row case: flipping any single row to fail must flip the
  // verdict from 'pass' to 'fail'. This pins the "iff" direction at the
  // exact row count the production synthesizer emits, so a regression that
  // accidentally short-circuits to 'pass' on a partial table would be caught
  // here even if the universal property somehow missed it.
  // -------------------------------------------------------------------------
  it('flipping any single row to fail in the canonical 8-row case flips the verdict', () => {
    const allPassRows: Production_Readiness_Threshold[] = Array.from(
      { length: 8 },
      (_, idx) => makeRow(idx + 1, true),
    );
    expect(computeVerdict(allPassRows)).toBe('pass');

    for (let flipIdx = 0; flipIdx < allPassRows.length; flipIdx++) {
      const mutated = allPassRows.map((row, idx) =>
        idx === flipIdx ? makeRow(row.id, false) : row,
      );
      expect(computeVerdict(mutated)).toBe('fail');
    }
  });
});
