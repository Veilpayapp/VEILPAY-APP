/**
 * Pass 4 — Reporting orchestrator.
 *
 * Runs after Pass 3 synthesis has produced an in-memory `AuditReportData`.
 * Owns every write that lands under `d:\Veilpay\plans\`:
 *
 *   1. The consolidated `PRODUCTION_READINESS_AUDIT.md` deliverable.
 *   2. Each `Plan_Document` annotation (Superseded_Marker prepend or
 *      `## Audit Refresh` append).
 *   3. The `.audit-evidence/ABORT.md` failure record written when an
 *      earlier pass threw `AuditAbortError`.
 *
 * The contract is "all-or-nothing": every property-style structural check
 * runs against the in-memory `AuditReportData` BEFORE any byte is written.
 * If any check fails, the orchestrator throws and no file under
 * `d:\Veilpay\plans\` is touched. The Pass 4 design relies on this
 * pre-validation step to keep inconsistent deliverables from reaching the
 * Plans_Library — a half-renderable report or a scored-but-not-validated
 * Plan_Score is a worse outcome than no report at all.
 *
 * Mirrors design.md "Pass 4: Reporting":
 *   - The Audit_Report is the single consolidated artifact; every other
 *     deliverable is a section inside it.
 *   - Plan_Documents are annotated in place, never deleted.
 *   - The Production_Readiness_Thresholds checklist is consumed (not
 *     produced) here — Pass 3 already computed `audit.verdict`, this pass
 *     only re-confirms it equals `computeVerdict(thresholds)`.
 *
 * Validates Requirements:
 *   - 1.1 (Audit_Report at the canonical path).
 *   - 2.3 (preserve every Plan_Document file on disk — annotation only).
 *   - 2.4, 2.5 (Superseded_Marker / Audit Refresh shape via `annotatePlan`).
 *   - 3.6 (Graphify failure capture — surfaced inline in the report; the
 *           ABORT.md path here covers the broader audit-abort case).
 *   - 10.1 (writes confined to `d:\Veilpay\plans\` and `graphify-out\`).
 *   - 10.2, 10.3, 10.4 (no source mutation outside the audit's own
 *           write-set; abort path skips both report and annotations).
 *
 * Property tests in tasks 6.6 and 6.7 exercise the abort path and the
 * modification-set invariant against a fixture workspace. The orchestrator
 * itself is intentionally light on logic so those tests can pin behaviour.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  AuditReportData,
  Network_Icon,
  Plan_Score,
  RubricDimension,
  Vulnerability_Finding,
} from '../models';
import { validateVulnerabilityFinding } from '../models/finding.guards';
import { annotatePlan } from '../render/annotatePlans';
import {
  EXECUTIVE_SUMMARY_WORD_LIMIT,
  countWords,
  renderAuditReport,
} from '../render/renderAuditReport';
import { AuditAbortError, isAuditAbortError } from '../util/errors';
import { validateScoringRubric } from './synthesis/rubric';
import { computeVerdict } from './synthesis/thresholds';

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

/**
 * Input shape for `runReporting`.
 *
 * `plansDir` is the absolute path to the Plans_Library directory (e.g.,
 * `d:/Veilpay/plans`). Both the consolidated report and the
 * `.audit-evidence/ABORT.md` failure record land under this directory.
 *
 * `auditor` and `auditedAt` are forwarded to `annotatePlan` so the
 * Superseded_Marker / Audit Refresh sections share the same identity and
 * timestamp as the report's Run Metadata block.
 *
 * `abortError` is set by the orchestrator (CLI entrypoint, task 7.1) when
 * an earlier pass threw `AuditAbortError`. When present, the abort writer
 * runs and the orchestrator returns early without rendering the report or
 * annotating any Plan_Document.
 */
export interface RunReportingInput {
  readonly audit: AuditReportData;
  /** Absolute path to the Plans_Library directory. */
  readonly plansDir: string;
  /** Auditor identity for the report and Plan_Document annotations. */
  readonly auditor: string;
  /** ISO 8601 timestamp shared by the report metadata and annotations. */
  readonly auditedAt: string;
  /**
   * Set when an earlier pass aborted. When present, the abort writer runs
   * and no other write occurs. `null` and `undefined` are equivalent.
   */
  readonly abortError?: AuditAbortError | null;
}

