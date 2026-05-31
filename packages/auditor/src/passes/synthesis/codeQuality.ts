/**
 * Pass 3 — Synthesis: Code_Quality_Findings_List builder.
 *
 * Aggregates the per-target metrics produced by Pass 2 probes into the
 * `CodeQualityFindings` shape consumed by the Pass 4 renderer for the
 * Code_Quality_Findings_List section of the Audit_Report.
 *
 * This module is pure: no I/O, no clock, no randomness. Inputs are the
 * structured outputs of `passes/staticAnalysis/strictMode.ts`,
 * `passes/staticAnalysis/probes.ts`, and Pass 1 discovery. The output
 * mirrors the YAML schema in `design.md` "Audit_Report top-level structure"
 * → `code_quality_findings_list`.
 *
 * Validates Requirements 7.2..7.7 and is exercised by Property 10
 * (`Code_Quality_Findings completeness`, task 4.6).
 *
 * Per-field contract:
 *
 *   - `ts_strict_coverage` (Requirement 7.2):
 *       Direct copy of `strictCoverageByTarget`. Probes already emit
 *       integers in 0..100 or the `'unmeasured'` sentinel; the synthesizer
 *       does not re-validate the range.
 *
 *   - `eslint_counts` (Requirement 7.3):
 *       Direct copy of `eslintCountsByTarget`. Per-target `errors` and
 *       `warnings` are non-negative integers or `'unmeasured'`.
 *
 *   - `root_script_triage` (Requirement 7.4):
 *       One entry per file in `rootScripts`. The classification heuristic
 *       (see `triageRootScript`) is intentionally simple so reviewers can
 *       audit it by inspection:
 *         - `audit.js`            → `keep`    ("entry point").
 *         - `autofix.js`          → `archive` ("deprecated automation; useful for reference").
 *         - `tmp_*.js`            → `remove`  ("temporary script; promote to a proper task or delete").
 *         - anything else         → `archive` ("unrecognized root script; review and archive or delete").
 *       Each entry carries a non-empty `justification` (Property 10).
 *
 *   - `test_coverage` (Requirement 7.5):
 *       Direct copy of `coverageByTarget`. Probes already emit four
 *       percentages (statements/branches/functions/lines) per target or
 *       the `'unmeasured'` sentinel.
 *
 *   - `complexity_hotspots` (Requirement 7.6):
 *       Take `rawHotspots`, sort by `score` descending (stable on ties),
 *       take the top ten, and emit a fixed-length 10-tuple. When fewer
 *       than ten hotspots are measured, the tail is padded with
 *       sentinel rows (`path: 'unmeasured'`, `function: 'unmeasured'`,
 *       `score: 0`) so the renderer always sees ten rows. When the probe
 *       produced no measurement (`rawHotspots === 'unmeasured'`), all ten
 *       slots carry the sentinel.
 *
 *   - `duplicate_clusters` (Requirement 7.7):
 *       Filter `rawDuplicates` to clusters whose `locations` span at
 *       least two of `apps/backend`, `apps/consumer-app`, `apps/frontend`,
 *       `apps/indexer`. Assign `cluster_id = DUP-NNNN` (zero-padded,
 *       1-indexed in filtered order). Recommendation is derived from the
 *       deepest common subpath under `apps/<app>/src/` or falls back to a
 *       generic shared-package suggestion. When the probe produced no
 *       measurement, emit an empty list — there is nothing to cite.
 *
 * Out of scope:
 *   - Severity assignment (this module does not synthesize
 *     `Vulnerability_Finding` rows).
 *   - Anchoring back into the rendered Markdown (the renderer in
 *     `src/render/` owns anchor generation).
 *   - Validation of probe-provided inputs (probe wrappers already
 *     normalize to `Unmeasured` on failure).
 */

import type {
  CodeQualityFindings,
  Complexity_Hotspot,
  ComplexityHotspotList,
  CoverageSummary,
  Duplicate_Cluster,
  EslintCount,
  Score,
  ScriptTriage,
  ScriptTriageClassification,
  Unmeasured,
} from '../../models';
import { UNMEASURED } from '../../models';

