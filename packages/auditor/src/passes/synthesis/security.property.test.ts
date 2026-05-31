/**
 * Property-based test for evidence-to-finding traceability (Property 4).
 *
 * Feature: production-readiness-audit, Property 4:
 *   For any single Pass 2 evidence entry from any of the supported
 *   sources (SecretMatch, LogMatch, RpcMatch, RouteCheckResult with
 *   pass=false, PnpmAdvisory), the Pass 3 synthesizer
 *   `buildSecurityFindings` SHALL produce a `Vulnerability_Finding` whose
 *   `location` references the evidence's path / route / module and whose
 *   `severity` meets the documented floor for that source. PnPM
 *   advisories below the High floor SHALL NOT produce a finding
 *   (Requirement 6.8).
 *
 * Validates: Requirements 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12,
 *   6.13.
 *
 * Strategy:
 *   - One `fast-check` arbitrary per evidence source. Each arbitrary
 *     generates a single, well-shaped evidence entry (e.g., a plausible
 *     `SecretMatch` or `RouteCheckResult`).
 *   - For each source, drive `buildSecurityFindings` with exactly one
 *     evidence entry at a time and assert:
 *       1. Exactly one `Vulnerability_Finding` is produced (or, for pnpm
 *          advisories filtered to High/Critical only, the count matches
 *          the severity-floor expectation).
 *       2. The finding's `location.path` references the evidence (the
 *          source file path, the route path, the synthetic
 *          `<bootstrap>`/`<jwt-config>` label, or the workspace
 *          `package.json` for pnpm advisories — whichever applies).
 *       3. The finding's `severity` matches the documented floor for
 *          that source.
 *       4. `validateVulnerabilityFinding` accepts the produced finding
 *          (so id/title/description/etc. invariants from Property 3 hold
 *          alongside Property 4's traceability claim).
 *   - Default fast-check run count (100) is sufficient — each source's
 *     input shape is small and the synthesizer is pure.
 */

import * as fc from 'fast-check';

import { validateVulnerabilityFinding } from '../../models/finding.guards';
import type { Severity, Vulnerability_Finding } from '../../models';
import type { PnpmAdvisory } from '../staticAnalysis/probes';
import type { RouteCheckKind, RouteCheckResult } from '../staticAnalysis/routes';
import type {
  LogMatch,
  LogScanReason,
  RpcLiteral,
  RpcMatch,
  SecretMatch,
  SecretMatchKind,
} from '../staticAnalysis/security';

import { buildSecurityFindings, type SecurityFindingsInput } from './security';

// ---------------------------------------------------------------------------
// Documented severity floors (mirrors design.md "Security audit component"
// table and the constant maps inside ./security.ts). Centralising these here
// keeps the property test in lockstep with the synthesizer's contract — if
// either drifts, the property fails loudly.
// ---------------------------------------------------------------------------

/** Every secret-scan kind floors at Critical (Requirements 6.4 + 6.13). */
const SECRET_SEVERITY: Severity = 'Critical';

/** Backend log scanner severity per reason (Requirement 6.5). */
const LOG_SEVERITY_BY_REASON: Readonly<Record<LogScanReason, Severity>> = {
  'token-shaped': 'Critical',
  authorization: 'High',
  'request-body': 'High',
};

/** RPC credential exposure floors at High (Requirement 6.12). */
const RPC_SEVERITY: Severity = 'High';

/** Route-policy severity per check kind (Requirements 6.6, 6.7, 6.9..6.11). */
const ROUTE_SEVERITY_BY_CHECK: Readonly<Record<RouteCheckKind, Severity>> = {
  'webhook-signature': 'High',
  'webhook-timestamp': 'High',
  auth: 'Critical',
  scope: 'High',
  'schema-validation': 'Medium',
  'rate-limiting': 'Medium',
  cors: 'Medium',
  'jwt-alg': 'High',
  'jwt-ttl': 'High',
  'jwt-refresh': 'High',
};

/**
 * The full set of route-check kinds. Used as the domain for the route
 * arbitrary so every check kind in `ROUTE_SEVERITY_BY_CHECK` is exercised
 * across the 100 default fast-check runs.
 */
const ROUTE_CHECK_KINDS = Object.keys(
  ROUTE_SEVERITY_BY_CHECK,
) as readonly RouteCheckKind[];

/**
 * The full set of secret-match kinds, mirroring `SecretMatchKind` from
 * `staticAnalysis/security.ts`. Listing them explicitly keeps this test
 * insulated from accidental enum drift in the upstream module.
 */
const SECRET_KINDS: readonly SecretMatchKind[] = [
  'gitleaks',
  'private-key',
  'mnemonic',
  'jwt-secret',
  'aws-key',
  'hex64',
];

/** Backend log scanner reasons. */
const LOG_REASONS: readonly LogScanReason[] = [
  'token-shaped',
  'authorization',
  'request-body',
];

