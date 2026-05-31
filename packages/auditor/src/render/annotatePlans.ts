/**
 * Pass 4 — Reporting: Plan_Document annotator.
 *
 * Annotates each canonical Plan_Document under `d:\Veilpay\plans\` according
 * to its `Plan_Score.disposition`:
 *
 *   - `superseded` — prepend a `Superseded_Marker` block containing a link to
 *                    the consolidated `PRODUCTION_READINESS_AUDIT.md` and an
 *                    ISO 8601 supersession date.
 *   - `updated`    — append an `## Audit Refresh` section containing the
 *                    refreshed `Plan_Score`, an ISO 8601 refresh date, a
 *                    summary of changes, and a cross-reference link.
 *
 * Conflict resolution (per design.md "Error Handling"):
 *
 *   - If the file already begins with a `Superseded_Marker`, only the
 *     supersession date inside the existing marker is replaced — the rest of
 *     the marker (and the post-marker content) is preserved verbatim. This
 *     prevents marker stacking across repeated audit runs.
 *   - If the file already contains a `## Audit Refresh` section, the new
 *     section is appended at the file tail with a dated heading
 *     `## Audit Refresh — <ISO date>`, so the refresh history accumulates
 *     chronologically without overwriting prior entries.
 *
 * Property 7 (modification-set invariant) requires the original content — or
 * the content immediately following an existing `Superseded_Marker` — to
 * appear as a contiguous substring of the annotated output. The pure
 * `buildAnnotatedPlanContent` function asserts this invariant before
 * returning, so any future regression in the annotation logic surfaces as a
 * loud error rather than silent data loss.
 *
 * Atomic file write: the side-effecting `annotatePlan` wrapper writes to a
 * `<path>.tmp` file and then `fs.rename`s it into place. `fs.rename` on the
 * same filesystem is atomic on Windows and POSIX, so a partially written
 * temp file never appears at the published Plan_Document path. This mirrors
 * the evidence-write pattern in `passes/staticAnalysis/runner.ts`.
 *
 * Validates Requirements 2.3 (preserve every Plan_Document file on disk),
 * 2.4 (Superseded_Marker shape), and 2.5 (Audit Refresh section shape).
 * Property 6 (Plan_Document annotation invariant) is exercised by the
 * companion test in task 6.4; Property 7 is exercised by the integration
 * test in task 6.7 and is additionally enforced inline by the assertion in
 * `buildAnnotatedPlanContent`.
 */

import { promises as fs } from 'node:fs';

import type { Plan_Score } from '../models';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Shared options for both the pure builder and the I/O wrapper.
 *
 * `auditedAt` is an ISO 8601 timestamp (e.g., `RunMetadata.generated_at`).
 * Only the date portion (`YYYY-MM-DD`) is rendered into the marker / refresh
 * section, matching the design.md example block. Passing in the full
 * timestamp is supported so callers can reuse the same value the report
 * renderer consumes.
 *
 * `auditor` is the auditor identity surfaced in the Audit Refresh section
 * (`RunMetadata.auditor` — a human name or the literal string `"automated"`).
 */
export interface AnnotatePlanOptions {
  readonly auditedAt: string;
  readonly auditor: string;
}

/** Argument shape for the I/O wrapper `annotatePlan`. */
export interface AnnotatePlanRequest extends AnnotatePlanOptions {
  /** Absolute or workspace-relative path to the Plan_Document file. */
  readonly planPath: string;
  /** Plan_Score row produced by Pass 3 synthesis for this Plan_Document. */
  readonly planScore: Plan_Score;
}

/**
 * Return value from `annotatePlan`. Surfaces the file content before and
 * after the annotation so callers (and the integration test in task 6.7)
 * can diff the change without re-reading from disk.
 */
export interface AnnotatePlanResult {
  readonly before: string;
  readonly after: string;
}

// ---------------------------------------------------------------------------
// Constants — marker text and regexes
// ---------------------------------------------------------------------------

/**
 * Repository-relative link target for `PRODUCTION_READINESS_AUDIT.md` from
 * any Plan_Document under `d:\Veilpay\plans\`. The two files are siblings,
 * so a `./` prefix keeps the link working regardless of how the Plan_Document
 * is rendered (GitHub, VS Code preview, mdast, etc.).
 */
const RELATIVE_AUDIT_REPORT_LINK = './PRODUCTION_READINESS_AUDIT.md';