/**
 * Result returned by `runReporting`.
 *
 *   - `aborted`        — `true` when the abort writer ran (no report, no
 *                        annotations).
 *   - `reportPath`     — Absolute path to the rendered report on success;
 *                        `null` when aborted or pre-validation threw.
 *   - `plansAnnotated` — Count of Plan_Documents successfully annotated.
 *                        `0` on the abort path.
 *   - `abortPath`      — Absolute path to `ABORT.md` when written; `null`
 *                        otherwise.
 */
export interface RunReportingResult {
  readonly aborted: boolean;
  readonly reportPath: string | null;
  readonly plansAnnotated: number;
  readonly abortPath: string | null;
}

// ---------------------------------------------------------------------------
// Constants — shape invariants enforced before any write
// ---------------------------------------------------------------------------

/** Filename of the consolidated Audit_Report deliverable (Requirement 1.1). */
const AUDIT_REPORT_FILENAME = 'PRODUCTION_READINESS_AUDIT.md' as const;

/** Subdirectory under `plansDir` for Pass 2 evidence and the ABORT marker. */
const EVIDENCE_DIRNAME = '.audit-evidence' as const;

/** Filename of the abort marker written when an earlier pass aborts. */
const ABORT_MARKER_FILENAME = 'ABORT.md' as const;

/** Required cardinalities (Requirements 2.2, 4.2, 9.1). */
const REQUIRED_PLAN_COUNT = 7 as const;
const REQUIRED_NETWORK_ICON_COUNT = 8 as const;
const REQUIRED_THRESHOLD_COUNT = 8 as const;

/**
 * Shape of `Network_Icon.target_filename` (Requirement 4.6 / Property 8).
 * Property 8's regex is mirrored verbatim so the orchestrator's pre-write
 * check is byte-equivalent to the property-test assertion.
 */
const NETWORK_ICON_FILENAME_REGEX = /^network-[a-z0-9-]+\.svg$/;

/**
 * Required `Network_Icon.target_directory` prefix (Requirement 4.7 /
 * Property 8). Every entry's target directory must start with this string.
 */
const NETWORK_ICON_DIRECTORY_PREFIX = 'apps/consumer-app/' as const;

/** Allowed `Plan_Score.disposition` values (Requirement 2.4 / 2.5). */
const ALLOWED_DISPOSITIONS: ReadonlySet<string> = new Set<string>([
  'updated',
  'superseded',
]);

/**
 * Plan_Score score floor (rubric pass threshold). Below this, a tagged
 * `GapNote` is required for the corresponding dimension (Requirement 2.7 /
 * Property 5).
 */
const PLAN_SCORE_PASS_THRESHOLD = 85 as const;

/** The five rubric dimension keys, in canonical order. */
const RUBRIC_DIMENSIONS: readonly RubricDimension[] = [
  'security',
  'code_quality',
  'ux_polish',
  'performance',
  'production_readiness',
];

// ---------------------------------------------------------------------------
// Validation — runs before any byte is written
//
// These checks are the in-memory equivalents of the Pass 4 PBT properties
// (1, 2, 3, 5, 8, 12, 13, etc.). They are intentionally structural so the
// orchestrator can fail fast on a bad `AuditReportData` rather than emit
// a half-rendered report that the property tests would later flag.
// ---------------------------------------------------------------------------

/**
 * Run every structural property check against the in-memory audit. Throws
 * a single descriptive `Error` on the first failure so the orchestrator
 * aborts before opening any file for write.
 */