/** RPC literals recognised by the static-analysis scanner. */
const RPC_LITERALS: readonly RpcLiteral[] = [
  'RPC_URL',
  'INFURA',
  'ALCHEMY',
  'QUICKNODE',
];

// ---------------------------------------------------------------------------
// Empty-input scaffold. Each per-source property fills in exactly one bucket
// and leaves the other four empty so the property's claim ("one entry → one
// finding") is unambiguous.
// ---------------------------------------------------------------------------

const EMPTY_INPUT: SecurityFindingsInput = {
  secretMatches: [],
  logMatches: [],
  rpcMatches: [],
  pnpmAdvisories: [],
  routeResults: [],
};

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

/**
 * Workspace-relative path arbitrary. The path generator restricts the
 * alphabet to `[A-Za-z0-9_-]` so generated paths look like real source
 * files; the synthesizer treats `path` as opaque so the exact shape only
 * matters for the assertion `finding.location.path === match.path`.
 */
const arbRepoPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(
      'apps/backend',
      'apps/consumer-app',
      'apps/frontend',
      'apps/indexer',
      'packages/shared',
    ),
    fc
      .string({ minLength: 1, maxLength: 24 })
      .map((s) => s.replace(/[^A-Za-z0-9_-]/g, '') || 'file'),
    fc.constantFrom('.ts', '.tsx', '.js', '.json'),
  )
  .map(([prefix, name, ext]) => `${prefix}/src/${name}${ext}`);

/**
 * Backend route file path arbitrary — narrower than `arbRepoPath` because
 * the route verifier's `routePath` is always a backend source file (or a
 * synthetic `<bootstrap>` / `<jwt-config>` label, which we cover in a
 * separate branch below).
 */
const arbBackendRoutePath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('webhooks', 'merchant', 'invoice', 'admin'),
    fc
      .string({ minLength: 1, maxLength: 16 })
      .map((s) => s.replace(/[^A-Za-z0-9_-]/g, '') || 'route'),
  )
  .map(([surface, name]) => `apps/backend/src/routes/${surface}/${name}.ts`);

/**
 * Client-bundle path arbitrary used for `RpcMatch.path`. The synthesizer
 * derives the remediation owner from the path prefix (`apps/consumer-app/`
 * vs `apps/frontend/`), so the generator covers both surfaces.
 */
const arbClientBundlePath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('apps/consumer-app/src', 'apps/frontend/src'),
    fc
      .string({ minLength: 1, maxLength: 16 })
      .map((s) => s.replace(/[^A-Za-z0-9_-]/g, '') || 'rpc'),
    fc.constantFrom('.ts', '.tsx'),
  )
  .map(([prefix, name, ext]) => `${prefix}/${name}${ext}`);

/** 1-indexed line numbers; the synthesizer encodes these as `L<n>`. */
const arbLineNumber: fc.Arbitrary<number> = fc.integer({ min: 1, max: 9999 });

/** Truncated preview string. Content is opaque to the synthesizer. */
const arbPreview: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 64 });

// ---------------------------------------------------------------------------
// Per-source arbitraries
// ---------------------------------------------------------------------------

/**
 * A single `SecretMatch` evidence entry. All six secret kinds are covered
 * by `fc.constantFrom` over `SECRET_KINDS`.
 */
const arbSecretMatch: fc.Arbitrary<SecretMatch> = fc.record({
  kind: fc.constantFrom<SecretMatchKind>(...SECRET_KINDS),
  path: arbRepoPath,
  lineNumber: arbLineNumber,
  preview: arbPreview,
});

/**
 * A single `LogMatch` evidence entry. `reason` drives the expected
 * severity floor (Critical for `token-shaped`, High for the other two).
 */
const arbLogMatch: fc.Arbitrary<LogMatch> = fc.record({
  path: arbRepoPath,
  lineNumber: arbLineNumber,
  preview: arbPreview,
  reason: fc.constantFrom<LogScanReason>(...LOG_REASONS),
});

/**
 * A single `RpcMatch` evidence entry. `literal` is one of the four chain
 * provider tokens recognised by the scanner; the synthesizer threads it
 * into the finding's title.
 */
const arbRpcMatch: fc.Arbitrary<RpcMatch> = fc.record({
  path: arbClientBundlePath,
  lineNumber: arbLineNumber,
  preview: arbPreview,
  literal: fc.constantFrom<RpcLiteral>(...RPC_LITERALS),
});

/**
 * A single failed `RouteCheckResult`. `pass` is fixed to `false` because
 * Property 4 only concerns evidence that becomes a finding; passing
 * checks short-circuit out of the synthesizer before any draft is
 * produced.
 *
 * `routePath` covers both real backend route paths (per-route checks)
 * and the two synthetic labels emitted by the verifier
 * (`<bootstrap>` for rate-limiting/CORS, `<jwt-config>` for the three
 * JWT checks). The synthesizer treats both forms uniformly because the
 * runtime guard only requires `path` to be a non-empty string.
 */
