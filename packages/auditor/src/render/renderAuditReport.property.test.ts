/**
 * Property-based tests for the consolidated `Audit_Report` renderer.
 *
 * Feature: production-readiness-audit, Properties 1 & 2:
 *
 *   Property 1 — Audit_Report contains every required section and link.
 *     For any successful audit run, the rendered output emits every section
 *     title in `SECTION_TITLES` as an H2 heading paired with a matching
 *     `<a id="...">` anchor, and every intra-document link in the lead
 *     paragraph (Requirement 1.7) resolves to one of those anchors.
 *
 *   Property 2 — Run Metadata parses to valid ISO 8601 and the executive
 *     summary fits the word budget.
 *     For any successful audit run, the rendered Run Metadata block carries
 *     ISO 8601 timestamps that `Date.parse` accepts, a non-empty Workspace
 *     SHA, and an executive summary whose word count is <= 500
 *     (Requirement 1.5 / `EXECUTIVE_SUMMARY_WORD_LIMIT`).
 *
 *   Plus a negative property: when the executive summary exceeds 500 words,
 *   `renderAuditReport` must throw, which is the mechanism Pass 4 uses to
 *   abort before any write hits disk (design.md "Components / Pass 4").
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7, 2.6, 3.4, 3.5, 5.1, 6.1,
 *            7.1, 8.1, 9.1
 *
 * Strategy
 * --------
 *   - A `fast-check` arbitrary produces synthetic but well-formed
 *     `AuditReportData` values by:
 *       * generating ISO 8601 timestamps via `fc.date(...).map(d => d.toISOString())`,
 *       * generating a 40-char hex Workspace SHA,
 *       * generating an executive summary as a list of small words capped at
 *         the 500-word budget,
 *       * delegating fixed-shape sections to the canonical builders
 *         (`buildScoringRubric`, `buildSeverityDefinitions`, `buildPlanScores`,
 *         `buildNetworkIconPlan`, `buildFrontendPolishPlan`,
 *         `buildProductionReadinessThresholds`, `computeVerdict`,
 *         `buildCodeQualityFindings`),
 *       * filling the per-surface, cross-cutting, security, and spec-coherence
 *         sections with placeholder content sized to keep the property body
 *         fast.
 *
 *   - The rendered Markdown is parsed with `unified().use(remarkParse)` and
 *     walked with `unist-util-visit` to extract H2 headings, `<a id="...">`
 *     anchors, and intra-document link URLs. The property body asserts
 *     coverage and link resolution against `SECTION_TITLES` and
 *     `REQUIREMENT_1_7_LINK_TARGETS`.
 *
 *   - Negative test: a counter-arbitrary builds an executive summary of >500
 *     words and asserts `renderAuditReport` throws.
 */

import * as fc from 'fast-check';

import {
  EXECUTIVE_SUMMARY_WORD_LIMIT,
  REQUIREMENT_1_7_LINK_TARGETS,
  SECTION_TITLES,
  countWords,
  renderAuditReport,
  slugify,
} from './renderAuditReport';
import type {
  AuditReportData,
  AuditSection,
  CodeQualityFindings,
  FailureCapture,
  GraphifyRefreshSummary,
  RunMetadata,
  Severity,
  SpecCoherenceReport,
  Vulnerability_Finding,
} from '../models';
import { buildCodeQualityFindings } from '../passes/synthesis/codeQuality';
import { buildFrontendPolishPlan } from '../passes/synthesis/frontendPolish';
import { buildNetworkIconPlan } from '../passes/synthesis/networkIcons';
import { buildPlanScores } from '../passes/synthesis/plans';
import {
  buildScoringRubric,
  buildSeverityDefinitions,
} from '../passes/synthesis/rubric';
import {
  buildProductionReadinessThresholds,
  computeVerdict,
} from '../passes/synthesis/thresholds';

// ---------------------------------------------------------------------------
// Arbitraries — synthetic but well-formed AuditReportData
// ---------------------------------------------------------------------------

/**
 * ISO 8601 timestamp arbitrary. The `noInvalidDate` flag rules out the
 * `Invalid Date` value that `fc.date` can otherwise emit, which would make
 * `toISOString()` throw before the renderer ever runs.
 *
 * Range is restricted to the realistic audit window (2020..2030) so the
 * generated timestamps stay within the bounds `Date.parse` accepts on every
 * supported runtime.
 */
