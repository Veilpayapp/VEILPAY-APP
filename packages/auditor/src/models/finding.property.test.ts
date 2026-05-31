/**
 * Property-based test for `Vulnerability_Finding` well-formedness.
 *
 * Feature: production-readiness-audit, Property 3:
 *   For any `Vulnerability_Finding` recorded in the `Security_Findings_List`,
 *   the entry SHALL contain non-empty values for `id`, `title`,
 *   `severity` ∈ {Critical, High, Medium, Low}, `location.path`,
 *   `description`, `remediation`, and `remediation_owner`; and
 *   `location.lines` SHALL be present if and only if the finding pinpoints
 *   specific lines.
 *
 * Validates: Requirements 1.6, 6.3
 *
 * Strategy:
 *   - Two `fast-check` arbitraries produce `Vulnerability_Finding` values:
 *     `arbFileScopeFinding` produces file-scope findings whose
 *     `location.lines` is always `null`, and `arbLineScopedFinding`
 *     produces line-scoped findings whose `location.lines` always
 *     matches `^L\d+(-L\d+)?$`. Together they cover the iff arm.
 *   - The property asserts (a) the runtime guard
 *     `validateVulnerabilityFinding` accepts every generated value, and
 *     (b) every required field is non-empty + every constrained field
 *     matches its design contract.
 *   - Default fast-check run count (100) is sufficient — the input space
 *     is small and well-shaped.
 */

import * as fc from 'fast-check';

import {
  FINDING_LINES_PATTERN,
  SEVERITY_LEVELS,
  validateVulnerabilityFinding,
} from './finding.guards';
import type { Severity, Vulnerability_Finding } from './index';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Non-empty string arbitrary used for prose-bearing fields (`title`,
 * `description`, etc.). A minimum length of 1 is enforced so the property
 * test exercises the same lower bound the runtime guard checks. The
 * generated alphabet is intentionally narrow because the renderer treats
 * these strings opaquely — the property is "non-empty", not "ASCII".
 */
const arbNonEmptyText: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter((s) => s.length > 0);

/**
 * Arbitrary that produces sequential, zero-padded `VULN-####` ids. The
 * Pass 3 synthesizer assigns ids of this shape (`design.md` "Pass 3 →
 * Vulnerability_Finding synthesizer"); using the same shape here keeps
 * the property under test true to the production code path.
 */
const arbFindingId: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 9999 })
  .map((n) => `VULN-${n.toString().padStart(4, '0')}`);

/**
 * Severity arbitrary drawn from the four levels fixed by Requirement 6.2.
 * Pulled from the `SEVERITY_LEVELS` constant so the test and the runtime
 * guard share a single source of truth.
 */
const arbSeverity: fc.Arbitrary<Severity> = fc.constantFrom<Severity>(
  ...SEVERITY_LEVELS,
);

/**
 * Repository-relative path arbitrary. Restricted to a small alphabet so
 * generated paths look like real file paths and do not include path
 * separators that the runtime guard does not care about. The property
 * only requires `path` to be a non-empty string, so this generator
 * stays simple.
 */
const arbRepoPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('apps/backend', 'apps/consumer-app', 'apps/frontend', 'apps/indexer', 'packages/auditor'),
    fc.string({ minLength: 1, maxLength: 32 }).map((s) => s.replace(/[^A-Za-z0-9_-]/g, '') || 'file'),
    fc.constantFrom('.ts', '.tsx', '.js', '.json'),
  )
  .map(([prefix, name, ext]) => `${prefix}/src/${name}${ext}`);

/**
 * Line-range arbitrary matching the `^L\d+(-L\d+)?$` regex enforced by
 * `FINDING_LINES_PATTERN`. Either a single line (`L42`) or an inclusive
 * range where `end >= start` (`L42-L58`).
 */
const arbLineRange: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 0, max: 200 }))
  .map(([start, span]) => (span === 0 ? `L${start}` : `L${start}-L${start + span}`));

/**
 * Common fields shared by file-scope and line-scoped finding arbitraries.
 * Built once and spread into each shape so the two generators differ
 * only in the `location.lines` value.
 */
function commonFindingFields(): fc.Arbitrary<Omit<Vulnerability_Finding, 'location'>> {
  return fc.record({
    id: arbFindingId,
    title: arbNonEmptyText,
    severity: arbSeverity,
    description: arbNonEmptyText,
    remediation: arbNonEmptyText,
    remediation_owner: fc.constantFrom('backend', 'consumer-app', 'frontend', 'indexer', 'platform'),
    references: fc.array(
      fc.webUrl({ validSchemes: ['https'] }),
      { minLength: 0, maxLength: 4 },
    ),
  });
}

