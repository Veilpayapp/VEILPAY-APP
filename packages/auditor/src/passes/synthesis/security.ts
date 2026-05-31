/**
 * Pass 3 — Synthesis: Vulnerability_Finding builder.
 *
 * Pure function that transforms Pass 2 evidence (secret matches, backend
 * log matches, RPC exposure matches, pnpm advisories, route-policy
 * results) into the canonical `Vulnerability_Finding[]` consumed by the
 * Pass 4 renderer's Security_Findings_List section.
 *
 * The synthesizer is intentionally pure (no I/O, no clock, no
 * randomness) so it can be tested with `fast-check` against the
 * Property 4 (evidence-to-finding traceability) test in task 4.4.
 *
 * Severity floor table — mirrors the design.md "Security audit
 * component" table:
 *
 *   | Source                                | Floor    |
 *   | ------------------------------------- | -------- |
 *   | Plaintext secret hit (any kind)       | Critical |
 *   | Mnemonic-shaped secret hit            | Critical |
 *   | Backend log: token-shaped value       | Critical |
 *   | Backend log: Authorization header     | High     |
 *   | Backend log: full request body        | High     |
 *   | Webhook signature/timestamp missing   | High     |
 *   | Auth boundary missing on merchant/    |          |
 *   |   invoice/admin route                 | Critical |
 *   | Scope/role/tenant check missing       | High     |
 *   | Schema validation missing             | Medium   |
 *   | Rate-limiting missing                 | Medium   |
 *   | Permissive CORS                       | Medium   |
 *   | JWT alg/ttl/refresh missing           | High     |
 *   | RPC credential exposed in client      | High     |
 *   | pnpm advisory High                    | High     |
 *   | pnpm advisory Critical                | Critical |
 *   | pnpm advisory Moderate                | Medium   |
 *   | pnpm advisory other                   | Low      |
 *
 * pnpm advisories are filtered to severity High and Critical only per
 * Requirement 6.8; Moderate and Low advisories are dropped here so the
 * Security_Findings_List does not balloon with informational rows.
 *
 * `id` assignment: drafts are appended in a fixed source order
 * (secrets → logs → routes → pnpm → rpc) and then receive sequential
 * `VULN-####` ids zero-padded to 4 digits. The ordering is stable so
 * downstream renderers and snapshot tests do not see id churn between
 * runs that differ only in evidence ordering.
 *
 * Validates Requirements 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11,
 * 6.12, 6.13.
 */

import type { Severity, Vulnerability_Finding } from '../../models';
import type { PnpmAdvisory } from '../staticAnalysis/probes';
import type {
  RouteCheckKind,
  RouteCheckResult,
} from '../staticAnalysis/routes';
import type {
  LogMatch,
  LogScanReason,
  RpcMatch,
  SecretMatch,
  SecretMatchKind,
} from '../staticAnalysis/security';

// =====================================================================
// Public input shape
// =====================================================================

/**
 * Aggregate Pass 2 evidence consumed by `buildSecurityFindings`.
 *
 * `secretMatches` and `pnpmAdvisories` accept the literal `'unmeasured'`
 * sentinel because the underlying probes (gitleaks, `pnpm audit`) can
 * soft-fail per the design's Error Handling rules. When either bucket is
 * `'unmeasured'`, the synthesizer simply skips it — no findings are
 * fabricated, and the rest of the inputs continue to flow through.
 *
 * The remaining buckets (`logMatches`, `rpcMatches`, `routeResults`) are
 * always arrays because their probes degrade to "no matches" rather than
 * "unmeasured" (a missing backend tree, for example, just yields `[]`).
 */
export interface SecurityFindingsInput {
  readonly secretMatches: readonly SecretMatch[] | 'unmeasured';
  readonly logMatches: readonly LogMatch[];
  readonly rpcMatches: readonly RpcMatch[];
  readonly pnpmAdvisories: readonly PnpmAdvisory[] | 'unmeasured';
  readonly routeResults: readonly RouteCheckResult[];
}

// =====================================================================
// Public entry point
// =====================================================================

/**
 * Transform Pass 2 evidence into a normalized `Vulnerability_Finding[]`.
 *
 * Steps:
 *   1. Iterate evidence buckets in a fixed order (secrets → logs →
 *      routes → pnpm → rpc) and synthesize one or more partial finding
 *      drafts per evidence entry. Each draft carries every field of
 *      `Vulnerability_Finding` except the `id`.
 *   2. Drop drafts that should not surface (e.g., pnpm advisories below
 *      the High floor, route checks that passed).
 *   3. Assign sequential zero-padded ids `VULN-0001`, `VULN-0002`, …
 *      and freeze the result.
 *
 * The function is pure — no calls to `fs`, `Date.now()`, or any global
 * state — so callers can freely memoize it and property tests can
 * reproduce its output deterministically given identical inputs.
 *
 * @param input - Pass 2 evidence aggregated by the orchestrator.
 * @returns Frozen, ordered list of well-formed `Vulnerability_Finding`s.
 */