/**
 * Boundary regex for an existing `Superseded_Marker` block. Captures:
 *
 *   - Group 1: the supersession date string currently on the SUPERSEDED line.
 *
 * The body of the marker is matched lazily via `[\s\S]*?` so the regex
 * tolerates minor variations in the body lines (e.g., a previous audit run
 * that added an extra blockquote line) while still anchoring on the
 * `\n---\n` separator that closes the marker block.
 *
 * The leading `^` ensures the marker is at file start. The trailing
 * `\r?\n+` consumes the blank line(s) between `---` and the original
 * content, which is what `extractPreservedSubstring` slices off.
 */
const MARKER_BOUNDARY_REGEX =
  /^> \[!WARNING\]\r?\n> \*\*SUPERSEDED ([^*]+)\*\*[\s\S]*?\r?\n---\r?\n+/;

/**
 * Regex that detects an existing `## Audit Refresh` heading anywhere in the
 * Plan_Document. The trailing `(\s|$)` boundary is what distinguishes the
 * canonical heading from incidental text like `## Audit Refreshing`. This
 * matches both the bare heading (`## Audit Refresh`) and the dated variant
 * (`## Audit Refresh — 2025-01-15`).
 */
const AUDIT_REFRESH_HEADING_REGEX = /^##\s+Audit Refresh(\s|$)/m;

/** Date-only ISO 8601 prefix (`YYYY-MM-DD`). */
const ISO_DATE_PREFIX_REGEX = /^\d{4}-\d{2}-\d{2}/;

// ---------------------------------------------------------------------------
// Internal helpers — pure
// ---------------------------------------------------------------------------

/**
 * Coerce an ISO 8601 timestamp into its date-only form (`YYYY-MM-DD`).
 *
 * Accepts both bare dates (`2025-01-15`) and full timestamps
 * (`2025-01-15T10:30:00Z`). Falls back to `Date` parsing when the prefix
 * regex does not match, so unconventional but still parseable forms (e.g.,
 * locale-extended ISO 8601) are accepted. Throws when the input cannot be
 * parsed at all — the caller is expected to source `auditedAt` from
 * `RunMetadata.generated_at`, which is constructed via `Date#toISOString`.
 */
function toIsoDate(value: string): string {
  if (ISO_DATE_PREFIX_REGEX.test(value)) {
    return value.slice(0, 10);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `annotatePlans: auditedAt is not a valid ISO 8601 timestamp: ${value}`,
    );
  }
  return parsed.toISOString().slice(0, 10);
}

/**
 * Build the canonical `Superseded_Marker` block. The block is exactly five
 * blockquote lines + blank + `---` + blank, matching design.md verbatim.
 * Trailing newlines ensure the marker is followed by exactly one blank line
 * before the original content, so the prepend operation produces stable
 * Markdown structure.
 */
function buildSupersededMarker(isoDate: string): string {
  return (
    [
      '> [!WARNING]',
      `> **SUPERSEDED ${isoDate}**`,
      `> This plan has been superseded by [PRODUCTION_READINESS_AUDIT.md](${RELATIVE_AUDIT_REPORT_LINK}).`,
      '> Refer to that document for the current production-readiness assessment.',
      '> Original content preserved below for historical reference.',
      '',
      '---',
      '',
      '',
    ].join('\n')
  );
}

/**
 * Build the body of the `## Audit Refresh` section (everything from the
 * heading down to the cross-reference link). The heading is supplied by the
 * caller so this helper can render either the canonical bare heading or the
 * dated variant used when an earlier refresh section already exists.
 *
 * The Plan_Score line follows the design.md example layout:
 *
 *   `Security <s> | Code Quality <s> | UX Polish <s> | Performance <s> | Production-Readiness <s>`
 *
 * Summary bullets always start with a fixed sentence pointing the reader at
 * the consolidated Audit_Report, followed by one bullet per `GapNote` from
 * the Plan_Score (citing the gap dimension in parentheses) so sub-threshold
 * dimensions (Requirement 2.7 / Property 5) are surfaced inline.
 */