function validateAuditReportData(audit: AuditReportData): void {
  // Property 15 / Requirement 2.1 — Scoring_Rubric shape.
  const rubricResult = validateScoringRubric(audit.scoring_rubric);
  if (!rubricResult.ok) {
    throw new Error(
      `runReporting: Scoring_Rubric validation failed: ${rubricResult.reason}`,
    );
  }

  // Property 3 / Requirements 1.6, 6.3 — every Vulnerability_Finding is
  // well-formed.
  audit.security_findings_list.forEach((finding, index) => {
    if (!validateVulnerabilityFinding(finding)) {
      const id = (finding as Vulnerability_Finding | undefined)?.id ?? '<missing id>';
      throw new Error(
        `runReporting: Vulnerability_Finding[${index}] (id=${id}) is not well-formed`,
      );
    }
  });

  // Property 2 / Requirement 1.5 — executive summary <= 500 words.
  const summaryWords = countWords(audit.executive_summary);
  if (summaryWords > EXECUTIVE_SUMMARY_WORD_LIMIT) {
    throw new Error(
      `runReporting: executive_summary exceeds ${EXECUTIVE_SUMMARY_WORD_LIMIT}-word budget (got ${summaryWords})`,
    );
  }

  // Property 12 / Requirement 9.1 — eight Production_Readiness_Threshold rows.
  if (audit.production_readiness_thresholds.length !== REQUIRED_THRESHOLD_COUNT) {
    throw new Error(
      `runReporting: production_readiness_thresholds must have exactly ${REQUIRED_THRESHOLD_COUNT} rows (got ${audit.production_readiness_thresholds.length})`,
    );
  }

  // Property 13 / Requirement 9.10 — verdict is the conjunction of every
  // threshold row's pass field.
  const expectedVerdict = computeVerdict(audit.production_readiness_thresholds);
  if (expectedVerdict !== audit.verdict) {
    throw new Error(
      `runReporting: verdict mismatch — computed ${expectedVerdict} from thresholds but audit.verdict is ${audit.verdict}`,
    );
  }

  // Property 8 / Requirements 4.2, 4.6, 4.7, 4.9 — Network_Icon set.
  validateNetworkIcons(audit.network_icon_replacement_plan);

  // Property 5 / Requirements 2.2, 2.6, 2.7 — Plan_Score table.
  validatePlanScores(audit.plans_library_refresh);
}

/**
 * Validate the Network_Icon Replacement Plan against Property 8 /
 * Requirements 4.2, 4.6, 4.7, 4.9.
 *
 *   - Exactly eight entries.
 *   - Every `target_filename` matches `^network-[a-z0-9-]+\.svg$`.
 *   - Every `target_directory` starts with `apps/consumer-app/`.
 *   - Every entry has `license_compatible === true` OR a non-null
 *     `fallback_action` (the "licensed-or-gapped" rule).
 */
function validateNetworkIcons(icons: readonly Network_Icon[]): void {
  if (icons.length !== REQUIRED_NETWORK_ICON_COUNT) {
    throw new Error(
      `runReporting: network_icon_replacement_plan must have exactly ${REQUIRED_NETWORK_ICON_COUNT} entries (got ${icons.length})`,
    );
  }
  icons.forEach((icon, index) => {
    if (!NETWORK_ICON_FILENAME_REGEX.test(icon.target_filename)) {
      throw new Error(
        `runReporting: network_icon_replacement_plan[${index}].target_filename ${JSON.stringify(icon.target_filename)} does not match ${NETWORK_ICON_FILENAME_REGEX.source}`,
      );
    }
    if (!icon.target_directory.startsWith(NETWORK_ICON_DIRECTORY_PREFIX)) {
      throw new Error(
        `runReporting: network_icon_replacement_plan[${index}].target_directory ${JSON.stringify(icon.target_directory)} does not start with ${NETWORK_ICON_DIRECTORY_PREFIX}`,
      );
    }
    const licensed = icon.license_compatible === true;
    const gapped = icon.fallback_action !== null;
    if (!licensed && !gapped) {
      throw new Error(
        `runReporting: network_icon_replacement_plan[${index}] (chain_slug=${icon.chain_slug}) is neither license-compatible nor accompanied by a fallback_action`,
      );
    }
  });
}

/**
 * Validate the Plans_Library Refresh table against Property 5 /
 * Requirements 2.2, 2.6, 2.7.
 *
 *   - Exactly seven entries (one per canonical Plan_Document).
 *   - Every `disposition` is one of {`updated`, `superseded`}.
 *   - Every score is an integer in 0..100.
 *   - Every dimension below the rubric pass threshold (85) carries at
 *     least one tagged `GapNote` for that dimension.
 */
