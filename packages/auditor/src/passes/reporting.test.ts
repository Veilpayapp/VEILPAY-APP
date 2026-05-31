/**
 * Integration tests for Pass 4 (`runReporting`).
 *
 * Covers the two write-set guarantees from design.md "Pass 4: Reporting":
 *
 *   1. Abort path — when an earlier pass throws `AuditAbortError`,
 *      `runReporting` writes `<plansDir>/.audit-evidence/ABORT.md` and skips
 *      both the consolidated report and every Plan_Document annotation.
 *
 *   2. Success path / write-set — when no earlier pass aborts, the only
 *      bytes that change under `<plansDir>` are the consolidated report,
 *      the `.audit-evidence/` directory, and the in-place Plan_Document
 *      annotations. A sentinel file outside `<plansDir>` remains
 *      byte-equal across the run.
 *
 * Validates Requirements 1.1 (Audit_Report at the canonical path) and 10.1
 * (writes confined to `<plansDir>`).
 *
 * Both tests build a fresh fixture workspace under `os.tmpdir()` via
 * `fs.mkdtemp`, drive `runReporting` against it, and clean up via
 * `fs.rm({ recursive: true, force: true })` in `afterEach`. No production
 * path under `d:\Veilpay\plans\` is touched.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  AuditReportData,
  AuditSection,
  GraphifyRefreshSummary,
  RunMetadata,
  SpecCoherenceReport,
} from '../models';
import { AuditAbortError } from '../util/errors';
import { runReporting } from './reporting';
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

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Slugify helper used to populate AuditSection.anchor fields. Mirrors the
 * renderer's slug strategy (lowercase, runs of non-alphanumerics collapse
 * to a single `_`, leading/trailing `_` stripped) so the stub sections
 * carry stable anchors.
 */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Build a minimum-shape `AuditSection` with the canonical title used by
 * the renderer. The section carries no findings or source refs — the
 * integration test only checks write-set behaviour, not section content.
 */
function stubSection(title: string): AuditSection {
  return {
    title,
    anchor: slugifyTitle(title),
    summary: `Stub summary for ${title}.`,
    findings: [],
    source_refs: [],
  };
}

/**
 * Build a complete, well-formed `AuditReportData` value sourced from the
 * canonical Pass 3 synthesizers. The resulting audit passes
 * `validateAuditReportData` so the success-path test exercises the full
 * report-write + plan-annotation pipeline.
 *
 * `verdict` is computed from the thresholds via `computeVerdict`, so the
 * Property 13 invariant inside `validateAuditReportData` holds regardless
 * of which threshold rows happen to fail under the stub inputs.
 */