export function buildSecurityFindings(
  input: SecurityFindingsInput,
): readonly Vulnerability_Finding[] {
  const drafts: Array<Omit<Vulnerability_Finding, 'id'>> = [];

  // 1. Plaintext secret hits → Critical (Requirements 6.4, 6.13).
  if (input.secretMatches !== 'unmeasured') {
    for (const match of input.secretMatches) {
      drafts.push(buildSecretDraft(match));
    }
  }

  // 2. Backend log scanner hits — token-shaped → Critical, Authorization
  //    and request-body → High (Requirement 6.5).
  for (const match of input.logMatches) {
    drafts.push(buildLogDraft(match));
  }

  // 3. Route policy results → severity floor by check kind. Only failed
  //    checks become findings — passing checks are evidence of
  //    compliance and do not need a Vulnerability_Finding row.
  //    (Requirements 6.6, 6.7, 6.9, 6.10, 6.11.)
  for (const result of input.routeResults) {
    if (result.pass) {
      continue;
    }
    drafts.push(buildRouteDraft(result));
  }

  // 4. pnpm advisories — filter to High/Critical only (Requirement 6.8).
  if (input.pnpmAdvisories !== 'unmeasured') {
    for (const advisory of input.pnpmAdvisories) {
      const severity = mapPnpmSeverity(advisory.severity);
      if (severity !== 'High' && severity !== 'Critical') {
        continue;
      }
      drafts.push(buildPnpmDraft(advisory, severity));
    }
  }

  // 5. RPC credential exposure in client bundles → High
  //    (Requirement 6.12).
  for (const match of input.rpcMatches) {
    drafts.push(buildRpcDraft(match));
  }

  // Assign sequential ids and freeze. The order in which drafts were
  // pushed above is the source order of the rendered list, so the
  // first secret hit is always VULN-0001, the first log hit comes
  // immediately after, and so on.
  return drafts.map((draft, index) =>
    Object.freeze({
      id: formatFindingId(index + 1),
      ...draft,
    }),
  );
}

// =====================================================================
// Helpers — id formatting
// =====================================================================

/**
 * Format a positive integer as a zero-padded `VULN-####` id. The pad
 * width of four matches the design ("VULN-0001 …") and accommodates
 * up to 9999 findings before the prefix would visually shift.
 */
function formatFindingId(seq: number): string {
  return `VULN-${String(seq).padStart(4, '0')}`;
}

// =====================================================================
// Helpers — secret matches (Requirements 6.4, 6.13)
// =====================================================================

/**
 * Title strings per `SecretMatchKind`. Phrased as audit-document
 * headings ("X detected in Y") so the rendered Markdown reads cleanly.
 */
const SECRET_TITLES: Readonly<Record<SecretMatchKind, string>> = {
  gitleaks: 'Plaintext secret detected by gitleaks',
  'private-key': 'Plaintext private key detected in committed source',
  mnemonic: 'Plaintext mnemonic detected in committed source',
  'jwt-secret': 'Plaintext JWT secret detected in committed source',
  'aws-key': 'AWS-style key detected in committed source',
  hex64: '64-character hex literal detected in committed source',
};

/**
 * Build a draft Vulnerability_Finding from a secret-scan match.
 *
 * Severity is `Critical` for every kind — including `mnemonic` per
 * Requirement 6.13 (the criterion explicitly fixes mnemonic mishandling
 * at Critical). The location encodes the 1-indexed line number as
 * `L<n>` so the file-vs-lines invariant in `validateVulnerabilityFinding`
 * accepts the result.
 */
function buildSecretDraft(
  match: SecretMatch,
): Omit<Vulnerability_Finding, 'id'> {
  return {
    title: SECRET_TITLES[match.kind],
    severity: 'Critical',
    location: { path: match.path, lines: `L${match.lineNumber}` },
    description: `Pass 2 secret-scan probe (${match.kind}) flagged a committed value: ${match.preview}`,
    remediation:
      'Rotate the leaked credential immediately, remove the value from the repository (including git history), and replace the literal with an environment-variable lookup or secret-store reference.',
    remediation_owner: 'platform',
    references: [],
  };
}

// =====================================================================
// Helpers — backend log matches (Requirement 6.5)
// =====================================================================

/**
 * Severity floor per log-scan reason. `token-shaped` is the only
 * reason that escalates to `Critical` because the matched argument is
 * itself a secret literal (token / secret / password / mnemonic /
 * privateKey / signature). The other two reasons describe values that
 * are sensitive but not always secret-bearing.
 */