// ---------------------------------------------------------------------------
// Public input shape
// ---------------------------------------------------------------------------

/**
 * One raw cyclomatic-complexity row as produced by `ts-complexity-report`.
 * Only the three fields the synthesizer needs are typed here; the probe
 * wrapper is responsible for projecting its tool-specific output into this
 * minimal shape.
 */
export interface RawHotspot {
  /** Repository-relative file path. */
  readonly path: string;
  /** Function name; `"default export"` for anonymous default exports. */
  readonly function: string;
  /** Cyclomatic complexity score (positive integer). */
  readonly score: number;
}

/**
 * One raw duplicate cluster as produced by `jscpd`. `locations` is the
 * set of repository-relative paths that share `sharedLines` lines of
 * code — at least two locations is the minimum jscpd will emit.
 */
export interface RawDuplicate {
  /** Repository-relative paths participating in the cluster (≥ 2). */
  readonly locations: readonly string[];
  /** Number of duplicated lines shared across the cluster. */
  readonly sharedLines: number;
}

/**
 * Aggregated probe output consumed by `buildCodeQualityFindings`. Each
 * field is independently `'unmeasured'`-able where the design permits;
 * otherwise the synthesizer trusts the probe wrapper to emit
 * already-validated structures.
 */
export interface CodeQualityInput {
  /** Strict-mode coverage % per target (Requirement 7.2). */
  readonly strictCoverageByTarget: Readonly<Record<string, Score | Unmeasured>>;
  /** ESLint error/warning counts per target (Requirement 7.3). */
  readonly eslintCountsByTarget: Readonly<Record<string, EslintCount>>;
  /** Workspace-relative root-script paths from Pass 1 (Requirement 7.4). */
  readonly rootScripts: readonly string[];
  /** Jest coverage summaries per target (Requirement 7.5). */
  readonly coverageByTarget: Readonly<Record<string, CoverageSummary>>;
  /** Raw complexity hotspots; `'unmeasured'` when probe failed (Requirement 7.6). */
  readonly rawHotspots: readonly RawHotspot[] | Unmeasured;
  /** Raw duplicate clusters; `'unmeasured'` when probe failed (Requirement 7.7). */
  readonly rawDuplicates: readonly RawDuplicate[] | Unmeasured;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The four canonical app prefixes used to evaluate Requirement 7.7
 * (cross-app duplicate clusters). A `Duplicate_Cluster` is retained iff
 * its `locations` span at least two of these prefixes.
 *
 * The `apps/` prefix is included so a simple `startsWith` check is enough
 * to bucket a location regardless of whether it lives at `apps/backend/src/...`
 * or `apps/backend/scripts/...`.
 */
const CANONICAL_APP_PREFIXES = [
  'apps/backend/',
  'apps/consumer-app/',
  'apps/frontend/',
  'apps/indexer/',
] as const;

/**
 * Fixed cardinality for `complexity_hotspots`. Encoded both at the type
 * level (`ComplexityHotspotList` = 10-tuple) and at runtime via this
 * constant so the padding loop has a single source of truth.
 */
const COMPLEXITY_HOTSPOT_COUNT = 10 as const;

/**
 * Sentinel row used for padding the 10-tuple of complexity hotspots when
 * the probe under-delivered or failed entirely. The `score: 0` keeps the
 * tuple sortable by `score` without a special case in the renderer.
 */
const UNMEASURED_HOTSPOT: Omit<Complexity_Hotspot, 'rank'> = Object.freeze({
  path: UNMEASURED,
  function: UNMEASURED,
  score: 0,
});

// ---------------------------------------------------------------------------
// Helper: root-script triage
// ---------------------------------------------------------------------------

/**
 * Classify a single workspace-root script into `keep | archive | remove`
 * with a justification. The heuristic is deliberately small so reviewers
 * can audit it without re-reading the whole synthesizer:
 *
 *   - `audit.js`      → `keep`    (the audit pipeline entry point).
 *   - `autofix.js`    → `archive` (deprecated automation kept for reference).
 *   - `tmp_*.js`      → `remove`  (one-off scripts that should not persist).
 *   - anything else   → `archive` (defensive default; reviewer to confirm).
 *
 * Discovery (Pass 1) only emits filenames matching the three patterns
 * above, so the defensive default branch is reachable only if a future
 * change widens the discovery filter without updating this synthesizer.
 *
 * The `path` field on the returned `ScriptTriage` is the workspace-
 * relative path provided by Discovery — at audit-root that is just the
 * file basename (`'audit.js'`, `'autofix.js'`, `'tmp_thing.js'`).
 */
function triageRootScript(scriptPath: string): ScriptTriage {
  const basename = scriptPath.split('/').pop() ?? scriptPath;
  let classification: ScriptTriageClassification;
  let justification: string;

  if (basename === 'audit.js') {
    classification = 'keep';
    justification = 'entry point';
  } else if (basename === 'autofix.js') {
    classification = 'archive';
    justification = 'deprecated automation; useful for reference';
  } else if (/^tmp_.+\.js$/.test(basename)) {
    classification = 'remove';
    justification = 'temporary script; promote to a proper task or delete';
  } else {
    classification = 'archive';
    justification = 'unrecognized root script; review and archive or delete';
  }

  return Object.freeze({
    path: scriptPath,
    classification,
    justification,
  });
}

// ---------------------------------------------------------------------------
// Helper: complexity hotspot ranking and padding
// ---------------------------------------------------------------------------

/**
 * Build the fixed-length 10-tuple of `Complexity_Hotspot` rows.
 *
 *   - When `rawHotspots === 'unmeasured'`, every slot is the sentinel row
 *     (`path: 'unmeasured'`, `function: 'unmeasured'`, `score: 0`) with
 *     dense ranks 1..10. The renderer prints the placeholder verbatim.
 *   - When `rawHotspots` is an array, sort by `score` descending (stable
 *     on ties), take the top ten, and pad the tail with sentinel rows so
 *     the tuple is always exactly ten entries.
 *
 * Returns a value cast to `ComplexityHotspotList` because TypeScript
 * cannot infer a fixed-length tuple from a runtime-built array. The
 * length invariant is enforced by `COMPLEXITY_HOTSPOT_COUNT` above and
 * validated by Property 10 in the companion test (task 4.6).
 */
function buildComplexityHotspots(
  rawHotspots: readonly RawHotspot[] | Unmeasured,
): ComplexityHotspotList {
  const rows: Complexity_Hotspot[] = [];

  if (rawHotspots !== UNMEASURED) {
    const sorted = [...rawHotspots].sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, COMPLEXITY_HOTSPOT_COUNT);
    for (let i = 0; i < top.length; i++) {
      const entry = top[i] as RawHotspot;
      rows.push(
        Object.freeze({
          rank: i + 1,
          path: entry.path,
          function: entry.function,
          score: entry.score,
        }),
      );
    }
  }