function buildSampleAuditData(
  generatedAt: string,
  graphifyRunAt: string,
): AuditReportData {
  const planScores = buildPlanScores({
    workspaceRoot: 'unused',
    planFiles: [],
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
    graphifyRunAt,
    auditGeneratedAt: generatedAt,
    networkIcons,
    eslintCounts: { 'apps/backend': { errors: 0, warnings: 0 } },
    pnpmAuditAdvisories: [],
    criticalPathCoverage: 90,
  });

  const verdict = computeVerdict(thresholds);

  const codeQualityFindings = buildCodeQualityFindings({
    strictCoverageByTarget: { 'apps/backend': 100 },
    eslintCountsByTarget: { 'apps/backend': { errors: 0, warnings: 0 } },
    rootScripts: ['audit.js'],
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

  const specCoherence: SpecCoherenceReport = {
    spec_subsections: [],
    privacy_stack_subsection: {
      spec_id: 'veilpay-privacy-stack',
      scope_summary: 'Stub privacy-stack scope summary.',
      gaps: [],
      compares_design_and_tasks: true,
    },
    unspecced_behaviors: [],
  };

  const graphify: GraphifyRefreshSummary = {
    run_at: graphifyRunAt,
    graph_report_link: '../graphify-out/GRAPH_REPORT.md',
    top_observations: [
      'Observation one.',
      'Observation two.',
      'Observation three.',
    ],
    failure_capture: null,
  };

  const metadata: RunMetadata = {
    generated_at: generatedAt,
    workspace_sha: 'a'.repeat(40),
    graphify_run_at: graphifyRunAt,
    auditor: 'automated',
    plans_library_snapshot: [...CANONICAL_PLAN_PATHS],
  };

  return {
    metadata,
    executive_summary: 'A short stub executive summary for the integration test.',
    scoring_rubric: buildScoringRubric(),
    severity_definitions: buildSeverityDefinitions(),
    production_readiness_thresholds: thresholds,
    per_surface_sections: {
      backend_service: stubSection('Backend_Service'),
      consumer_app: stubSection('Consumer_App'),
      frontend_app: stubSection('Frontend_App'),
      indexer_service: stubSection('Indexer_Service'),
      shared_packages: stubSection('Shared packages/*'),
    },
    cross_cutting_sections: {
      on_chain_integration: stubSection('On-chain integration'),
      webhooks: stubSection('Webhooks'),
      auth_boundaries: stubSection('Auth boundaries'),
      error_handling: stubSection('Error handling'),
      observability: stubSection('Observability'),
      test_coverage: stubSection('Test coverage'),
      build_and_deploy: stubSection('Build and deploy'),
    },
    security_findings_list: [],
    code_quality_findings_list: codeQualityFindings,
    spec_coherence_report: specCoherence,
    frontend_polish_plan: buildFrontendPolishPlan(),
    network_icon_replacement_plan: networkIcons,
    plans_library_refresh: planScores,
    graphify_refresh_summary: graphify,
    verdict,
  };
}

/** Probe whether `p` exists. Returns false on any access error. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runReporting integration', () => {
  let tmpDir: string;
  let workspaceRoot: string;
  let plansDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-reporting-'));
    workspaceRoot = path.join(tmpDir, 'workspace');
    plansDir = path.join(workspaceRoot, 'plans');
    await fs.mkdir(plansDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('abort path (`git rev-parse HEAD` failure simulation)', () => {
    it('writes ABORT.md, skips PRODUCTION_READINESS_AUDIT.md, and leaves Plan_Documents untouched', async () => {
      // Pre-populate a Plan_Document with known content. After the abort
      // run the file must be byte-equal to this baseline (Requirement 10.2:
      // abort path skips every Plan_Document annotation).
      const planAPath = path.join(plansDir, 'PLAN_A.md');
      const planAContent = '# Plan A\n\nOriginal Plan_Document content.\n';
      await fs.writeFile(planAPath, planAContent, 'utf8');

      // Construct the AuditAbortError that Pass 1 (Discovery) would throw
      // when `git rev-parse HEAD` fails against a non-git fixture.
      const abortError = new AuditAbortError({
        command: 'git rev-parse HEAD',
        exitCode: 128,
        outputTail: [
          'fatal: not a git repository (or any of the parent directories): .git',
        ],
        capturedAt: '2025-01-15T10:30:00.000Z',
      });

      const auditedAt = '2025-01-15T10:31:00.000Z';
      const audit = buildSampleAuditData(auditedAt, auditedAt);

      const result = await runReporting({
        audit,
        plansDir,
        auditor: 'automated',
        auditedAt,
        abortError,
      });

      // ---- Result shape signals the abort path ran ------------------
      expect(result.aborted).toBe(true);
      expect(result.reportPath).toBeNull();
      expect(result.plansAnnotated).toBe(0);
      expect(result.abortPath).not.toBeNull();

      // ---- ABORT.md exists under .audit-evidence/ -------------------
      const abortPath = path.join(plansDir, '.audit-evidence', 'ABORT.md');
      expect(await pathExists(abortPath)).toBe(true);
      const abortBody = await fs.readFile(abortPath, 'utf8');
      // Body carries the command line, exit code, and output tail
      // verbatim so the on-call operator can act on it.
      expect(abortBody).toContain('git rev-parse HEAD');
      expect(abortBody).toContain('128');
      expect(abortBody).toContain('fatal: not a git repository');
      expect(abortBody).toContain('2025-01-15T10:30:00.000Z');

      // ---- PRODUCTION_READINESS_AUDIT.md was NOT written ------------
      const reportPath = path.join(plansDir, 'PRODUCTION_READINESS_AUDIT.md');
      expect(await pathExists(reportPath)).toBe(false);

      // ---- PLAN_A.md is byte-equal to its pre-abort content ---------
      const planAAfter = await fs.readFile(planAPath, 'utf8');
      expect(planAAfter).toBe(planAContent);
    }, 30000);
  });

  describe('success path / write-set invariant', () => {
    it('writes the report, annotates every Plan_Document, and leaves files outside plansDir byte-equal', async () => {
      // Pre-populate the seven canonical Plan_Documents. The annotator
      // resolves each `Plan_Score.plan_path` against `dirname(plansDir)`
      // (i.e., the workspace root), so the files land at
      // `<workspaceRoot>/plans/<basename>` — i.e., right inside `plansDir`.
      const placeholderByPath = new Map<string, string>();
      for (const planPath of CANONICAL_PLAN_PATHS) {
        const abs = path.join(workspaceRoot, planPath);
        const placeholder = `# ${path.basename(planPath)}\n\nPlaceholder content for ${planPath}.\n`;
        placeholderByPath.set(planPath, placeholder);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, placeholder, 'utf8');
      }

      // Pre-populate a sentinel file OUTSIDE `<plansDir>`. Property 7 /
      // Requirement 10.1 require this file to remain byte-equal across
      // the audit run.
      const sentinelRel = 'apps/backend/src/index.ts';
      const sentinelAbs = path.join(workspaceRoot, sentinelRel);
      const sentinelContent =
        "export const sentinel = 'do-not-touch';\n// Pass 4 must not write outside plansDir.\n";
      await fs.mkdir(path.dirname(sentinelAbs), { recursive: true });
      await fs.writeFile(sentinelAbs, sentinelContent, 'utf8');

      const auditedAt = '2025-01-15T10:30:00.000Z';
      const audit = buildSampleAuditData(auditedAt, auditedAt);

      const result = await runReporting({
        audit,
        plansDir,
        auditor: 'automated',
        auditedAt,
      });

      // ---- Result shape signals the success path ran ----------------
      expect(result.aborted).toBe(false);
      expect(result.abortPath).toBeNull();
      expect(result.plansAnnotated).toBe(CANONICAL_PLAN_PATHS.length);
      expect(result.reportPath).not.toBeNull();

      // ---- PRODUCTION_READINESS_AUDIT.md exists and is non-empty ----
      const reportPath = path.join(plansDir, 'PRODUCTION_READINESS_AUDIT.md');
      expect(await pathExists(reportPath)).toBe(true);
      const reportBody = await fs.readFile(reportPath, 'utf8');
      expect(reportBody.length).toBeGreaterThan(0);

      // ---- .audit-evidence/ directory exists under plansDir ---------
      const evidenceDir = path.join(plansDir, '.audit-evidence');
      expect(await pathExists(evidenceDir)).toBe(true);
      const evidenceStat = await fs.stat(evidenceDir);
      expect(evidenceStat.isDirectory()).toBe(true);

      // ---- Every Plan_Document was annotated in place ---------------
      // Acceptance per task notes: file content must have changed,
      // either via Superseded_Marker prefix or `## Audit Refresh` suffix.
      for (const planPath of CANONICAL_PLAN_PATHS) {
        const abs = path.join(workspaceRoot, planPath);
        const after = await fs.readFile(abs, 'utf8');
        expect(after).not.toBe(placeholderByPath.get(planPath));
        const isSuperseded = after.startsWith('> [!WARNING]');
        const hasAuditRefresh = /^##\s+Audit Refresh\b/m.test(after);
        expect(isSuperseded || hasAuditRefresh).toBe(true);
      }

      // ---- Sentinel outside plansDir is byte-equal to the original --
      const sentinelAfter = await fs.readFile(sentinelAbs, 'utf8');
      expect(sentinelAfter).toBe(sentinelContent);
    }, 30000);
  });
});