const LOG_REASON_SEVERITY: Readonly<Record<LogScanReason, Severity>> = {
  'token-shaped': 'Critical',
  authorization: 'High',
  'request-body': 'High',
};

const LOG_REASON_TITLE: Readonly<Record<LogScanReason, string>> = {
  'token-shaped': 'Backend log statement references token-shaped value',
  authorization: 'Backend log statement references Authorization header',
  'request-body': 'Backend log statement references request body',
};

const LOG_REASON_REMEDIATION: Readonly<Record<LogScanReason, string>> = {
  'token-shaped':
    'Remove or redact the token-shaped value from the log statement; use a structured logger with a redaction allow-list so future calls cannot reintroduce the leak.',
  authorization:
    'Remove the Authorization header reference from the log statement; redact at the logger boundary or omit the header entirely from log fields.',
  'request-body':
    'Stop logging req.body / request.body; emit a metadata projection (path, method, status) instead so secrets in the body never reach the log sink.',
};

/**
 * Build a draft from a backend log scanner match. The line number is
 * encoded the same way as for secret matches (`L<n>`) so the
 * file-vs-lines invariant holds.
 */
function buildLogDraft(match: LogMatch): Omit<Vulnerability_Finding, 'id'> {
  return {
    title: LOG_REASON_TITLE[match.reason],
    severity: LOG_REASON_SEVERITY[match.reason],
    location: { path: match.path, lines: `L${match.lineNumber}` },
    description: `Pass 2 backend log scanner flagged a log statement (${match.reason}): ${match.preview}`,
    remediation: LOG_REASON_REMEDIATION[match.reason],
    remediation_owner: 'backend',
    references: [],
  };
}

// =====================================================================
// Helpers — route policy results (Requirements 6.6, 6.7, 6.9, 6.10, 6.11)
// =====================================================================

/**
 * Severity floor per route-policy check kind.
 *
 * `auth` is the only check that escalates to `Critical` — Requirement
 * 6.7 explicitly allows up-to-Critical for missing auth boundaries,
 * and a missing auth boundary on a merchant/invoice/admin route is
 * functionally equivalent to publishing a write endpoint to the
 * internet. Every other check sits at the floor defined by its
 * acceptance criterion.
 */
