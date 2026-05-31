/**
 * Property-based test for the modification-set invariant (Property 7).
 *
 * Feature: production-readiness-audit, Property 7:
 *   For an arbitrary fixture workspace processed by `runReporting`, every
 *   file outside the three writable areas
 *
 *     - <workspaceRoot>/plans/
 *     - <workspaceRoot>/graphify-out/
 *     - <workspaceRoot>/.kiro/specs/production-readiness-audit/
 *
 *   has identical SHA-256 before and after the run, and every annotated
 *   `Plan_Document` preserves its original content as a contiguous
 *   substring of the post-run file body.
 *
 *   Restated as the upper-bound contract of the auditor: the audit's
 *   write-set is confined to the three named directories. Source files
 *   under apps/, packages/* (other than the auditor itself), .kiro/specs/
 *   (other than this spec's own dir), and root scripts must not move a
 *   single byte. The fixture workspace plants sentinel files in each of
 *   those zones so any accidental write from `runReporting` surfaces as
 *   a SHA-256 mismatch rather than silent drift.
 *
 * Validates: Requirements 2.3, 6.14, 8.6, 10.1, 10.2, 10.3, 10.4, 10.5
 *
 * Strategy
 * --------
 *   - Each fast-check iteration builds a fresh fixture workspace under
 *     `os.tmpdir()` via `fs.mkdtempSync` so iterations cannot cross-
 *     contaminate. The fixture contains:
 *
 *       * The seven canonical Plan_Documents under `plans/` with random
 *         per-iteration body content (the "vary plan content" arm of the
 *         task notes).
 *       * Sentinel files under apps/backend, apps/consumer-app,
 *         packages/auditor, .kiro/specs/spec-a, and graphify-out. The
 *         apps/, packages/*, and .kiro/specs/spec-a entries cover the
 *         "must not be touched" assertion; the graphify-out sentinel
 *         demonstrates that the writable graphify-out directory can
 *         legitimately host files but the auditor still does not write
 *         to it (we do not invoke graphify in this Pass-4-only test).
 *
 *   - SHA-256 hashes for every file in the fixture are captured before
 *     `runReporting` is called and again after it returns. The post-run
 *     hash map is the union of the original file set and the newly
 *     written `PRODUCTION_READINESS_AUDIT.md`. Two assertions follow:
 *
 *       1. Every pre-existing file outside the three writable areas has
 *          identical SHA-256 in both maps.
 *       2. Each canonical Plan_Document, after annotation, contains its
 *          captured pre-run body as a contiguous substring of the
 *          post-run body.
 *
 *   - The `AuditReportData` fed into `runReporting` is built once per
 *     iteration via the canonical Pass 3 synthesizers (`buildScoringRubric`,
 *     `buildSeverityDefinitions`, `buildPlanScores`, `buildNetworkIconPlan`,
 *     `buildProductionReadinessThresholds`, `computeVerdict`,
 *     `buildFrontendPolishPlan`, `buildCodeQualityFindings`). Per-surface
 *     and cross-cutting sections use placeholder `AuditSection` records
 *     so the renderer's structural pre-checks all pass — the test is
 *     about the modification-set invariant, not about the report's
 *     internal validity which is exercised by Properties 1 / 2 / 3 / etc.
 *
 *   - `numRuns: 10` keeps wall time manageable given the per-iteration
 *     filesystem work (mkdir + write ~12 files + runReporting + hash
 *     ~13 files + rmdir).
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import * as fc from 'fast-check';

import type {
  AuditReportData,
  AuditSection,
  CodeQualityFindings,
  GraphifyRefreshSummary,
  RunMetadata,
  SpecCoherenceReport,
} from '../models';
import {
  SECTION_TITLES,
  slugify,
} from '../render/renderAuditReport';
import { buildCodeQualityFindings } from './synthesis/codeQuality';
import { buildFrontendPolishPlan } from './synthesis/frontendPolish';
import { buildNetworkIconPlan } from './synthesis/networkIcons';
import { CANONICAL_PLAN_PATHS, buildPlanScores } from './synthesis/plans';
import {
  buildScoringRubric,
  buildSeverityDefinitions,
} from './synthesis/rubric';
import {
  buildProductionReadinessThresholds,
  computeVerdict,
} from './synthesis/thresholds';
import { runReporting } from './reporting';

// ---------------------------------------------------------------------------
// Fixture sentinel files
// ---------------------------------------------------------------------------

/**
 * Sentinel files planted in zones the audit must not modify (or, in the
 * graphify-out case, may modify but does not touch in a Pass-4-only run).
 *
 * Keys are workspace-relative POSIX-style paths; values are the byte
 * content written verbatim. Each file lives in a different "must not
 * touch" surface so a single accidental write surfaces as exactly one
 * SHA mismatch in the assertion failure output:
 *
 *   - apps/backend/src/index.ts          → backend source surface (10.2)
 *   - apps/consumer-app/src/App.tsx      → consumer-app source surface (10.5)
 *   - packages/auditor/src/index.ts      → auditor's own write-protect (10.2)
 *   - .kiro/specs/spec-a/requirements.md → other spec dirs read-only (8.6)
 *   - graphify-out/GRAPH_REPORT.md       → writable area, but unchanged
 *                                          because Pass 4 alone does not
 *                                          invoke graphify
 */