const arbIsoTimestamp: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2030-12-31T23:59:59Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

/**
 * 40-character lowercase hex Workspace SHA arbitrary, matching the shape of
 * `git rev-parse HEAD` (Requirement 1.4). The renderer only requires the
 * SHA to be non-empty; using a realistic shape keeps counter-examples
 * easier to read in failure output.
 */
const arbWorkspaceSha: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'0123456789abcdef'.split('')),
  { minLength: 40, maxLength: 40 },
);

/**
 * Generate an executive summary as a sequence of small lowercase words
 * separated by single spaces. The arbitrary is bounded to <= 500 words so
 * Property 2's positive arm sees only valid inputs; the negative property
 * uses a separate >500-word generator below.
 *
 * Words are drawn from a tiny vocabulary because the renderer treats the
 * summary as opaque prose — the property only checks the word count.
 */
const arbExecutiveSummary: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      'audit',
      'report',
      'workspace',
      'review',
      'security',
      'quality',
      'plan',
      'thresholds',
      'graphify',
      'consumer',
      'backend',
      'frontend',
      'indexer',
      'network',
      'icon',
      'spec',
    ),
    { minLength: 0, maxLength: EXECUTIVE_SUMMARY_WORD_LIMIT },
  )
  .map((words) => words.join(' '));

/**
 * Generator for a >500-word executive summary used by the negative
 * property. The exact word count is randomized between 501 and 600 so the
 * property exercises the inequality without inflating run time.
 */
const arbOversizedExecutiveSummary: fc.Arbitrary<string> = fc
  .integer({ min: EXECUTIVE_SUMMARY_WORD_LIMIT + 1, max: EXECUTIVE_SUMMARY_WORD_LIMIT + 100 })
  .map((count) => Array.from({ length: count }, (_, i) => `w${i}`).join(' '));

/**
 * Auditor identity arbitrary — either a human name or the literal
 * `'automated'` sentinel used by the CLI (`design.md` "Run Metadata block").
 */
const arbAuditor: fc.Arbitrary<string> = fc.constantFrom(
  'automated',
  'alice',
  'bob',
  'carol',
);

/**
 * Plans library snapshot arbitrary — zero-or-more workspace-relative plan
 * paths. The renderer accepts any string contents in this list and only
 * uses them as Markdown back-ticks, so the alphabet stays narrow.
 */
const arbPlansLibrarySnapshot: fc.Arbitrary<readonly string[]> = fc.array(
  fc.constantFrom(
    'plans/AUDIT_REPORT.md',
    'plans/COMPREHENSIVE_AUDIT_REPORT.md',
    'plans/consumer-app-production-audit.md',
    'plans/full_stack_audit.md',
    'plans/implementation_plan.md',
    'plans/MERCHANT_DASHBOARD_SPEC.md',
    'plans/ROADMAP.md',
  ),
  { minLength: 0, maxLength: 7 },
);

/**
 * RunMetadata arbitrary — every field is independently generated to make
 * sure the property exercises the full input space the validator covers.
 */
const arbRunMetadata: fc.Arbitrary<RunMetadata> = fc.record({
  generated_at: arbIsoTimestamp,
  workspace_sha: arbWorkspaceSha,
  graphify_run_at: arbIsoTimestamp,
  auditor: arbAuditor,
  plans_library_snapshot: arbPlansLibrarySnapshot,
});

/**
 * Build a generic placeholder `AuditSection` whose anchor matches the
 * canonical slug for `title`. The renderer doesn't consume the
 * `anchor` field directly (it derives anchors from the section title via
 * `slugify`), but the type contract requires it.
 */
const arbAuditSection = (title: string): fc.Arbitrary<AuditSection> =>
  fc.record({
    title: fc.constant(title),
    anchor: fc.constant(slugify(title)),
    summary: fc.constant(`Placeholder summary for ${title}.`),
    findings: fc.array(fc.string({ minLength: 1, maxLength: 32 }), {
      minLength: 0,
      maxLength: 3,
    }),
    source_refs: fc.array(
      fc.constantFrom(
        'apps/backend/src/index.ts',
        'apps/consumer-app/src/App.tsx',
        'apps/frontend/src/index.tsx',
        'apps/indexer/src/main.ts',
        'packages/auditor/src/index.ts',
      ),
      { minLength: 0, maxLength: 3 },
    ),
  });