const arbRouteCheckResult: fc.Arbitrary<RouteCheckResult> = fc
  .tuple(
    fc.constantFrom<RouteCheckKind>(...ROUTE_CHECK_KINDS),
    fc.oneof(
      arbBackendRoutePath,
      fc.constant('<bootstrap>'),
      fc.constant('<jwt-config>'),
    ),
    fc.string({ minLength: 1, maxLength: 80 }),
  )
  .map(([check, routePath, reason]) => ({
    routePath,
    sourcePath: '',
    check,
    pass: false as const,
    reason,
  }));

/**
 * A single `PnpmAdvisory`. `severity` is drawn from a small set that
 * covers every branch in the synthesizer's mapping:
 *
 *   - `'critical'` / `'Critical'`  → emitted as Critical
 *   - `'high'`     / `'High'`      → emitted as High
 *   - `'moderate'` / `'medium'`    → filtered out (no finding)
 *   - `'low'` / arbitrary other    → filtered out (no finding)
 *
 * The arbitrary is reused by both the positive (High/Critical) and
 * negative (Moderate/Low) branches of the property below.
 */
const arbPnpmSeverityRaw: fc.Arbitrary<string> = fc.constantFrom(
  'critical',
  'Critical',
  'high',
  'High',
  'moderate',
  'medium',
  'low',
  'unknown',
);