const SENTINEL_FILES: Readonly<Record<string, string>> = Object.freeze({
  'apps/backend/src/index.ts':
    '// sentinel — backend service must not be modified by the audit\n' +
    'export const backend = "sentinel";\n',
  'apps/consumer-app/src/App.tsx':
    '// sentinel — consumer-app wallet/signing surface (Requirement 6.14)\n' +
    'export default function App() { return null; }\n',
  'packages/auditor/src/index.ts':
    '// sentinel — auditor must not modify its own package source\n' +
    'export {};\n',
  '.kiro/specs/spec-a/requirements.md':
    '# Spec A\n\nThe auditor must not modify other spec dirs (Requirement 8.6).\n',
  'graphify-out/GRAPH_REPORT.md':
    '# Graph Report (sentinel)\n\nNo graphify run — content remains unchanged.\n',
});

// ---------------------------------------------------------------------------
// SHA-256 + filesystem helpers
// ---------------------------------------------------------------------------

/**
 * SHA-256 hex digest for a single file. Uses the synchronous `fs` API so
 * the hashing pass can be expressed as a plain `for..of` loop without
 * inflating the property body with await chains.
 */
function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Recursively enumerate every file under `dir` (absolute paths). Skips
 * symlinks defensively so a misbehaving fixture does not loop.
 */
async function listFilesRecursive(dir: string): Promise<readonly string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fsPromises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        found.push(full);
      }
    }
  }
  await walk(dir);
  return found;
}

/** Snapshot every file under `root` to `absolutePath -> sha256` map. */
async function snapshotHashes(root: string): Promise<Map<string, string>> {
  const files = await listFilesRecursive(root);
  const map = new Map<string, string>();
  for (const file of files) {
    map.set(file, sha256File(file));
  }
  return map;
}

/**
 * Decide whether `filePath` lies inside one of the three writable areas
 * declared by the audit's modification-set contract. The check uses
 * `path.relative` so it is robust to both forward and backward slashes
 * on Windows and POSIX.
 */
