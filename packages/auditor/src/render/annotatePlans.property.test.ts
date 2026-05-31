/**
 * Property-based test for the Plan_Document annotation invariant
 * (Property 6).
 *
 * Feature: production-readiness-audit, Property 6:
 *   For an arbitrary `originalContent` Plan_Document body and an arbitrary
 *   `Plan_Score`, the result of
 *
 *     buildAnnotatedPlanContent(originalContent, planScore, { auditedAt, auditor })
 *
 *   honours the disposition-specific shape mandated by the design.md
 *   "Plans_Library Refresh component":
 *
 *     * `superseded` —
 *         - Output begins with the canonical Superseded_Marker prefix
 *           `> [!WARNING]\n> **SUPERSEDED ` (Requirement 2.4).
 *         - The marker block contains a link to
 *           `PRODUCTION_READINESS_AUDIT.md` and an ISO 8601 date
 *           (`YYYY-MM-DD`) — both required by Requirement 2.4.
 *         - The original content (or, when the original already opens
 *           with a Superseded_Marker, the post-marker tail) appears as
 *           a contiguous substring of the output, so Property 7's
 *           "preserve original content" invariant holds.
 *
 *     * `updated` —
 *         - Output ends with a `## Audit Refresh` section containing
 *           the refreshed five-dimension `Plan_Score` line, the ISO
 *           8601 refresh date, and at least one summary bullet
 *           (Requirement 2.5).
 *         - The original content is a contiguous substring of the
 *           output (Property 7).
 *
 * Validates: Requirements 2.4, 2.5
 *
 * Strategy:
 *   - One generator (`arbPlanScoreCore`) produces every Plan_Score field
 *     other than `disposition`. The two property bodies override
 *     `disposition` to `'superseded'` or `'updated'` respectively so the
 *     same Plan_Score arbitrary feeds both halves of Property 6 without
 *     the synthesizer or the test guessing wrong about which branch is
 *     under test.
 *   - `auditedAt` is generated as either a bare `YYYY-MM-DD` date or a
 *     full ISO 8601 timestamp via `fc.date(...).toISOString()`. Both
 *     forms are accepted by `buildAnnotatedPlanContent` (it normalises
 *     to the date-only form internally) and exercising both keeps the
 *     property faithful to the contract documented in
 *     `AnnotatePlanOptions.auditedAt`.
 *   - `auditor` filters out `\r` / `\n` so the rendered Audit Refresh
 *     section stays single-line per bullet, which the
 *     "ends-with-Audit-Refresh" assertion relies on. Carriage returns or
 *     newlines inside the auditor identity would still produce valid
 *     Markdown, but they are out of contract for `RunMetadata.auditor`
 *     (a human name or the literal string `"automated"`).
 *   - `originalContent` is a wide-open `fc.string` over 0..4000 bytes
 *     so the property exercises empty files, large files, and content
 *     that already contains the literal `## Audit Refresh` heading
 *     (which forces the dated-heading variant in
 *     `applyUpdatedAnnotation`).
 *
 * Property 7 substring check:
 *   The implementation already enforces the contiguous-substring
 *   invariant inline via an assertion in `buildAnnotatedPlanContent`,
 *   but Property 6 specifies the same invariant externally. We
 *   re-derive the preserved substring with the same boundary regex
 *   the implementation uses so the test fails loudly if a future
 *   refactor only updates the production code path. Sharing the regex
 *   shape (rather than the exported regex itself) keeps the test
 *   independent of the production-side encapsulation.
 */

import * as fc from 'fast-check';

import type {
  Disposition,
  GapNote,
  Plan_Score,
  RubricDimension,
} from '../models';
import { buildAnnotatedPlanContent } from './annotatePlans';

// ---------------------------------------------------------------------------
// Constants — mirrored from the production module
// ---------------------------------------------------------------------------

/** The five rubric dimensions, used to tag `GapNote` entries. */
const RUBRIC_DIMENSIONS: readonly RubricDimension[] = [
  'security',
  'code_quality',
  'ux_polish',
  'performance',
  'production_readiness',
] as const;

/**
 * Boundary regex for an existing `Superseded_Marker` block. Mirrors the
 * shape used inside `annotatePlans.ts` so the test extracts the same
 * preserved substring the implementation does. Captures the full marker
 * span (not just the date) so `slice(match[0].length)` lands exactly on
 * the original content.
 */
const MARKER_BOUNDARY_REGEX =
  /^> \[!WARNING\]\r?\n> \*\*SUPERSEDED ([^*]+)\*\*[\s\S]*?\r?\n---\r?\n+/;

/** Canonical marker prefix every superseded annotation must start with. */
const MARKER_PREFIX = '> [!WARNING]\n> **SUPERSEDED ';

