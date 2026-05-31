/**
 * Runtime guards for `Vulnerability_Finding` records.
 *
 * The Pass 4 renderer is a pure function over `AuditReportData`, but Pass 3
 * synthesizers build findings incrementally from heterogeneous Pass 2
 * evidence sources (gitleaks JSON, eslint JSON, route-walker output). The
 * guard exported from this module gives those synthesizers a single
 * runtime check they can call before handing a finding to the renderer or
 * to the property test in `finding.property.test.ts`.
 *
 * Validates Property 3 (every `Vulnerability_Finding` is well-formed) and
 * the underlying acceptance criteria:
 *
 *   - Requirement 1.6: `location.path` is repository-relative; `lines` is
 *     present only when the finding pinpoints specific lines.
 *   - Requirement 6.3: `id`, `title`, `severity`, `location`, `description`,
 *     `remediation`, and `remediation_owner` are all required fields.
 *
 * The guard is intentionally structural rather than nominal — `unknown`
 * inputs are walked field-by-field so callers can pass raw JSON parsed
 * from evidence files.
 */

import type { Severity, Vulnerability_Finding } from './index';

/**
 * The four severity levels fixed by Requirement 6.2. Exported as a
 * readonly tuple so generators (e.g., `fast-check`) can pull from the
 * same source of truth as the runtime guard.
 */
export const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low'] as const satisfies readonly Severity[];

/**
 * Regex enforced on `Vulnerability_Finding.location.lines` when the
 * finding pinpoints lines. Examples:
 *
 *   - `L42`         (single line)
 *   - `L42-L58`     (inclusive range)
 *
 * When the finding is file-scope, `location.lines` MUST be `null` —
 * the iff is enforced by `validateVulnerabilityFinding` below.
 */
export const FINDING_LINES_PATTERN = /^L\d+(-L\d+)?$/;

/**
 * Set lookup over `SEVERITY_LEVELS`. Materialized once so the guard does
 * not allocate a new `Set` per call.
 */
const SEVERITY_SET: ReadonlySet<string> = new Set<string>(SEVERITY_LEVELS);

/**
 * Type predicate: `value` is a non-empty string.
 *
 * "Non-empty" is `length > 0` per Requirement 6.3 — the guard does not
 * trim whitespace, because trimming would silently accept whitespace-only
 * strings in some languages. Pass 3 synthesizers are responsible for
 * supplying real prose.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Type predicate: `value` is a `readonly string[]`. Empty arrays are
 * accepted because `references` is allowed to be empty (a finding may
 * have no external advisory link).
 */
function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Runtime guard for `Vulnerability_Finding`.
 *
 * Returns `true` when `value` satisfies every clause of Property 3:
 *
 *   - `id`, `title`, `description`, `remediation`, `remediation_owner`
 *     are non-empty strings.
 *   - `severity` is one of {`Critical`, `High`, `Medium`, `Low`}.
 *   - `location` is an object with a non-empty string `path`.
 *   - `location.lines` is either `null` (file-scope finding) or a string
 *     matching `^L\d+(-L\d+)?$` (line-scoped finding). The iff is the
 *     combination of "non-null implies regex match" and the type system
 *     forbidding any other non-null shape.
 *   - `references` is a (possibly empty) array of strings.
 *
 * Returns `false` for any deviation. The guard never throws so callers
 * can use it on raw JSON parsed from evidence files.
 *
 * @param value - Candidate value parsed from arbitrary input.
 * @returns `true` when `value` is a well-formed `Vulnerability_Finding`.
 */
export function validateVulnerabilityFinding(
  value: unknown,
): value is Vulnerability_Finding {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (!isNonEmptyString(candidate['id'])) {
    return false;
  }
  if (!isNonEmptyString(candidate['title'])) {
    return false;
  }
  if (typeof candidate['severity'] !== 'string' || !SEVERITY_SET.has(candidate['severity'])) {
    return false;
  }
  if (!isNonEmptyString(candidate['description'])) {
    return false;
  }
  if (!isNonEmptyString(candidate['remediation'])) {
    return false;
  }
  if (!isNonEmptyString(candidate['remediation_owner'])) {
    return false;
  }
  if (!isStringArray(candidate['references'])) {
    return false;
  }

  const location = candidate['location'];
  if (typeof location !== 'object' || location === null) {
    return false;
  }
  const locationRecord = location as Record<string, unknown>;

  if (!isNonEmptyString(locationRecord['path'])) {
    return false;
  }

  const lines = locationRecord['lines'];
  if (lines === null) {
    // File-scope finding — acceptable.
  } else if (typeof lines === 'string' && FINDING_LINES_PATTERN.test(lines)) {
    // Line-scoped finding with valid `L<n>` or `L<n>-L<m>` shape.
  } else {
    return false;
  }

  return true;
}