const ROUTE_CHECK_SEVERITY: Readonly<Record<RouteCheckKind, Severity>> = {
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

const ROUTE_CHECK_TITLE: Readonly<Record<RouteCheckKind, string>> = {
  'webhook-signature': 'Webhook route missing signature verification',
  'webhook-timestamp': 'Webhook route missing 5-minute timestamp window',
  auth: 'Authenticated route missing auth boundary',
  scope: 'Authenticated route missing scope or tenant check',
  'schema-validation': 'Route handler missing schema validation',
  'rate-limiting': 'Server bootstrap missing rate limiting',
  cors: 'Server bootstrap CORS configuration is permissive or missing',
  'jwt-alg': 'JWT signing algorithm not declared',
  'jwt-ttl': 'JWT TTL (expiresIn) not declared',
  'jwt-refresh': 'JWT refresh-token flow not declared',
};

const ROUTE_CHECK_REMEDIATION: Readonly<Record<RouteCheckKind, string>> = {
  'webhook-signature':
    'Register a signature-verification middleware (verifyWebhookSignature or equivalent HMAC check) before the route handler so unsigned payloads are rejected.',
  'webhook-timestamp':
    'Reject webhook payloads whose timestamp is outside a 5-minute window (300 000 ms) before invoking the handler so replayed events cannot fire state changes.',
  auth: 'Apply the authMiddleware/requireAuth middleware before the route handler so unauthenticated requests cannot reach the business logic.',
  scope:
    'Add a scope, role, or tenant-equality check (requireScope/hasRole/req.user.merchantId) before the handler runs so authenticated users cannot escalate across tenants.',
  'schema-validation':
    'Validate the request body, params, and query against a Zod, Joi, or Yup schema before the handler runs so malformed input is rejected at the boundary.',
  'rate-limiting':
    'Install express-rate-limit (or fastify-rate-limit) and register it globally in the server bootstrap so abusive clients are throttled before reaching handlers.',
  cors: 'Replace the wildcard CORS origin with an explicit allow-list of trusted origins; only the domains that actually call the API should be permitted.',
  'jwt-alg':
    'Declare an explicit asymmetric (RS256/ES256) or rotated symmetric (HS256) signing algorithm on every JWT sign call; never accept tokens signed with `alg: none`.',
  'jwt-ttl':
    'Declare an explicit expiresIn TTL on every JWT sign call so issued tokens cannot live indefinitely.',
  'jwt-refresh':
    'Implement a refresh-token flow with persistent storage and revocation; attach refresh-token issuance to the auth boundary so long-lived sessions can be invalidated.',
};

/**
 * Build a draft from a failed route-policy check. The location's
 * `path` reuses `routePath` directly: for per-route checks this is the
 * workspace-relative source file, and for aggregate checks
 * (`<bootstrap>`, `<jwt-config>`) it is the synthetic label that
 * `routes.ts` emits — both are non-empty strings, which is enough to
 * pass the `validateVulnerabilityFinding` runtime guard.
 */
function buildRouteDraft(
  result: RouteCheckResult,
): Omit<Vulnerability_Finding, 'id'> {
  return {
    title: ROUTE_CHECK_TITLE[result.check],
    severity: ROUTE_CHECK_SEVERITY[result.check],
    location: { path: result.routePath, lines: null },
    description: `Pass 2 route-policy verifier failed the ${result.check} check: ${result.reason}`,
    remediation: ROUTE_CHECK_REMEDIATION[result.check],
    remediation_owner: 'backend',
    references: [],
  };
}

// =====================================================================
// Helpers — pnpm advisories (Requirement 6.8)
// =====================================================================

/**
 * Map a pnpm-reported advisory severity string into the audit's
 * `Severity` union. The mapping is case-insensitive because pnpm v8
 * emits lowercase ("high") while v9+ sometimes emits title-case ("High").
 *
 * Anything that is neither Critical, High, nor Moderate/Medium falls
 * through to `Low` so the function is total. Note that the caller in
 * `buildSecurityFindings` further filters to High/Critical only per
 * Requirement 6.8 — this helper just classifies, it does not gate.
 */
function mapPnpmSeverity(raw: string): Severity {
  const norm = raw.toLowerCase();
  if (norm === 'critical') {
    return 'Critical';
  }
  if (norm === 'high') {
    return 'High';
  }
  if (norm === 'moderate' || norm === 'medium') {
    return 'Medium';
  }
  return 'Low';
}

/**
 * Build a draft from a pnpm advisory. The location is set to the
 * workspace `package.json` because advisories surface against the
 * dependency tree as a whole rather than a specific source line; the
 * `references` array carries the upstream advisory URL when pnpm
 * provided one.
 */
function buildPnpmDraft(
  advisory: PnpmAdvisory,
  severity: Severity,
): Omit<Vulnerability_Finding, 'id'> {
  return {
    title: `Dependency advisory (${severity}) on ${advisory.module}`,
    severity,
    location: { path: 'package.json', lines: null },
    description: `pnpm audit reported a ${severity} severity advisory affecting "${advisory.module}".`,
    remediation:
      'Upgrade or replace the affected dependency to a patched version. If no patched version is available, document the mitigation and accepted residual risk in the Audit_Report appendix.',
    remediation_owner: 'platform',
    references: advisory.advisoryUrl !== null ? [advisory.advisoryUrl] : [],
  };
}

// =====================================================================
// Helpers — RPC exposure (Requirement 6.12)
// =====================================================================

/**
 * Resolve the remediation owner for an RPC exposure match. The scanner
 * walks `apps/consumer-app/src` and `apps/frontend/src`, so every
 * `RpcMatch.path` should begin with one of those two prefixes. The
 * fallback owner is `consumer-app` because that surface ships chain
 * provider literals more often, but in practice the fallback is
 * unreachable given the scanner's roots.
 */
function rpcOwnerForPath(matchPath: string): string {
  if (matchPath.startsWith('apps/consumer-app/')) {
    return 'consumer-app';
  }
  if (matchPath.startsWith('apps/frontend/')) {
    return 'frontend';
  }
  return 'consumer-app';
}

/**
 * Build a draft from an RPC exposure match. Severity is fixed at
 * `High` per Requirement 6.12 because client-bundle exposure of an
 * RPC credential lets any user impersonate the app's chain reads /
 * writes against the provider.
 */
function buildRpcDraft(match: RpcMatch): Omit<Vulnerability_Finding, 'id'> {
  return {
    title: `RPC credential literal "${match.literal}" exposed in client bundle`,
    severity: 'High',
    location: { path: match.path, lines: `L${match.lineNumber}` },
    description: `Pass 2 RPC exposure scanner flagged a "${match.literal}" reference reaching the client bundle: ${match.preview}`,
    remediation:
      'Remove the RPC credential from the client bundle. Proxy chain calls through a backend service that holds the credential, or replace it with a public read-only endpoint that is safe to embed.',
    remediation_owner: rpcOwnerForPath(match.path),
    references: [],
  };
}