/** Sibling-relative link target for the consolidated Audit_Report. */
const AUDIT_REPORT_LINK =
  '[PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)';

/** ISO 8601 date pattern used inside the marker block and refresh section. */
const ISO_DATE_REGEX = /\d{4}-\d{2}-\d{2}/;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Score values are integers in 0..100, matching the rubric range. */
const arbScore = fc.integer({ min: 0, max: 100 });

const arbDimension = fc.constantFrom<RubricDimension>(...RUBRIC_DIMENSIONS);

/**
 * `GapNote` carries a non-empty `note` so the renderer's gap-bullet line
 * is well-formed. The note string filters out `\r` / `\n` so each bullet
 * occupies a single line — this keeps the "at least one summary bullet"
 * assertion robust without relying on the renderer's whitespace handling.
 */
const arbGapNote: fc.Arbitrary<GapNote> = fc.record({
  dimension: arbDimension,
  note: fc
    .string({ minLength: 1, maxLength: 64 })
    .filter((s) => s.length > 0 && !/[\r\n]/.test(s)),
});

/**
 * Plan_Score core: every field except `disposition`, which the two
 * property bodies override so each branch of Property 6 is exercised
 * deterministically. `plan_path` is drawn from a small set of canonical
 * paths because the annotator does not consume the field — pinning the
 * range keeps counter-examples small.
 */
const arbPlanScoreCore: fc.Arbitrary<Omit<Plan_Score, 'disposition'>> =
  fc.record({
    plan_path: fc.constantFrom(
      'plans/AUDIT_REPORT.md',
      'plans/COMPREHENSIVE_AUDIT_REPORT.md',
      'plans/ROADMAP.md',
      'plans/MERCHANT_DASHBOARD_SPEC.md',
    ),
    scores: fc.record({
      security: arbScore,
      code_quality: arbScore,
      ux_polish: arbScore,
      performance: arbScore,
      production_readiness: arbScore,
    }),
    gaps: fc.array(arbGapNote, { minLength: 0, maxLength: 5 }),
    notes: fc
      .string({ minLength: 0, maxLength: 32 })
      .filter((s) => !/[\r\n]/.test(s)),
  });

/**
 * Compose a full `Plan_Score` with the supplied `disposition`. Used by
 * each property body to lock the disposition under test while keeping
 * every other field fully randomised.
 */
const arbPlanScoreWithDisposition = (
  disposition: Disposition,
): fc.Arbitrary<Plan_Score> =>
  arbPlanScoreCore.map((core) => ({ ...core, disposition }));

/**
 * `auditedAt` is either a bare `YYYY-MM-DD` date or a full ISO 8601
 * timestamp produced by `Date#toISOString`. Both forms are accepted by
 * `buildAnnotatedPlanContent`. The date range is bounded to 1970..2099
 * to avoid `+YYYYYY-...` extended-year output from `toISOString` for
 * extreme `Date` values, which is out of contract for the auditor's
 * `RunMetadata.generated_at` source field.
 */
const arbDate = fc.date({
  min: new Date('1970-01-01T00:00:00.000Z'),
  max: new Date('2099-12-31T23:59:59.000Z'),
});
const arbAuditedAt: fc.Arbitrary<string> = fc.oneof(
  arbDate.map((d) => d.toISOString().slice(0, 10)),
  arbDate.map((d) => d.toISOString()),
);

/**
 * Auditor identity. Non-empty, no carriage return / newline so the
 * single-line bullet shape of the rendered Audit Refresh section is
 * preserved. Mirrors the contract documented on
 * `AnnotatePlanOptions.auditor` (`RunMetadata.auditor`).
 */
const arbAuditor: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 32 })
  .filter((s) => s.length > 0 && !/[\r\n]/.test(s));

/**
 * Plan_Document body. Empty files are allowed (the empty-original case
 * is interesting because `String#includes('')` makes Property 7
 * trivially true and we want that branch in coverage). 4000-byte cap
 * keeps individual fast-check runs fast while still covering large
 * files.
 */