/**
 * Per-surface sections (Requirement 1.2) — five named slots, each carrying
 * a placeholder AuditSection.
 */
const arbPerSurfaceSections = fc.record({
  backend_service: arbAuditSection(SECTION_TITLES.backendService),
  consumer_app: arbAuditSection(SECTION_TITLES.consumerApp),
  frontend_app: arbAuditSection(SECTION_TITLES.frontendApp),
  indexer_service: arbAuditSection(SECTION_TITLES.indexerService),
  shared_packages: arbAuditSection(SECTION_TITLES.sharedPackages),
});

/**
 * Cross-cutting sections (Requirement 1.3) — seven named slots.
 */
const arbCrossCuttingSections = fc.record({
  on_chain_integration: arbAuditSection(SECTION_TITLES.onChainIntegration),
  webhooks: arbAuditSection(SECTION_TITLES.webhooks),
  auth_boundaries: arbAuditSection(SECTION_TITLES.authBoundaries),
  error_handling: arbAuditSection(SECTION_TITLES.errorHandling),
  observability: arbAuditSection(SECTION_TITLES.observability),
  test_coverage: arbAuditSection(SECTION_TITLES.testCoverage),
  build_and_deploy: arbAuditSection(SECTION_TITLES.buildAndDeploy),
});

/**
 * Synthetic Vulnerability_Finding generator. The renderer only requires
 * non-empty strings and a valid severity, so the fields stay simple. Both
 * file-scope and line-scoped variants are exercised.
 */
const arbVulnerabilityFinding: fc.Arbitrary<Vulnerability_Finding> = fc
  .tuple(
    fc.integer({ min: 1, max: 9999 }),
    fc.constantFrom<Severity>('Critical', 'High', 'Medium', 'Low'),
    fc.boolean(),
  )
  .map(([n, severity, withLines]) => ({
    id: `VULN-${n.toString().padStart(4, '0')}`,
    title: `Synthetic finding ${n}`,
    severity,
    location: {
      path: 'apps/backend/src/routes/example.ts',
      lines: withLines ? `L${n}-L${n + 5}` : null,
    },
    description: `Synthetic description ${n}.`,
    remediation: `Synthetic remediation ${n}.`,
    remediation_owner: 'backend',
    references: [],
  }));

const arbSecurityFindings: fc.Arbitrary<readonly Vulnerability_Finding[]> = fc.array(
  arbVulnerabilityFinding,
  { minLength: 0, maxLength: 4 },
);

/**
 * Spec_Coherence_Report arbitrary — a minimum-shape report covering one
 * generic spec plus the required privacy-stack subsection.
 */
const arbSpecCoherenceReport: fc.Arbitrary<SpecCoherenceReport> = fc.record({
  spec_subsections: fc.array(
    fc.record({
      spec_id: fc.constantFrom('production-readiness-audit', 'veilpay-privacy-stack'),
      scope_summary: fc.constant('Synthetic scope summary.'),
      gaps: fc.constant([]),
      compares_design_and_tasks: fc.boolean(),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  privacy_stack_subsection: fc.record({
    spec_id: fc.constant('veilpay-privacy-stack'),
    scope_summary: fc.constant('Synthetic privacy-stack scope summary.'),
    gaps: fc.constant([]),
    compares_design_and_tasks: fc.constant(true),
  }),
  unspecced_behaviors: fc.constant([]),
});

/**
 * Graphify refresh summary arbitrary. `top_observations` is a 3-tuple per
 * Requirement 3.4 / Property 14; `failure_capture` is null on success or a
 * structured capture otherwise.
 */
const arbFailureCapture: fc.Arbitrary<FailureCapture> = fc.record({
  command: fc.constant('graphify .'),
  exit_code: fc.integer({ min: 1, max: 127 }),
  output_tail: fc.array(fc.string({ minLength: 0, maxLength: 80 }), {
    minLength: 0,
    maxLength: 50,
  }),
  captured_at: arbIsoTimestamp,
});

const arbGraphifyRefreshSummary: fc.Arbitrary<GraphifyRefreshSummary> = fc.record({
  run_at: arbIsoTimestamp,
  graph_report_link: fc.constant('../graphify-out/GRAPH_REPORT.md'),
  top_observations: fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 80 }),
      fc.string({ minLength: 1, maxLength: 80 }),
      fc.string({ minLength: 1, maxLength: 80 }),
    )
    .map(([a, b, c]) => [a, b, c] as readonly [string, string, string]),
  failure_capture: fc.option(arbFailureCapture, { nil: null }),
});