function buildAuditRefreshSection(
  heading: string,
  planScore: Plan_Score,
  isoDate: string,
  auditor: string,
): string {
  const { security, code_quality, ux_polish, performance, production_readiness } =
    planScore.scores;
  const scoreLine =
    `Security ${security} | Code Quality ${code_quality} | UX Polish ${ux_polish} | ` +
    `Performance ${performance} | Production-Readiness ${production_readiness}`;

  const summaryBullets: string[] = [
    '  - Score reflects findings captured by the consolidated production-readiness audit.',
  ];
  for (const gap of planScore.gaps) {
    summaryBullets.push(`  - ${gap.note} (${gap.dimension})`);
  }

  return [
    heading,
    '',
    `- **Refreshed:** ${isoDate}`,
    `- **Auditor:** ${auditor}`,
    `- **Plan_Score:** ${scoreLine}`,
    `- **Disposition:** ${planScore.disposition}`,
    '- **Summary of Changes:**',
    ...summaryBullets,
    `- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](${RELATIVE_AUDIT_REPORT_LINK})`,
  ].join('\n');
}

/**
 * Apply the `superseded` annotation to a Plan_Document body.
 *
 * If a `Superseded_Marker` already opens the file, only the date inside the
 * marker is replaced — the rest of the marker (and all post-marker content)
 * is preserved verbatim. This is the conflict-resolution rule from
 * design.md "Error Handling" and keeps Property 7 intact across multiple
 * supersession runs.
 *
 * Otherwise a fresh marker block is prepended ahead of the original content.
 */
function applySupersededAnnotation(content: string, isoDate: string): string {
  const match = content.match(MARKER_BOUNDARY_REGEX);
  if (match !== null) {
    const oldDate = match[1];
    if (oldDate === undefined) {
      // Defensive: regex shape guarantees group 1 is present.
      throw new Error(
        'annotatePlans: matched Superseded_Marker without a captured date',
      );
    }
    if (oldDate === isoDate) {
      return content;
    }
    const oldLine = `> **SUPERSEDED ${oldDate}**`;
    const newLine = `> **SUPERSEDED ${isoDate}**`;
    // The marker is anchored at file start, so a single replacement targets
    // exactly the SUPERSEDED line we want to update.
    return content.replace(oldLine, newLine);
  }
  return buildSupersededMarker(isoDate) + content;
}

/**
 * Apply the `updated` annotation to a Plan_Document body.
 *
 * The new section is always appended at the file tail. When an existing
 * `## Audit Refresh` heading is detected anywhere in the file, the new
 * section uses the dated heading variant (`## Audit Refresh — <ISO date>`)
 * so the refresh history accumulates chronologically.
 *
 * Newline handling: the original content is appended verbatim to the
 * output (no trimming) so Property 7's contiguous-substring invariant
 * holds even when the original ends with multiple trailing newlines. A
 * separator of either `''`, `'\n'`, or `'\n\n'` is inserted between the
 * original content and the new heading so the rendered Markdown always has
 * a blank line before the heading, regardless of how the original file was
 * line-terminated.
 */
function applyUpdatedAnnotation(
  content: string,
  planScore: Plan_Score,
  isoDate: string,
  auditor: string,
): string {
  const hasExistingRefresh = AUDIT_REFRESH_HEADING_REGEX.test(content);
  const heading = hasExistingRefresh
    ? `## Audit Refresh — ${isoDate}`
    : '## Audit Refresh';
  const section = buildAuditRefreshSection(heading, planScore, isoDate, auditor);

  // Choose a separator that yields exactly one blank line between the
  // original content and the new heading without modifying the original
  // (Property 7 keeps the original byte-exact as a substring of the output).
  let separator: string;
  if (content.length === 0) {
    separator = '';
  } else if (content.endsWith('\n\n')) {
    separator = '';
  } else if (content.endsWith('\n')) {
    separator = '\n';
  } else {
    separator = '\n\n';
  }

  return `${content}${separator}${section}\n`;
}

/**
 * Compute the substring that Property 7 requires to be preserved in the
 * annotated output.
 *
 * If the original content already begins with a `Superseded_Marker` block,
 * Property 7 only requires the post-marker content to remain a contiguous
 * substring (because re-stamping the marker date legitimately changes a few
 * bytes inside the marker). Otherwise the entire original content must
 * appear verbatim in the output.
 */
function extractPreservedSubstring(originalContent: string): string {
  const match = originalContent.match(MARKER_BOUNDARY_REGEX);
  if (match !== null) {
    return originalContent.slice(match[0].length);
  }
  return originalContent;
}