const arbOriginalContent: fc.Arbitrary<string> = fc.string({
  minLength: 0,
  maxLength: 4000,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the substring that Property 7 requires to be preserved in the
 * annotated output. Mirrors `extractPreservedSubstring` in
 * `annotatePlans.ts`: when the original content already opens with a
 * `Superseded_Marker`, only the post-marker tail must remain a
 * contiguous substring (re-stamping the marker date legitimately
 * mutates a few bytes inside the existing marker). Otherwise the entire
 * original content must appear verbatim in the output.
 */
function preservedSubstring(originalContent: string): string {
  const match = originalContent.match(MARKER_BOUNDARY_REGEX);
  if (match !== null) {
    return originalContent.slice(match[0].length);
  }
  return originalContent;
}

// ---------------------------------------------------------------------------
// Property 6: Plan_Document annotation invariant
// ---------------------------------------------------------------------------

describe('Plan_Document annotation invariant (Property 6)', () => {
  it('superseded: marker prefix, audit link, ISO date, and original content preserved', () => {
    fc.assert(
      fc.property(
        arbOriginalContent,
        arbPlanScoreWithDisposition('superseded'),
        arbAuditedAt,
        arbAuditor,
        (originalContent, planScore, auditedAt, auditor) => {
          const out = buildAnnotatedPlanContent(originalContent, planScore, {
            auditedAt,
            auditor,
          });

          // Clause 1 (Requirement 2.4): output begins with the canonical
          // Superseded_Marker prefix. Re-stamping an existing marker
          // also satisfies this clause because the marker is anchored at
          // file start and only the date inside the marker is rewritten.
          expect(out.startsWith(MARKER_PREFIX)).toBe(true);

          // Clause 2 (Requirement 2.4): the marker block links to the
          // consolidated Audit_Report.
          expect(out).toContain(AUDIT_REPORT_LINK);

          // Clause 3 (Requirement 2.4): the marker block contains an
          // ISO 8601 date. We slice the head of the file (the marker is
          // strictly the first ~9 lines) so the regex can only match a
          // date inside the marker, not coincidental digits in the
          // preserved original content.
          const headLines = out.split('\n').slice(0, 9).join('\n');
          expect(headLines).toMatch(ISO_DATE_REGEX);

          // Clause 4 (Property 7 / Requirement 2.3): the original
          // content (or its post-marker tail when an existing marker is
          // present) is a contiguous substring of the output.
          expect(out.includes(preservedSubstring(originalContent))).toBe(true);
        },
      ),
    );
  });

  it('updated: output ends with Audit Refresh section containing score line, ISO date, summary bullet, and original content preserved', () => {
    fc.assert(
      fc.property(
        arbOriginalContent,
        arbPlanScoreWithDisposition('updated'),
        arbAuditedAt,
        arbAuditor,
        (originalContent, planScore, auditedAt, auditor) => {
          const out = buildAnnotatedPlanContent(originalContent, planScore, {
            auditedAt,
            auditor,
          });

          // Clause 1 (Requirement 2.5): a `## Audit Refresh` heading is
          // present. The renderer emits either the bare heading or the
          // dated variant `## Audit Refresh — <ISO date>`; both share
          // the prefix `## Audit Refresh`.
          expect(out).toMatch(/^##\s+Audit Refresh/m);

          // Locate the appended section. Even when the original content
          // already contains the literal `## Audit Refresh` heading,
          // `lastIndexOf` lands on the new section because
          // `applyUpdatedAnnotation` always appends at the file tail.
          const sectionStart = out.lastIndexOf('## Audit Refresh');
          expect(sectionStart).toBeGreaterThanOrEqual(0);
          const section = out.slice(sectionStart);

          // Clause 2 (Requirement 2.5): the section contains the
          // five-dimension Plan_Score line in the design.md format.
          const { security, code_quality, ux_polish, performance, production_readiness } =
            planScore.scores;
          const scoreLine =
            `Security ${security} | Code Quality ${code_quality} | ` +
            `UX Polish ${ux_polish} | Performance ${performance} | ` +
            `Production-Readiness ${production_readiness}`;
          expect(section).toContain(scoreLine);

          // Clause 3 (Requirement 2.5): the section contains an ISO
          // 8601 refresh date.
          expect(section).toMatch(ISO_DATE_REGEX);

          // Clause 4 (Requirement 2.5): the section carries a non-empty
          // summary with at least one bullet under "Summary of Changes".
          // The implementation always emits a fixed introductory bullet
          // (and one bullet per `GapNote`), so this branch is reached
          // even when `gaps` is empty.
          expect(section).toMatch(
            /^- \*\*Summary of Changes:\*\*\r?\n {2}- \S/m,
          );

          // Clause 5 (Requirement 2.5): the output ends with the
          // section's cross-reference link followed by a trailing
          // newline. This is the renderer's invariant tail and is what
          // makes "Output ends with the `## Audit Refresh` section" a
          // checkable property.
          expect(
            out.endsWith(`- **Cross-Reference:** ${AUDIT_REPORT_LINK}\n`),
          ).toBe(true);

          // Clause 6 (Property 7 / Requirement 2.3): the original
          // content is a contiguous substring of the output. The
          // `updated` branch never re-stamps an existing marker, so the
          // preserved substring is the full original content.
          expect(out.includes(originalContent)).toBe(true);
        },
      ),
    );
  });
});