  // Pad to exactly ten with the unmeasured sentinel. When the probe
  // failed entirely (`rawHotspots === 'unmeasured'`) the loop fills all
  // ten slots; when the probe produced fewer than ten rows it fills only
  // the tail.
  while (rows.length < COMPLEXITY_HOTSPOT_COUNT) {
    rows.push(
      Object.freeze({
        rank: rows.length + 1,
        ...UNMEASURED_HOTSPOT,
      }),
    );
  }

  return rows as unknown as ComplexityHotspotList;
}

// ---------------------------------------------------------------------------
// Helper: duplicate-cluster cross-app filter and recommendation
// ---------------------------------------------------------------------------

/**
 * Return `true` when the cluster's locations span at least two of the
 * canonical app prefixes (`apps/backend`, `apps/consumer-app`,
 * `apps/frontend`, `apps/indexer`). A cluster confined to a single app
 * is filtered out per Requirement 7.7 — those are intra-app duplicates
 * the per-surface section already covers.
 */
function clusterSpansMultipleApps(locations: readonly string[]): boolean {
  const apps = new Set<string>();
  for (const loc of locations) {
    for (const prefix of CANONICAL_APP_PREFIXES) {
      if (loc.startsWith(prefix)) {
        apps.add(prefix);
        break;
      }
    }
    if (apps.size >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Derive a recommendation string for a cluster. The heuristic looks at
 * the first location's path under `apps/<app>/src/<module>/...`; when a
 * `<module>` segment is identifiable, the recommendation suggests
 * extracting to `packages/shared/<module>`. Otherwise it falls back to
 * a generic shared-package suggestion.
 *
 * The string is intentionally a recommendation rather than a directive:
 * the audit is planning-only and the actual extraction is left to a
 * follow-up implementation spec.
 */
function recommendForCluster(locations: readonly string[]): string {
  const moduleHint = inferModuleHint(locations);
  if (moduleHint !== null) {
    return `Extract shared logic to packages/shared/${moduleHint}`;
  }
  return 'Extract shared logic to packages/shared/<module>';
}

/**
 * Inspect the first location for a `apps/<app>/src/<segment>/...` shape
 * and return the `<segment>` if found. Returns `null` when no location
 * matches the pattern, in which case the caller falls back to the
 * generic recommendation.
 */
function inferModuleHint(locations: readonly string[]): string | null {
  for (const loc of locations) {
    const match = /^apps\/[^/]+\/src\/([^/]+)\//.exec(loc);
    if (match !== null && match[1] !== undefined && match[1].length > 0) {
      return match[1];
    }
  }
  return null;
}

/**
 * Format a 1-indexed integer as a `DUP-NNNN` cluster id (zero-padded to
 * four digits to match the `VULN-NNNN` convention used by the security
 * synthesizer).
 */
function formatClusterId(index1: number): string {
  return `DUP-${String(index1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Public synthesizer
// ---------------------------------------------------------------------------

/**
 * Build the `CodeQualityFindings` section payload for the Audit_Report.
 *
 * Pure: no I/O. Inputs are the structured outputs of Pass 1 (root scripts)
 * and Pass 2 (strict mode, eslint, jest, ts-complexity-report, jscpd).
 *
 * Validates Requirements 7.2 (strict coverage), 7.3 (eslint counts),
 * 7.4 (root-script triage), 7.5 (test coverage), 7.6 (top-10 complexity
 * hotspots), 7.7 (cross-app duplicate clusters).
 */
export const buildCodeQualityFindings = (
  input: CodeQualityInput,
): CodeQualityFindings => {
  // -------- root-script triage (Requirement 7.4) -------------------------
  const root_script_triage: readonly ScriptTriage[] = Object.freeze(
    input.rootScripts.map(triageRootScript),
  );

  // -------- complexity hotspots (Requirement 7.6) ------------------------
  const complexity_hotspots = buildComplexityHotspots(input.rawHotspots);

  // -------- duplicate clusters (Requirement 7.7) -------------------------
  const duplicate_clusters: readonly Duplicate_Cluster[] =
    input.rawDuplicates === UNMEASURED
      ? Object.freeze([])
      : Object.freeze(
          input.rawDuplicates
            .filter((cluster) => clusterSpansMultipleApps(cluster.locations))
            .map((cluster, index): Duplicate_Cluster =>
              Object.freeze({
                cluster_id: formatClusterId(index + 1),
                locations: Object.freeze([...cluster.locations]),
                shared_lines: cluster.sharedLines,
                recommendation: recommendForCluster(cluster.locations),
              }),
            ),
        );

  // -------- shallow copies of probe maps so callers can't mutate the
  //          synthesizer's outputs after the fact (Requirements 7.2, 7.3,
  //          7.5). The probe-provided values are themselves frozen
  //          structures, so a one-level copy is sufficient.
  const ts_strict_coverage: Readonly<Record<string, Score | Unmeasured>> =
    Object.freeze({ ...input.strictCoverageByTarget });
  const eslint_counts: Readonly<Record<string, EslintCount>> = Object.freeze({
    ...input.eslintCountsByTarget,
  });
  const test_coverage: Readonly<Record<string, CoverageSummary>> = Object.freeze(
    { ...input.coverageByTarget },
  );

  return Object.freeze({
    ts_strict_coverage,
    eslint_counts,
    root_script_triage,
    test_coverage,
    complexity_hotspots,
    duplicate_clusters,
  });
};