/**
 * Aggregated Code_Quality_Findings_List arbitrary. Builds the canonical
 * shape via `buildCodeQualityFindings` so the synthesizer's invariants flow
 * through (e.g., the 10-row complexity hotspot tuple).
 */
const arbCodeQualityFindings: fc.Arbitrary<CodeQualityFindings> = fc
  .array(
    fc.record({
      path: fc.constantFrom(
        'apps/backend/src/index.ts',
        'apps/consumer-app/src/App.tsx',
        'apps/frontend/src/index.tsx',
        'apps/indexer/src/main.ts',
      ),
      function: fc.constantFrom('handler', 'render', 'process'),
      score: fc.integer({ min: 1, max: 50 }),
    }),
    { minLength: 0, maxLength: 12 },
  )
  .map((rawHotspots) =>
    buildCodeQualityFindings({
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
      rawHotspots,
      rawDuplicates: [],
    }),
  );

/**
 * Top-level `AuditReportData` arbitrary. Every nested arbitrary above
 * composes into this single record, which the property body feeds straight
 * into `renderAuditReport`.
 */
const arbAuditReportData: fc.Arbitrary<AuditReportData> = fc
  .record({
    metadata: arbRunMetadata,
    executive_summary: arbExecutiveSummary,
    per_surface_sections: arbPerSurfaceSections,
    cross_cutting_sections: arbCrossCuttingSections,
    security_findings_list: arbSecurityFindings,
    code_quality_findings_list: arbCodeQualityFindings,
    spec_coherence_report: arbSpecCoherenceReport,
    graphify_refresh_summary: arbGraphifyRefreshSummary,
  })
  .map((parts) => {
    // The plans/network/threshold/verdict blocks are deterministic given
    // the synthesizer inputs available here. Building them inside `.map`
    // keeps the arbitrary lazy without having to embed the whole canonical
    // pipeline as nested arbitraries.
    const planScores = buildPlanScores({
      workspaceRoot: 'd:/Veilpay',
      planFiles: [...parts.metadata.plans_library_snapshot],
      findingCounts: {
        critical: parts.security_findings_list.filter((f) => f.severity === 'Critical').length,
        high: parts.security_findings_list.filter((f) => f.severity === 'High').length,
        medium: parts.security_findings_list.filter((f) => f.severity === 'Medium').length,
        low: parts.security_findings_list.filter((f) => f.severity === 'Low').length,
      },
      eslintErrorCount: 0,
      pnpmAdvisoryCount: 0,
    });
    const networkIcons = buildNetworkIconPlan({
      discoveredAssets: [],
      discoveredRenderers: [],
    });
    const thresholds = buildProductionReadinessThresholds({
      findings: parts.security_findings_list,
      planScores,
      graphifyRunAt: parts.graphify_refresh_summary.run_at,
      auditGeneratedAt: parts.metadata.generated_at,
      networkIcons,
      eslintCounts: { 'apps/backend': { errors: 0, warnings: 0 } },
      pnpmAuditAdvisories: [],
      criticalPathCoverage: 90,
    });
    const verdict = computeVerdict(thresholds);
    return {
      metadata: parts.metadata,
      executive_summary: parts.executive_summary,
      scoring_rubric: buildScoringRubric(),
      severity_definitions: buildSeverityDefinitions(),
      production_readiness_thresholds: thresholds,
      per_surface_sections: parts.per_surface_sections,
      cross_cutting_sections: parts.cross_cutting_sections,
      security_findings_list: parts.security_findings_list,
      code_quality_findings_list: parts.code_quality_findings_list,
      spec_coherence_report: parts.spec_coherence_report,
      frontend_polish_plan: buildFrontendPolishPlan(),
      network_icon_replacement_plan: networkIcons,
      plans_library_refresh: planScores,
      graphify_refresh_summary: parts.graphify_refresh_summary,
      verdict,
    } satisfies AuditReportData;
  });