const arbPnpmAdvisory: fc.Arbitrary<PnpmAdvisory> = fc.record({
  severity: arbPnpmSeverityRaw,
  module: fc
    .string({ minLength: 1, maxLength: 32 })
    .map((s) => s.replace(/[^A-Za-z0-9@/_-]/g, '') || 'pkg'),
  advisoryUrl: fc.option(fc.webUrl({ validSchemes: ['https'] }), { nil: null }),
  raw: fc.constant({}),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a pnpm-reported severity string to the audit `Severity` union using
 * the same case-insensitive rules the synthesizer applies internally. The
 * test reproduces the mapping rather than importing the private helper so
 * the property still detects regressions if the mapping in `./security.ts`
 * accidentally changes.
 */
function expectedPnpmSeverity(raw: string): Severity {
  const norm = raw.toLowerCase();
  if (norm === 'critical') return 'Critical';
  if (norm === 'high') return 'High';
  if (norm === 'moderate' || norm === 'medium') return 'Medium';
  return 'Low';
}

/**
 * Return the single produced finding or fail the test if the count is not
 * exactly one. Used by every "exactly one finding" branch so the failure
 * message points at the unexpected length rather than at an undefined
 * dereference downstream.
 */
function expectExactlyOne(
  findings: readonly Vulnerability_Finding[],
): Vulnerability_Finding {
  expect(findings).toHaveLength(1);
  const [finding] = findings;
  expect(finding).toBeDefined();
  // After the assertions above, the non-null assertion is safe.
  return finding as Vulnerability_Finding;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Evidence-to-finding traceability (Property 4)', () => {
  // -------------------------------------------------------------------------
  // SecretMatch — Critical (Requirements 6.4, 6.13)
  // -------------------------------------------------------------------------
  it('SecretMatch evidence produces one Critical finding referencing the secret path', () => {
    fc.assert(
      fc.property(arbSecretMatch, (match) => {
        const findings = buildSecurityFindings({
          ...EMPTY_INPUT,
          secretMatches: [match],
        });
        const finding = expectExactlyOne(findings);

        expect(finding.severity).toBe(SECRET_SEVERITY);
        expect(finding.location.path).toBe(match.path);
        expect(finding.location.lines).toBe(`L${match.lineNumber}`);
        expect(validateVulnerabilityFinding(finding)).toBe(true);
      }),
    );
  });

  // -------------------------------------------------------------------------
  // LogMatch — Critical for token-shaped, High for the other two (6.5)
  // -------------------------------------------------------------------------
  it('LogMatch evidence produces one finding at the documented severity floor', () => {
    fc.assert(
      fc.property(arbLogMatch, (match) => {
        const findings = buildSecurityFindings({
          ...EMPTY_INPUT,
          logMatches: [match],
        });
        const finding = expectExactlyOne(findings);

        expect(finding.severity).toBe(LOG_SEVERITY_BY_REASON[match.reason]);
        expect(finding.location.path).toBe(match.path);
        expect(finding.location.lines).toBe(`L${match.lineNumber}`);
        expect(validateVulnerabilityFinding(finding)).toBe(true);
      }),
    );
  });

  // -------------------------------------------------------------------------
  // RpcMatch — High (Requirement 6.12)
  // -------------------------------------------------------------------------
  it('RpcMatch evidence produces one High finding referencing the client bundle path', () => {
    fc.assert(
      fc.property(arbRpcMatch, (match) => {
        const findings = buildSecurityFindings({
          ...EMPTY_INPUT,
          rpcMatches: [match],
        });
        const finding = expectExactlyOne(findings);

        expect(finding.severity).toBe(RPC_SEVERITY);
        expect(finding.location.path).toBe(match.path);
        expect(finding.location.lines).toBe(`L${match.lineNumber}`);
        // The literal flows into the title so a security reviewer can grep
        // the rendered Audit_Report for the offending provider name.
        expect(finding.title).toContain(match.literal);
        expect(validateVulnerabilityFinding(finding)).toBe(true);
      }),
    );
  });

  // -------------------------------------------------------------------------
  // RouteCheckResult — severity floor by check kind (6.6, 6.7, 6.9..6.11)
  // -------------------------------------------------------------------------
  it('Failed RouteCheckResult evidence produces one finding at the documented severity floor', () => {
    fc.assert(
      fc.property(arbRouteCheckResult, (result) => {
        const findings = buildSecurityFindings({
          ...EMPTY_INPUT,
          routeResults: [result],
        });
        const finding = expectExactlyOne(findings);

        expect(finding.severity).toBe(ROUTE_SEVERITY_BY_CHECK[result.check]);
        // `routePath` is the route source file or one of the synthetic
        // labels (`<bootstrap>`, `<jwt-config>`); either way it is what
        // the synthesizer copies into `location.path`.
        expect(finding.location.path).toBe(result.routePath);
        // Route findings are file-scope (no line number is meaningful),
        // so `lines` must be `null` per the synthesizer's contract.
        expect(finding.location.lines).toBeNull();
        expect(validateVulnerabilityFinding(finding)).toBe(true);
      }),
    );
  });

  it('Passing RouteCheckResult evidence produces no findings', () => {
    // Negative arm of the same source: Property 4 only claims a finding
    // is emitted for evidence that should surface. A passing check is
    // evidence of compliance and must short-circuit out of the
    // synthesizer entirely.
    fc.assert(
      fc.property(arbRouteCheckResult, (failedResult) => {
        const passing: RouteCheckResult = { ...failedResult, pass: true };
        const findings = buildSecurityFindings({
          ...EMPTY_INPUT,
          routeResults: [passing],
        });
        expect(findings).toHaveLength(0);
      }),
    );
  });

  // -------------------------------------------------------------------------
  // PnpmAdvisory — High/Critical only (Requirement 6.8). Below the High
  // floor the advisory is filtered out and produces zero findings.
  // -------------------------------------------------------------------------
  it('PnpmAdvisory evidence produces a finding iff severity ≥ High, with the documented severity', () => {
    fc.assert(
      fc.property(arbPnpmAdvisory, (advisory) => {
        const findings = buildSecurityFindings({
          ...EMPTY_INPUT,
          pnpmAdvisories: [advisory],
        });

        const expected = expectedPnpmSeverity(advisory.severity);
        if (expected === 'High' || expected === 'Critical') {
          const finding = expectExactlyOne(findings);
          expect(finding.severity).toBe(expected);
          // pnpm advisories are surfaced against the workspace
          // dependency tree as a whole, so the synthesizer fixes
          // `location.path` at `package.json` and threads the module
          // name into the title and description.
          expect(finding.location.path).toBe('package.json');
          expect(finding.location.lines).toBeNull();
          expect(finding.title).toContain(advisory.module);
          expect(finding.description).toContain(advisory.module);
          expect(validateVulnerabilityFinding(finding)).toBe(true);
        } else {
          // Moderate / Low / unknown advisories are filtered per
          // Requirement 6.8 — no finding may be emitted.
          expect(findings).toHaveLength(0);
        }
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 'unmeasured' soft-failure sentinels never produce findings.
  // -------------------------------------------------------------------------
  it('"unmeasured" secret/pnpm buckets contribute zero findings', () => {
    // Drives the soft-failure branches in the synthesizer (gitleaks
    // unavailable, pnpm audit crashed). Even paired with a real evidence
    // entry in another bucket, the unmeasured bucket itself must
    // contribute nothing.
    fc.assert(
      fc.property(arbLogMatch, (match) => {
        const findings = buildSecurityFindings({
          ...EMPTY_INPUT,
          secretMatches: 'unmeasured',
          pnpmAdvisories: 'unmeasured',
          logMatches: [match],
        });
        // Exactly one finding — from the log match — and nothing from
        // the unmeasured buckets.
        const finding = expectExactlyOne(findings);
        expect(finding.severity).toBe(LOG_SEVERITY_BY_REASON[match.reason]);
        expect(finding.location.path).toBe(match.path);
      }),
    );
  });
});