function validatePlanScores(plans: readonly Plan_Score[]): void {
  if (plans.length !== REQUIRED_PLAN_COUNT) {
    throw new Error(
      `runReporting: plans_library_refresh must have exactly ${REQUIRED_PLAN_COUNT} entries (got ${plans.length})`,
    );
  }
  plans.forEach((plan, index) => {
    if (!ALLOWED_DISPOSITIONS.has(plan.disposition)) {
      throw new Error(
        `runReporting: plans_library_refresh[${index}].disposition ${JSON.stringify(plan.disposition)} must be one of updated, superseded`,
      );
    }
    for (const dimension of RUBRIC_DIMENSIONS) {
      const score = plan.scores[dimension];
      if (
        typeof score !== 'number' ||
        !Number.isInteger(score) ||
        score < 0 ||
        score > 100
      ) {
        throw new Error(
          `runReporting: plans_library_refresh[${index}].scores.${dimension} must be an integer in 0..100 (got ${score})`,
        );
      }
      if (score < PLAN_SCORE_PASS_THRESHOLD) {
        const hasMatchingGap = plan.gaps.some((gap) => gap.dimension === dimension);
        if (!hasMatchingGap) {
          throw new Error(
            `runReporting: plans_library_refresh[${index}] dimension ${dimension} scored ${score} (< ${PLAN_SCORE_PASS_THRESHOLD}) but has no GapNote`,
          );
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Abort writer — runs when an earlier pass threw AuditAbortError
// ---------------------------------------------------------------------------

/**
 * Render the body of `<plansDir>/.audit-evidence/ABORT.md`. Pure function
 * so the integration test in task 6.6 can assert the bytes verbatim.
 *
 * The body uses the format documented in the task notes:
 *
 *   ```
 *   # Audit Aborted
 *
 *   - Command: <command>
 *   - Exit code: <exitCode>
 *   - Captured at: <capturedAt>
 *
 *   ## Output Tail
 *   ```
 *   <outputTail joined with newlines>
 *   ```
 *   ```
 *
 * The `Output Tail` block uses a triple-backtick fence — the renderer is
 * not Markdown-aware, but the file is consumed by humans reading it in a
 * Markdown viewer (GitHub, VS Code) and the fence keeps the captured
 * stderr from being interpreted as Markdown headings or lists.
 */
export function buildAbortMarkdown(error: AuditAbortError): string {
  const lines: string[] = [
    '# Audit Aborted',
    '',
    `- Command: ${error.command}`,
    `- Exit code: ${error.exitCode}`,
    `- Captured at: ${error.capturedAt}`,
    '',
    '## Output Tail',
    '',
    '```',
    ...error.outputTail,
    '```',
    '',
  ];
  return lines.join('\n');
}

/**
 * Write `<plansDir>/.audit-evidence/ABORT.md` atomically. Returns the
 * absolute path to the written marker.
 *
 * Atomicity: writes to a sibling `.tmp` file, then `fs.rename`s into place.
 * `fs.rename` on the same filesystem is atomic on Windows and POSIX, so
 * observers of `ABORT.md` either see the previous file (or no file) or
 * the fully written marker — never a partial write.
 */
async function writeAbortMarker(
  plansDir: string,
  error: AuditAbortError,
): Promise<string> {
  const evidenceDir = path.join(plansDir, EVIDENCE_DIRNAME);
  await fs.mkdir(evidenceDir, { recursive: true });

  const abortPath = path.join(evidenceDir, ABORT_MARKER_FILENAME);
  const tmpPath = `${abortPath}.tmp`;
  const body = buildAbortMarkdown(error);
  await fs.writeFile(tmpPath, body, 'utf8');
  await fs.rename(tmpPath, abortPath);
  return abortPath;
}

// ---------------------------------------------------------------------------
// Report writer + plan annotator — only run on the success path
// ---------------------------------------------------------------------------

/**
 * Write the rendered Audit_Report atomically to
 * `<plansDir>/PRODUCTION_READINESS_AUDIT.md`. Returns the absolute path.
 */
async function writeAuditReport(
  plansDir: string,
  body: string,
): Promise<string> {
  const reportPath = path.join(plansDir, AUDIT_REPORT_FILENAME);
  const tmpPath = `${reportPath}.tmp`;
  await fs.writeFile(tmpPath, body, 'utf8');
  await fs.rename(tmpPath, reportPath);
  return reportPath;
}

/**
 * Annotate every Plan_Document referenced by the Plans_Library Refresh
 * table. Each `Plan_Score.plan_path` is workspace-relative (e.g.,
 * `plans/ROADMAP.md`); the workspace root is the parent directory of
 * `plansDir`. Returns the count of successful annotations.
 *
 * Annotations are applied serially so a mid-pass failure leaves a
 * deterministic prefix of plans annotated. The error propagates to the
 * caller — the Pass 4 design treats annotation as part of the same
 * deliverable as the report, so any annotation failure surfaces loudly
 * rather than being swallowed.
 */
async function annotateAllPlans(
  plansDir: string,
  plans: readonly Plan_Score[],
  auditedAt: string,
  auditor: string,
): Promise<number> {
  // Workspace root is the parent of `plansDir` (e.g., `plansDir =
  // "d:/Veilpay/plans"` → workspaceRoot = `"d:/Veilpay"`). Plan_Score
  // `plan_path` values are workspace-relative POSIX paths like
  // `plans/ROADMAP.md`, so resolution is `join(workspaceRoot, plan_path)`.
  const workspaceRoot = path.dirname(plansDir);
  let annotated = 0;
  for (const planScore of plans) {
    const planPath = path.join(workspaceRoot, planScore.plan_path);
    await annotatePlan({
      planPath,
      planScore,
      auditedAt,
      auditor,
    });
    annotated += 1;
  }
  return annotated;
}

// ---------------------------------------------------------------------------
// Public orchestrator
// ---------------------------------------------------------------------------

/**
 * Pass 4 orchestrator. Either writes the abort marker (when an earlier
 * pass threw `AuditAbortError`) or writes the consolidated report and
 * annotates every Plan_Document.
 *
 * Order of operations on the success path:
 *
 *   1. `validateAuditReportData(audit)` — every structural property check
 *      runs first. A failure throws before any write.
 *   2. `mkdir -p <plansDir>/.audit-evidence` so subsequent evidence
 *      writes (Pass 2 already wrote here, but this is idempotent and
 *      ensures the directory exists for callers that drove this pass
 *      out-of-band, e.g., tests).
 *   3. `annotatePlan` runs for every `Plan_Score` in
 *      `audit.plans_library_refresh`.
 *   4. The rendered report is written LAST via temp-file + rename so an
 *      interrupted run never publishes a partial deliverable.
 *
 * Step 4 is intentionally last: if any of the property checks or plan
 * annotations fail, the report is not written and the previous report
 * (if any) remains in place. This matches the Pass 4 design's
 * "abort on property failure" guarantee.
 *
 * On the abort path, no report is written and no Plan_Document is
 * annotated. The `aborted: true` result lets the CLI surface the cause
 * back to the operator.
 *
 * Validates Requirements 1.1, 2.3, 2.4, 2.5, 3.6, 10.1, 10.2, 10.3, 10.4.
 */
export async function runReporting(
  input: RunReportingInput,
): Promise<RunReportingResult> {
  // Abort path — earlier pass threw AuditAbortError. Skip both the report
  // write and every Plan_Document annotation per Requirements 10.2/10.3.
  if (input.abortError != null && isAuditAbortError(input.abortError)) {
    const abortPath = await writeAbortMarker(input.plansDir, input.abortError);
    return {
      aborted: true,
      reportPath: null,
      plansAnnotated: 0,
      abortPath,
    };
  }

  // Success path — validate the in-memory audit BEFORE any byte is written.
  validateAuditReportData(input.audit);

  // Render the report up front so any contract violation in the renderer
  // (e.g., ISO 8601 timestamp drift) throws before any write touches disk.
  const reportBody = renderAuditReport(input.audit);

  // Ensure the evidence directory exists. Pass 2 already creates it, but
  // making this idempotent here lets callers drive Pass 4 in isolation
  // (the integration test in task 6.6 does exactly this).
  const evidenceDir = path.join(input.plansDir, EVIDENCE_DIRNAME);
  await fs.mkdir(evidenceDir, { recursive: true });

  // Annotate Plan_Documents first, then write the report last. The Pass 4
  // design specifies the report write is the final step so a failure mid-
  // annotation leaves the prior report in place.
  const plansAnnotated = await annotateAllPlans(
    input.plansDir,
    input.audit.plans_library_refresh,
    input.auditedAt,
    input.auditor,
  );

  const reportPath = await writeAuditReport(input.plansDir, reportBody);

  return {
    aborted: false,
    reportPath,
    plansAnnotated,
    abortPath: null,
  };
}