// ---------------------------------------------------------------------------
// ESM-only dependency loader
// ---------------------------------------------------------------------------
//
// `unified`, `remark-parse`, and `unist-util-visit` ship as pure ESM. The
// auditor package compiles to CommonJS via ts-jest, so a top-level
// `import` would be rewritten to `require(...)` and Jest's CJS module
// resolver would fail on the ESM `export` syntax.
//
// We side-step that by routing the load through a `Function`-constructed
// dynamic `import()`. Wrapping the call in `new Function` keeps ts-jest's
// import-rewriting hooks from touching it; Jest 29's runtime then resolves
// the call as a native ESM dynamic import (Jest's experimental-vm-modules
// loader is enabled via `NODE_OPTIONS=--experimental-vm-modules` in the
// jest config below).

interface UnifiedProcessor {
  use(plugin: unknown): UnifiedProcessor;
  parse(value: string): unknown;
}

interface RemarkUtilities {
  readonly unified: () => UnifiedProcessor;
  readonly remarkParse: unknown;
  /**
   * Single-argument visitor form. The two-argument form
   * `visit(tree, 'type', cb)` is intentionally avoided here — see the
   * note in `parseRenderedReport`.
   */
  readonly visit: <T extends MdNode>(
    tree: MdNode,
    visitor: (node: T) => void,
  ) => void;
}

let utils: RemarkUtilities | null = null;

// `new Function('specifier', 'return import(specifier);')` is the canonical
// way to obtain a *real* dynamic `import()` from inside a CommonJS-emit
// jest harness — without it, ts-jest rewrites the call to `require()`,
// which cannot load the ESM-only remark packages we depend on. The
// `no-implied-eval` rule is right that this looks dangerous, but the
// argument is a hardcoded literal string with no user input, so it is
// safe in this narrow context.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<unknown>;

beforeAll(async () => {
  const [unifiedMod, remarkParseMod, visitMod] = await Promise.all([
    dynamicImport('unified'),
    dynamicImport('remark-parse'),
    dynamicImport('unist-util-visit'),
  ]);
  utils = {
    unified: (unifiedMod as { unified: () => UnifiedProcessor }).unified,
    remarkParse: (remarkParseMod as { default: unknown }).default,
    visit: (visitMod as {
      visit: <T extends MdNode>(
        tree: MdNode,
        visitor: (node: T) => void,
      ) => void;
    }).visit,
  };
});

function requireUtils(): RemarkUtilities {
  if (utils === null) {
    throw new Error(
      'remark utilities not loaded; ensure beforeAll completed before parseRenderedReport runs.',
    );
  }
  return utils;
}


interface MdNode {
  readonly type: string;
  readonly value?: string;
  readonly url?: string;
  readonly depth?: number;
  readonly children?: readonly MdNode[];
}

/** Concatenate the plain-text content under a heading or paragraph node. */
function flattenText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value;
  if (!node.children) return '';
  return node.children.map(flattenText).join('');
}

interface ParsedReport {
  readonly h2Titles: readonly string[];
  readonly anchors: readonly string[];
  readonly leadParagraphLinks: readonly string[];
}

/**
 * Parse a rendered Audit_Report into the three projections the property
 * body needs:
 *
 *   - `h2Titles` — every level-2 heading text in document order.
 *   - `anchors` — every `id` extracted from an `<a id="...">` HTML node.
 *   - `leadParagraphLinks` — every link URL that appears in the lead
 *     paragraph (the second paragraph immediately after the H1 title;
 *     index 1 in the document because the first paragraph is the
 *     "Generated ..." line).
 *
 * The lead paragraph is the one that carries the Requirement-1.7 link list
 * — see `renderTitleAndIntro` in the renderer.
 */