/**
 * File-scope finding arbitrary. `location.lines` is always `null`,
 * exercising the "no specific lines" arm of the Requirement 1.6 iff.
 */
const arbFileScopeFinding: fc.Arbitrary<Vulnerability_Finding> = fc
  .tuple(commonFindingFields(), arbRepoPath)
  .map(([common, path]) => ({
    ...common,
    location: { path, lines: null },
  }));

/**
 * Line-scoped finding arbitrary. `location.lines` is always a non-null
 * string matching `FINDING_LINES_PATTERN`, exercising the "pinpoints
 * specific lines" arm.
 */
const arbLineScopedFinding: fc.Arbitrary<Vulnerability_Finding> = fc
  .tuple(commonFindingFields(), arbRepoPath, arbLineRange)
  .map(([common, path, lines]) => ({
    ...common,
    location: { path, lines },
  }));

/**
 * Convenience arbitrary that flips a coin between the two arms so a single
 * property body can assert the disjunction without duplicating shape code.
 */
const arbVulnerabilityFinding: fc.Arbitrary<Vulnerability_Finding> = fc.oneof(
  arbFileScopeFinding,
  arbLineScopedFinding,
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Vulnerability_Finding well-formedness (Property 3)', () => {
  it('every generated finding satisfies the runtime guard and structural invariants', () => {
    fc.assert(
      fc.property(arbVulnerabilityFinding, (finding) => {
        // Runtime guard accepts every well-formed finding. If this fails,
        // the guard or the generator drifted from Requirement 6.3.
        expect(validateVulnerabilityFinding(finding)).toBe(true);

        // Required non-empty string fields (Requirement 6.3).
        expect(finding.id.length).toBeGreaterThan(0);
        expect(finding.title.length).toBeGreaterThan(0);
        expect(finding.description.length).toBeGreaterThan(0);
        expect(finding.remediation.length).toBeGreaterThan(0);
        expect(finding.remediation_owner.length).toBeGreaterThan(0);
        expect(finding.location.path.length).toBeGreaterThan(0);

        // Severity is in the closed set fixed by Requirement 6.2.
        expect(SEVERITY_LEVELS).toContain(finding.severity);

        // Iff clause from Requirement 1.6: lines is non-null exactly when
        // the finding pinpoints lines, in which case it matches the
        // documented regex.
        if (finding.location.lines === null) {
          // File-scope finding — nothing more to assert beyond the null.
          expect(finding.location.lines).toBeNull();
        } else {
          expect(typeof finding.location.lines).toBe('string');
          expect(finding.location.lines).toMatch(FINDING_LINES_PATTERN);
        }
      }),
    );
  });

  it('rejects findings with empty required fields', () => {
    // Counter-arbitrary: same shape, but `title` is an empty string.
    const arbBadFinding = arbVulnerabilityFinding.map((finding) => ({
      ...finding,
      title: '',
    }));

    fc.assert(
      fc.property(arbBadFinding, (finding) => {
        expect(validateVulnerabilityFinding(finding)).toBe(false);
      }),
    );
  });

  it('rejects findings whose location.lines violates the L<n>(-L<m>)? shape', () => {
    const arbBadLines = fc.oneof(
      fc.constant('42'),
      fc.constant('L'),
      fc.constant('lines 1-10'),
      fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !FINDING_LINES_PATTERN.test(s)),
    );

    fc.assert(
      fc.property(arbLineScopedFinding, arbBadLines, (finding, badLines) => {
        const corrupted: Vulnerability_Finding = {
          ...finding,
          location: { ...finding.location, lines: badLines },
        };
        expect(validateVulnerabilityFinding(corrupted)).toBe(false);
      }),
    );
  });

  it('rejects findings with a severity outside {Critical, High, Medium, Low}', () => {
    const arbBadSeverity = fc
      .string({ minLength: 1, maxLength: 16 })
      .filter((s) => !(SEVERITY_LEVELS as readonly string[]).includes(s));

    fc.assert(
      fc.property(arbVulnerabilityFinding, arbBadSeverity, (finding, badSeverity) => {
        const corrupted = {
          ...finding,
          severity: badSeverity as unknown as Severity,
        };
        expect(validateVulnerabilityFinding(corrupted)).toBe(false);
      }),
    );
  });
});