// ---------------------------------------------------------------------------
// Public API — pure builder
// ---------------------------------------------------------------------------

/**
 * Build the annotated Plan_Document content. Pure: no I/O, no clock, no
 * randomness. Same inputs always produce the same output bytes, including
 * across invocations (no `Date.now()` reads).
 *
 * The function dispatches on `planScore.disposition`:
 *
 *   - `superseded` — prepend (or re-stamp) the `Superseded_Marker` block.
 *   - `updated`    — append a fresh `## Audit Refresh` section, using the
 *                    dated heading variant when a prior refresh section is
 *                    already present in the file.
 *
 * Before returning, the implementation asserts Property 7's
 * contiguous-substring invariant against the produced output. Any future
 * regression in the annotation logic that drops or rewrites original
 * Plan_Document content surfaces here as a loud `Error` rather than silent
 * data loss in `d:\Veilpay\plans\`.
 *
 * Validates Requirements 2.4 (Superseded_Marker), 2.5 (Audit Refresh
 * section), and Property 7 (contiguous-substring invariant).
 *
 * @param originalContent - Plan_Document file body as read from disk.
 * @param planScore       - Pass 3 Plan_Score row for this Plan_Document.
 * @param opts            - `auditedAt` ISO 8601 timestamp + auditor identity.
 * @returns Annotated Plan_Document body ready to be written back to disk.
 * @throws  When `auditedAt` cannot be parsed as ISO 8601, or when the
 *          Property 7 invariant is violated by the annotation pipeline.
 */
export function buildAnnotatedPlanContent(
  originalContent: string,
  planScore: Plan_Score,
  opts: AnnotatePlanOptions,
): string {
  const isoDate = toIsoDate(opts.auditedAt);

  let output: string;
  if (planScore.disposition === 'superseded') {
    output = applySupersededAnnotation(originalContent, isoDate);
  } else {
    output = applyUpdatedAnnotation(
      originalContent,
      planScore,
      isoDate,
      opts.auditor,
    );
  }

  // Property 7 sanity assertion. `String#includes('')` is always true, so
  // the empty-original case (a 0-byte Plan_Document) trivially satisfies the
  // invariant.
  const preservedSubstring = extractPreservedSubstring(originalContent);
  if (!output.includes(preservedSubstring)) {
    throw new Error(
      'annotatePlans: Property 7 violation — original Plan_Document content ' +
        'is not preserved as a contiguous substring of the annotated output.',
    );
  }

  return output;
}

// ---------------------------------------------------------------------------
// Public API — I/O wrapper
// ---------------------------------------------------------------------------

/**
 * Read a Plan_Document from disk, build its annotated body via
 * `buildAnnotatedPlanContent`, and atomically write the result back to the
 * same path.
 *
 * Atomicity: writes to `<planPath>.tmp` and then `fs.rename`s the temp file
 * over `planPath`. `fs.rename` on the same filesystem is atomic on Windows
 * and POSIX, so observers of `planPath` see either the previous content or
 * the fully written annotated content — never a partial write. This mirrors
 * the evidence-write pattern in `passes/staticAnalysis/runner.ts`.
 *
 * Returns the `before` and `after` content so callers (and the integration
 * test in task 6.7) can compute a diff without re-reading from disk.
 *
 * Validates Requirements 2.3 (preserve every Plan_Document file on disk),
 * 2.4 (Superseded_Marker for `superseded`), and 2.5 (Audit Refresh section
 * for `updated`).
 *
 * @throws The underlying `fs` errors propagate unchanged (e.g., `ENOENT`
 *         when the Plan_Document does not exist). Property 7 violations
 *         from `buildAnnotatedPlanContent` propagate as `Error` and are
 *         caught by the Pass 4 orchestrator, which aborts before any
 *         further plan annotation is attempted.
 */
export async function annotatePlan(
  request: AnnotatePlanRequest,
): Promise<AnnotatePlanResult> {
  const before = await fs.readFile(request.planPath, 'utf8');
  const after = buildAnnotatedPlanContent(before, request.planScore, {
    auditedAt: request.auditedAt,
    auditor: request.auditor,
  });

  const tmpPath = `${request.planPath}.tmp`;
  await fs.writeFile(tmpPath, after, 'utf8');
  await fs.rename(tmpPath, request.planPath);

  return { before, after };
}