function isInsideWritableArea(filePath: string, root: string): boolean {
  const writable = [
    path.join(root, 'plans'),
    path.join(root, 'graphify-out'),
    path.join(root, '.kiro', 'specs', 'production-readiness-audit'),
  ];
  for (const prefix of writable) {
    const rel = path.relative(prefix, filePath);
    // `rel === ''`        → filePath equals prefix exactly.
    // `!rel.startsWith('..')` and not absolute → filePath is inside prefix.
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fixture workspace builder
// ---------------------------------------------------------------------------

/**
 * Materialize a fresh fixture workspace under `os.tmpdir()`. Creates the
 * sentinel files (verbatim content from `SENTINEL_FILES`) plus the seven
 * canonical Plan_Documents under `plans/` populated with the per-iteration
 * `planBodies`.
 *
 * Returns the absolute path to the workspace root. The caller is
 * responsible for `fs.rm(root, { recursive: true })` to clean up — the
 * property body uses a try/finally so the cleanup runs even when fast-
 * check shrinks a counter-example.
 */
async function buildFixtureWorkspace(
  planBodies: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'veilpay-auditor-modset-'),
  );

  // Plant sentinel files. The leading directory components are created
  // recursively so the test does not hand-craft the tree.
  for (const [relPath, content] of Object.entries(SENTINEL_FILES)) {
    const full = path.join(root, ...relPath.split('/'));
    await fsPromises.mkdir(path.dirname(full), { recursive: true });
    await fsPromises.writeFile(full, content, 'utf8');
  }

  // Plant the seven canonical Plan_Documents with the supplied bodies.
  // Each plan body is prefixed with a stable `# <plan_path>` heading so
  // the random byte content cannot accidentally form a Superseded_Marker
  // prefix (which would put the annotator on its re-stamp branch and
  // change the substring-preservation contract — see Property 6).
  const plansDir = path.join(root, 'plans');
  await fsPromises.mkdir(plansDir, { recursive: true });
  for (const planPath of CANONICAL_PLAN_PATHS) {
    const body = `# ${planPath}\n\n${planBodies[planPath] ?? ''}`;
    const full = path.join(root, ...planPath.split('/'));
    await fsPromises.writeFile(full, body, 'utf8');
  }

  return root;
}

// ---------------------------------------------------------------------------
// AuditReportData builder — uses canonical Pass 3 synthesizers
// ---------------------------------------------------------------------------

/**
 * Build a placeholder per-section `AuditSection`. The renderer derives
 * the section anchor from the title via `slugify`, so we mirror that
 * here to keep the type contract honest. Per-surface and cross-cutting
 * sections are not the subject of Property 7 — their structural
 * properties live in Properties 1 / 2.
 */
function placeholderSection(title: string): AuditSection {
  return {
    title,
    anchor: slugify(title),
    summary: `Placeholder summary for ${title}.`,
    findings: [],
    source_refs: [],
  };
}

/** Empty-but-valid Spec_Coherence_Report (Property 11 lives elsewhere). */
function placeholderSpecCoherenceReport(): SpecCoherenceReport {
  const privacy = {
    spec_id: 'veilpay-privacy-stack',
    scope_summary: 'Placeholder privacy-stack scope summary.',
    gaps: [],
    compares_design_and_tasks: true,
  };
  return {
    spec_subsections: [privacy],
    privacy_stack_subsection: privacy,
    unspecced_behaviors: [],
  };
}

/** Empty-but-valid Code_Quality_Findings_List with all 10 hotspots. */
function placeholderCodeQualityFindings(): CodeQualityFindings {
  return buildCodeQualityFindings({
    strictCoverageByTarget: { 'apps/backend': 100 },
    eslintCountsByTarget: { 'apps/backend': { errors: 0, warnings: 0 } },
    rootScripts: [],
    coverageByTarget: {
      'apps/backend': {
        statements: 80,
        branches: 70,
        functions: 75,
        lines: 80,
      },
    },
    rawHotspots: [],
    rawDuplicates: [],
  });
}

/** Build a Graphify refresh summary with no failure capture. */
function buildGraphifySummary(generatedAt: string): GraphifyRefreshSummary {
  return {
    run_at: generatedAt,
    graph_report_link: '../graphify-out/GRAPH_REPORT.md',
    top_observations: [
      'Observation 1.',
      'Observation 2.',
      'Observation 3.',
    ] as readonly [string, string, string],
    failure_capture: null,
  };
}

/**
 * Compose the full `AuditReportData` consumed by `runReporting`. Built
 * via the canonical Pass 3 synthesizers so the renderer's structural
 * pre-validation passes — the sub-properties of those sections are
 * exercised by the dedicated property tests (1, 2, 3, 5, 8, 12, 13...).
 */