function parseRenderedReport(markdown: string): ParsedReport {
  const { unified, remarkParse, visit } = requireUtils();
  const processor = unified().use(remarkParse);
  const tree = processor.parse(markdown) as MdNode;

  // NOTE on `visit`: in `unist-util-visit@4` shipped via require(esm) on
  // Node 22+, calling `visit(tree, 'type', cb)` invokes the visitor twice
  // per matching node (the type-filtered overload misroutes through
  // `unist-util-visit-parents`). The manual-filter pattern below
  // (`visit(tree, cb)` + `if (n.type === ...)`) is robust against the
  // duplication and produces the expected node count.

  const h2Titles: string[] = [];
  const anchors: string[] = [];
  visit<MdNode>(tree, (node) => {
    if (node.type === 'heading' && node.depth === 2) {
      h2Titles.push(flattenText(node));
      return;
    }
    if (node.type === 'html') {
      const value = node.value ?? '';
      // Anchors are emitted as `<a id="..."></a>` but remark may split the
      // open tag and the closing tag into separate `html` nodes (the
      // splitter changes when `<a>` sits adjacent to a heading). Matching
      // the open-tag form alone is sufficient and tolerant of either case.
      const match = /<a\s+id=["']([^"']+)["']\s*>/i.exec(value);
      if (match && match[1]) anchors.push(match[1]);
    }
  });

  // The lead paragraph is the first top-level paragraph: the renderer
  // emits `Generated <iso> ...\nThis report consolidates ...` separated by
  // a single newline, so remark merges both lines into one paragraph node
  // (paragraphs in CommonMark span until a blank line). The Requirement-
  // 1.7 link list lives in that paragraph alongside the workspace SHA.
  const leadParagraphLinks: string[] = [];
  const topLevel = tree.children ?? [];
  const leadParagraph = topLevel.find((c) => c.type === 'paragraph');
  if (leadParagraph) {
    visit<MdNode>(leadParagraph, (node) => {
      if (node.type === 'link' && typeof node.url === 'string') {
        leadParagraphLinks.push(node.url);
      }
    });
  }

  return { h2Titles, anchors, leadParagraphLinks };
}

// ---------------------------------------------------------------------------
// Run Metadata extraction — Property 2
// ---------------------------------------------------------------------------

interface RunMetadataExtract {
  readonly generated: string | null;
  readonly workspaceSha: string | null;
  readonly graphifyRun: string | null;
}

/**
 * Pull the `Generated`, `Workspace SHA`, and `Graphify Run` values out of
 * the rendered Run Metadata block. The block uses the fixed format
 *   - Generated: <iso>
 *   - Workspace SHA: <sha>
 *   - Graphify Run: <iso>
 * so a line-scan is sufficient.
 */
function extractRunMetadata(markdown: string): RunMetadataExtract {
  const lines = markdown.split('\n');
  let generated: string | null = null;
  let workspaceSha: string | null = null;
  let graphifyRun: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('- Generated:')) {
      generated = line.slice('- Generated:'.length).trim();
    } else if (line.startsWith('- Workspace SHA:')) {
      workspaceSha = line.slice('- Workspace SHA:'.length).trim();
    } else if (line.startsWith('- Graphify Run:')) {
      graphifyRun = line.slice('- Graphify Run:'.length).trim();
    }
  }
  return { generated, workspaceSha, graphifyRun };
}

/**
 * Extract the prose body of the Executive Summary section (the lines
 * between `## Executive Summary` and the next H2). Used by Property 2 to
 * count words against `EXECUTIVE_SUMMARY_WORD_LIMIT`.
 */
function extractExecutiveSummaryBody(markdown: string): string {
  const lines = markdown.split('\n');
  let inside = false;
  const body: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === `## ${SECTION_TITLES.executiveSummary}`) {
      inside = true;
      continue;
    }
    if (inside) {
      // Stop at the next H2 heading or the next anchor block (which
      // immediately precedes the next H2).
      if (line.startsWith('## ')) break;
      if (/^<a\s+id=["'][^"']+["']\s*>\s*<\/a>\s*$/.test(line)) break;
      body.push(line);
    }
  }
  return body.join(' ').trim();
}

// ---------------------------------------------------------------------------
// Property 1 — every required section + intra-document link is present
// ---------------------------------------------------------------------------