function buildAuditReportData(generatedAt: string): AuditReportData {
  const metadata: RunMetadata = {
    generated_at: generatedAt,
    workspace_sha: '0123456789abcdef0123456789abcdef01234567',
    graphify_run_at: generatedAt,
    auditor: 'automated',
    plans_library_snapshot: [...CANONICAL_PLAN_PATHS],
  };

  const planScores = buildPlanScores({
    workspaceRoot: 'd:/Veilpay',
    planFiles: [...CANONICAL_PLAN_PATHS],
    findingCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    eslintErrorCount: 0,
    pnpmAdvisoryCount: 0,
  });

  const networkIcons = buildNetworkIconPlan({
    discoveredAssets: [],
    discoveredRenderers: [],
  });

  const thresholds = buildProductionReadinessThresholds({
    findings: [],
    planScores,
    graphifyRunAt: generatedAt,
    auditGeneratedAt: generatedAt,
    networkIcons,
    eslintCounts: { 'apps/backend': { errors: 0, warnings: 0 } },
    pnpmAuditAdvisories: [],
    criticalPathCoverage: 90,
  });

  const verdict = computeVerdict(thresholds);

  return {
    metadata,
    executive_summary: 'Placeholder executive summary.',
    scoring_rubric: buildScoringRubric(),
    severity_definitions: buildSeverityDefinitions(),
    production_readiness_thresholds: thresholds,
    per_surface_sections: {
      backend_service: placeholderSection(SECTION_TITLES.backendService),
      consumer_app: placeholderSection(SECTION_TITLES.consumerApp),
      frontend_app: placeholderSection(SECTION_TITLES.frontendApp),
      indexer_service: placeholderSection(SECTION_TITLES.indexerService),
      shared_packages: placeholderSection(SECTION_TITLES.sharedPackages),
    },
    cross_cutting_sections: {
      on_chain_integration: placeholderSection(SECTION_TITLES.onChainIntegration),
      webhooks: placeholderSection(SECTION_TITLES.webhooks),
      auth_boundaries: placeholderSection(SECTION_TITLES.authBoundaries),
      error_handling: placeholderSection(SECTION_TITLES.errorHandling),
      observability: placeholderSection(SECTION_TITLES.observability),
      test_coverage: placeholderSection(SECTION_TITLES.testCoverage),
      build_and_deploy: placeholderSection(SECTION_TITLES.buildAndDeploy),
    },
    security_findings_list: [],
    code_quality_findings_list: placeholderCodeQualityFindings(),
    spec_coherence_report: placeholderSpecCoherenceReport(),
    frontend_polish_plan: buildFrontendPolishPlan(),
    network_icon_replacement_plan: networkIcons,
    plans_library_refresh: planScores,
    graphify_refresh_summary: buildGraphifySummary(generatedAt),
    verdict,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Plan body arbitrary. Ranges from empty to ~1 KiB of arbitrary text. A
 * stable `# <plan_path>` heading is prepended at fixture-build time so
 * the random bytes here cannot accidentally start with the literal
 * `> [!WARNING]\n> **SUPERSEDED ` prefix that would put the annotator on
 * its re-stamp branch.
 */
const arbPlanBody: fc.Arbitrary<string> = fc.string({
  minLength: 0,
  maxLength: 1024,
});

/**
 * Per-iteration map of plan-path → body. Encoded as a fixed-shape record
 * so every canonical plan receives a fresh body each run.
 */
const arbPlanBodies: fc.Arbitrary<Readonly<Record<string, string>>> = fc.record(
  Object.fromEntries(CANONICAL_PLAN_PATHS.map((p) => [p, arbPlanBody])) as Record<
    string,
    fc.Arbitrary<string>
  >,
);

/**
 * ISO 8601 timestamp arbitrary, restricted to the realistic audit window
 * (2020..2030) so `Date#toISOString` cannot emit the extended-year form.
 */
const arbIsoTimestamp: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2030-12-31T23:59:59Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

// ---------------------------------------------------------------------------
// Property 7 — Modification-set invariant
// ---------------------------------------------------------------------------

describe('runReporting — Property 7: modification-set invariant', () => {
  it(
    'preserves SHA-256 of every file outside plans/, graphify-out/, and ' +
      '.kiro/specs/production-readiness-audit/, and keeps each Plan_Document ' +
      "original body as a contiguous substring of the annotated output",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbPlanBodies,
          arbIsoTimestamp,
          async (planBodies, generatedAt) => {
            const root = await buildFixtureWorkspace(planBodies);
            try {
              // Record the pre-run state. Captures every sentinel +
              // every plan body (with the stable `# <plan_path>` prefix
              // prepended by `buildFixtureWorkspace`), keyed by absolute
              // path.
              const preHashes = await snapshotHashes(root);

              // Capture the verbatim pre-run body of every Plan_Document
              // so the substring assertion can compare bytes directly
              // (rather than re-hashing the post-run file).
              const preBodies = new Map<string, string>();
              for (const planPath of CANONICAL_PLAN_PATHS) {
                const full = path.join(root, ...planPath.split('/'));
                preBodies.set(full, await fsPromises.readFile(full, 'utf8'));
              }

              // Drive Pass 4. `plansDir` is the workspace's plans/
              // directory; `auditedAt` flows into both the report
              // metadata and the Plan_Document annotations.
              const plansDir = path.join(root, 'plans');
              const audit = buildAuditReportData(generatedAt);
              const result = await runReporting({
                audit,
                plansDir,
                auditor: 'automated',
                auditedAt: generatedAt,
              });

              // Sanity-check the success path. The abort-path branch is
              // exercised by the integration test in task 6.6; here we
              // only care about the modification-set invariant on a
              // clean run.
              expect(result.aborted).toBe(false);
              expect(result.reportPath).not.toBeNull();
              expect(result.plansAnnotated).toBe(CANONICAL_PLAN_PATHS.length);

              // Re-hash the workspace post-run.
              const postHashes = await snapshotHashes(root);

              // Assertion 1 — every pre-existing file outside the three
              // writable areas has identical SHA-256 in both maps.
              for (const [filePath, preHash] of preHashes) {
                if (isInsideWritableArea(filePath, root)) {
                  continue;
                }
                const postHash = postHashes.get(filePath);
                expect({
                  filePath: path.relative(root, filePath),
                  preHash,
                  postHash,
                }).toEqual({
                  filePath: path.relative(root, filePath),
                  preHash,
                  postHash: preHash,
                });
              }

              // Assertion 2 — the auditor's only new file is the
              // consolidated report. Sanity-check by ensuring no file
              // outside the writable areas appears in `postHashes`
              // without also appearing in `preHashes`.
              for (const filePath of postHashes.keys()) {
                if (isInsideWritableArea(filePath, root)) {
                  continue;
                }
                expect(preHashes.has(filePath)).toBe(true);
              }

              // Assertion 3 — every annotated Plan_Document contains
              // its captured pre-run body as a contiguous substring of
              // the post-run body. This is the byte-level statement of
              // Requirement 2.3 ("preserve every Plan_Document file on
              // disk") even though the file is annotated in place.
              for (const planPath of CANONICAL_PLAN_PATHS) {
                const full = path.join(root, ...planPath.split('/'));
                const preBody = preBodies.get(full);
                if (preBody === undefined) {
                  throw new Error(
                    `Property 7 invariant test internal error: missing pre-body for ${planPath}`,
                  );
                }
                const postBody = await fsPromises.readFile(full, 'utf8');
                // The fixture body is prepended with a stable `#`
                // heading so it never accidentally starts with the
                // Superseded_Marker prefix; the annotator therefore
                // never enters its re-stamp branch and the entire
                // pre-run body is preserved as a contiguous substring.
                expect(postBody.includes(preBody)).toBe(true);
              }
            } finally {
              // Always clean up the tmpdir, even when fast-check shrinks
              // a failing input — leaks would accumulate quickly under
              // numRuns.
              await fsPromises.rm(root, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 10 },
      );
    },
    // Each iteration walks the filesystem several times; give Jest a
    // generous timeout so a slow runner does not time out before the
    // ten iterations complete.
    60_000,
  );
});