describe('renderAuditReport — Property 1: required sections and links', () => {
  const allSectionTitles = Object.values(SECTION_TITLES);

  it('every section title in SECTION_TITLES appears as an H2 with a matching anchor', () => {
    fc.assert(
      fc.property(arbAuditReportData, (data) => {
        const markdown = renderAuditReport(data);
        const parsed = parseRenderedReport(markdown);

        const h2Set = new Set(parsed.h2Titles);
        const anchorSet = new Set(parsed.anchors);

        for (const title of allSectionTitles) {
          // H2 heading text matches the canonical section title verbatim.
          expect(h2Set.has(title)).toBe(true);
          // A matching <a id="<slug>"></a> anchor exists for the title.
          expect(anchorSet.has(slugify(title))).toBe(true);
        }
      }),
    );
  }, 30000);

  it('intra-document links from the lead paragraph resolve to existing anchors', () => {
    fc.assert(
      fc.property(arbAuditReportData, (data) => {
        const markdown = renderAuditReport(data);
        const parsed = parseRenderedReport(markdown);

        const anchorSet = new Set(parsed.anchors);
        const expectedTargets = REQUIREMENT_1_7_LINK_TARGETS.map(slugify);
        const leadHrefSet = new Set(parsed.leadParagraphLinks);

        // Every Requirement 1.7 target appears as a link in the lead
        // paragraph (and resolves to a section anchor).
        for (const slug of expectedTargets) {
          expect(leadHrefSet.has(`#${slug}`)).toBe(true);
        }
        // Every link in the lead paragraph resolves to one of the rendered
        // anchors — no broken intra-document links.
        for (const href of parsed.leadParagraphLinks) {
          expect(href.startsWith('#')).toBe(true);
          const slug = href.slice(1);
          expect(anchorSet.has(slug)).toBe(true);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 — Run Metadata ISO 8601 + Workspace SHA + executive word budget
// ---------------------------------------------------------------------------

describe('renderAuditReport — Property 2: Run Metadata + executive summary budget', () => {
  it('Run Metadata timestamps parse via Date.parse and Workspace SHA is non-empty', () => {
    fc.assert(
      fc.property(arbAuditReportData, (data) => {
        const markdown = renderAuditReport(data);
        const meta = extractRunMetadata(markdown);

        expect(meta.generated).not.toBeNull();
        expect(meta.workspaceSha).not.toBeNull();
        expect(meta.graphifyRun).not.toBeNull();

        // Date.parse accepts the ISO 8601 instant (Requirement 1.4 / 3.5).
        expect(Number.isNaN(Date.parse(meta.generated as string))).toBe(false);
        expect(Number.isNaN(Date.parse(meta.graphifyRun as string))).toBe(false);

        // Workspace SHA is non-empty (Requirement 1.4).
        expect((meta.workspaceSha as string).length).toBeGreaterThan(0);
      }),
    );
  }, 30000);

  it('executive summary word count is <= EXECUTIVE_SUMMARY_WORD_LIMIT', () => {
    fc.assert(
      fc.property(arbAuditReportData, (data) => {
        const markdown = renderAuditReport(data);
        const body = extractExecutiveSummaryBody(markdown);

        // The renderer emits a placeholder when the input summary is empty,
        // and the placeholder is also under the budget. Either way the
        // word count of the rendered body must fit Requirement 1.5.
        expect(countWords(body)).toBeLessThanOrEqual(EXECUTIVE_SUMMARY_WORD_LIMIT);
      }),
    );
  }, 30000);
});

// ---------------------------------------------------------------------------
// Negative property — over-budget executive summary aborts the render
// ---------------------------------------------------------------------------

describe('renderAuditReport — negative: oversized executive summary throws', () => {
  it('throws when executive_summary exceeds EXECUTIVE_SUMMARY_WORD_LIMIT', () => {
    fc.assert(
      fc.property(arbAuditReportData, arbOversizedExecutiveSummary, (data, oversized) => {
        const corrupted: AuditReportData = {
          ...data,
          executive_summary: oversized,
        };
        expect(() => renderAuditReport(corrupted)).toThrow(/executive_summary exceeds/);
      }),
    );
  });
});
