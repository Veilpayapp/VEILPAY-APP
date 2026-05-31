/**
 * Pure Markdown renderer for the consolidated `Audit_Report`.
 *
 * Implements the Pass 4 emission step described in
 * `.kiro/specs/production-readiness-audit/design.md`:
 *   - Emits the 16 fixed-order sections in the exact order specified by the
 *     design's "Audit_Report section ordering" list (Title + Run Metadata,
 *     Executive Summary, Scoring_Rubric, Severity_Definitions,
 *     Production_Readiness_Thresholds, five per-surface sections, seven
 *     cross-cutting sections, Security_Findings_List, Code_Quality_Findings_List,
 *     Spec_Coherence_Report, Frontend_Polish_Plan, Network_Icon Replacement
 *     Plan, Plans_Library Refresh Table, Graphify Refresh Summary,
 *     Pass/Fail Verdict, Appendices).
 *   - Emits intra-document links from the title lead paragraph to the five
 *     lists referenced by Requirement 1.7.
 *   - Renders the Run Metadata block with ISO 8601 `Generated`, non-empty
 *     `Workspace SHA`, and ISO 8601 `Graphify Run` per Requirements 1.4 and 3.5.
 *   - Enforces the executive summary <= 500 word budget (Requirement 1.5)
 *     by throwing on contract violation. The renderer is pure but throwing
 *     on violation is the mechanism that lets Pass 4 abort before any write.
 *
 * Slug strategy (used for every section anchor and intra-document link):
 *   1. Lowercase the section title.
 *   2. Replace any run of non-`[a-z0-9]` characters with a single underscore.
 *   3. Strip leading and trailing underscores.
 *
 * Rationale: this matches the link targets enumerated in the task notes
 * (`#security_findings_list`, `#network_icon_replacement_plan`, etc.) and is
 * stable across Markdown renderers. Each H2 is preceded by an explicit
 * `<a id="..."></a>` anchor so the slug strategy is renderer-independent
 * (GitHub's auto-slugger uses hyphens; we use underscores).
 *
 * The renderer is a pure function: it performs no I/O, captures no external
 * state, and is fully determined by `input`. Property tests parse the output
 * with `remark` to verify section presence and link resolution.
 */

import type {
  AuditReportData,
  AuditSection,
  CodeQualityFindings,
  FrontendPolishPlan,
  GraphifyRefreshSummary,
  Network_Icon,
  Plan_Score,
  Production_Readiness_Threshold,
  RunMetadata,
  ScoringRubric,
  SeverityDefinitionList,
  SpecCoherenceReport,
  Verdict,
  Vulnerability_Finding,
} from '../models';

// =====================================================================
// Public helpers — exported so property tests can reuse the slug strategy
// =====================================================================

/**
 * Maximum word count permitted in the executive summary (Requirement 1.5).
 */
export const EXECUTIVE_SUMMARY_WORD_LIMIT = 500;

/**
 * Slugify a section title into the anchor used by the renderer.
 *
 *   - Lowercase.
 *   - Replace runs of non-`[a-z0-9]` characters with a single `_`.
 *   - Strip leading and trailing `_`.
 *
 * Examples:
 *   slugify("Security_Findings_List")          -> "security_findings_list"
 *   slugify("Network_Icon Replacement Plan")   -> "network_icon_replacement_plan"
 *   slugify("Pass/Fail Verdict")               -> "pass_fail_verdict"
 *   slugify("Shared packages/*")               -> "shared_packages"
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Count whitespace-delimited words in a string.
 *
 * Used to enforce the executive summary word budget. Empty / whitespace-only
 * input returns 0.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).filter((token) => token.length > 0).length;
}

// =====================================================================
// Canonical section titles (fixed ordering — design.md)
// =====================================================================

/**
 * Canonical H2 titles for every section in the rendered Audit_Report. Every
 * section's anchor is `slugify(SECTION_TITLES.<key>)`. Titles are intentionally
 * frozen so downstream property tests can resolve them statically.
 */
export const SECTION_TITLES = {
  runMetadata: 'Run Metadata',
  executiveSummary: 'Executive Summary',
  scoringRubric: 'Scoring_Rubric',
  severityDefinitions: 'Severity_Definitions',
  productionReadinessThresholds: 'Production_Readiness_Thresholds',
  // five per-surface sections (Requirement 1.2)
  backendService: 'Backend_Service',
  consumerApp: 'Consumer_App',
  frontendApp: 'Frontend_App',
  indexerService: 'Indexer_Service',
  sharedPackages: 'Shared packages/*',
  // seven cross-cutting sections (Requirement 1.3)
  onChainIntegration: 'On-chain integration',
  webhooks: 'Webhooks',
  authBoundaries: 'Auth boundaries',
  errorHandling: 'Error handling',
  observability: 'Observability',
  testCoverage: 'Test coverage',
  buildAndDeploy: 'Build and deploy',
  // bottom sections
  securityFindings: 'Security_Findings_List',
  codeQualityFindings: 'Code_Quality_Findings_List',
  specCoherence: 'Spec_Coherence_Report',
  frontendPolish: 'Frontend_Polish_Plan',
  networkIconPlan: 'Network_Icon Replacement Plan',
  plansLibraryRefresh: 'Plans_Library Refresh Table',
  graphifyRefresh: 'Graphify Refresh Summary',
  passFailVerdict: 'Pass/Fail Verdict',
  appendices: 'Appendices',
} as const;

/**
 * The five list sections the title lead paragraph must link to (Requirement
 * 1.7). Order matches the requirement enumeration.
 */
export const REQUIREMENT_1_7_LINK_TARGETS: readonly string[] = [
  SECTION_TITLES.securityFindings,
  SECTION_TITLES.codeQualityFindings,
  SECTION_TITLES.specCoherence,
  SECTION_TITLES.frontendPolish,
  SECTION_TITLES.networkIconPlan,
] as const;

/**
 * Every section title in the order they are emitted. Used by the appendix to
 * publish a stable anchor map.
 */
const ALL_SECTIONS_IN_ORDER: readonly string[] = [
  SECTION_TITLES.runMetadata,
  SECTION_TITLES.executiveSummary,
  SECTION_TITLES.scoringRubric,
  SECTION_TITLES.severityDefinitions,
  SECTION_TITLES.productionReadinessThresholds,
  SECTION_TITLES.backendService,
  SECTION_TITLES.consumerApp,
  SECTION_TITLES.frontendApp,
  SECTION_TITLES.indexerService,
  SECTION_TITLES.sharedPackages,
  SECTION_TITLES.onChainIntegration,
  SECTION_TITLES.webhooks,
  SECTION_TITLES.authBoundaries,
  SECTION_TITLES.errorHandling,
  SECTION_TITLES.observability,
  SECTION_TITLES.testCoverage,
  SECTION_TITLES.buildAndDeploy,
  SECTION_TITLES.securityFindings,
  SECTION_TITLES.codeQualityFindings,
  SECTION_TITLES.specCoherence,
  SECTION_TITLES.frontendPolish,
  SECTION_TITLES.networkIconPlan,
  SECTION_TITLES.plansLibraryRefresh,
  SECTION_TITLES.graphifyRefresh,
  SECTION_TITLES.passFailVerdict,
  SECTION_TITLES.appendices,
] as const;


// =====================================================================
// Validation — preconditions checked before any text is emitted
// =====================================================================

/**
 * Loose ISO 8601 instant matcher: `YYYY-MM-DDTHH:MM:SS(.sss)?(Z|±HH:MM)`.
 * Strict enough to catch obvious garbage, lenient enough to accept the
 * timestamps captured by Pass 1 (`new Date().toISOString()`) and Pass 2.
 */
const ISO_8601_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function assertIso8601(label: string, value: string): void {
  if (!ISO_8601_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(
      `renderAuditReport: ${label} must be an ISO 8601 instant; got ${JSON.stringify(value)}`,
    );
  }
}

function assertNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`renderAuditReport: ${label} must be non-empty`);
  }
}

// =====================================================================
// Markdown formatting helpers (no external dependencies)
// =====================================================================

/**
 * Escape a single Markdown table cell. Replaces newlines with `<br>` so cells
 * stay on one logical row, and escapes pipe characters so they do not break
 * the column boundary.
 */
function escapeCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/**
 * Render a Markdown table from a header row and an array of rows. All cells
 * are escaped via `escapeCell`. An empty `rows` array produces just the
 * header + separator rows so the section is still parseable.
 */
function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines: string[] = [];
  lines.push(`| ${header.map(escapeCell).join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map(escapeCell).join(' | ')} |`);
  }
  return lines.join('\n');
}

/**
 * Render an explicit anchor + H2 heading pair.
 *
 *   <a id="<slug>"></a>
 *   ## <title>
 *
 * The explicit `<a id>` makes intra-document links stable across Markdown
 * renderers (GitHub uses hyphenated auto-slugs; the design fixes underscored
 * slugs).
 */
function renderH2(title: string): string {
  const slug = slugify(title);
  return `<a id="${slug}"></a>\n## ${title}`;
}

/**
 * Format a Markdown link to an intra-document anchor for `title`.
 */
function intraDocLink(title: string): string {
  return `[${title}](#${slugify(title)})`;
}

// =====================================================================
// Per-section renderers
// =====================================================================

function renderTitleAndIntro(metadata: RunMetadata): string {
  const links = REQUIREMENT_1_7_LINK_TARGETS.map(intraDocLink).join(', ');
  return [
    '# Production Readiness Audit Report',
    '',
    `Generated ${metadata.generated_at} for workspace SHA \`${metadata.workspace_sha}\`.`,
    `This report consolidates the planning-only production-readiness audit and links to ${links}.`,
  ].join('\n');
}

function renderRunMetadata(metadata: RunMetadata): string {
  assertIso8601('metadata.generated_at', metadata.generated_at);
  assertNonEmpty('metadata.workspace_sha', metadata.workspace_sha);
  assertIso8601('metadata.graphify_run_at', metadata.graphify_run_at);
  assertNonEmpty('metadata.auditor', metadata.auditor);

  const snapshot =
    metadata.plans_library_snapshot.length === 0
      ? '_(no plan documents discovered)_'
      : metadata.plans_library_snapshot.map((path) => `\`${path}\``).join(', ');

  return [
    renderH2(SECTION_TITLES.runMetadata),
    '',
    `- Generated: ${metadata.generated_at}`,
    `- Workspace SHA: ${metadata.workspace_sha}`,
    `- Graphify Run: ${metadata.graphify_run_at}`,
    `- Auditor: ${metadata.auditor}`,
    `- Plans_Library Snapshot: ${snapshot}`,
  ].join('\n');
}

function renderExecutiveSummary(summary: string): string {
  const wordCount = countWords(summary);
  if (wordCount > EXECUTIVE_SUMMARY_WORD_LIMIT) {
    throw new Error(
      `renderAuditReport: executive_summary exceeds ${EXECUTIVE_SUMMARY_WORD_LIMIT}-word budget (Requirement 1.5); got ${wordCount} words`,
    );
  }
  const body = summary.trim().length === 0 ? '_(no executive summary provided)_' : summary.trim();
  return [renderH2(SECTION_TITLES.executiveSummary), '', body].join('\n');
}

function renderScoringRubric(rubric: ScoringRubric): string {
  const sections: string[] = [renderH2(SECTION_TITLES.scoringRubric), ''];
  for (const dim of rubric.dimensions) {
    sections.push(`### ${dim.dimension}`);
    sections.push('');
    sections.push(`Pass threshold: **${dim.pass_threshold}**.`);
    sections.push('');
    sections.push(
      renderTable(
        ['Band', 'Range', 'Meaning'],
        dim.bands.map((band) => [band.label, `${band.min}-${band.max}`, band.meaning]),
      ),
    );
    sections.push('');
  }
  return sections.join('\n').trimEnd();
}

function renderSeverityDefinitions(severities: SeverityDefinitionList): string {
  const rows = severities.map((sev) => [
    sev.level,
    sev.definition,
    sev.example_findings.length === 0 ? '—' : sev.example_findings.join('; '),
  ]);
  return [
    renderH2(SECTION_TITLES.severityDefinitions),
    '',
    renderTable(['Level', 'Definition', 'Example Findings'], rows),
  ].join('\n');
}

function renderProductionReadinessThresholds(
  thresholds: readonly Production_Readiness_Threshold[],
): string {
  const rows = thresholds.map((t) => [
    String(t.id),
    t.label,
    t.target,
    t.current_value,
    t.pass ? 'pass' : 'fail',
    t.explanation,
  ]);
  return [
    renderH2(SECTION_TITLES.productionReadinessThresholds),
    '',
    renderTable(['#', 'Threshold', 'Target', 'Current Value', 'Pass', 'Explanation'], rows),
  ].join('\n');
}

function renderAuditSection(title: string, section: AuditSection): string {
  const lines: string[] = [renderH2(title), ''];
  if (section.summary.trim().length > 0) {
    lines.push(section.summary.trim());
    lines.push('');
  }
  if (section.findings.length > 0) {
    lines.push('**Findings:**');
    lines.push('');
    for (const finding of section.findings) {
      lines.push(`- ${finding}`);
    }
    lines.push('');
  }
  if (section.source_refs.length > 0) {
    lines.push('**Source references:**');
    lines.push('');
    for (const ref of section.source_refs) {
      lines.push(`- \`${ref}\``);
    }
  }
  return lines.join('\n').trimEnd();
}

function renderVulnerabilityFinding(finding: Vulnerability_Finding): string {
  const locationLabel = finding.location.lines
    ? `\`${finding.location.path}\` (${finding.location.lines})`
    : `\`${finding.location.path}\``;
  const lines: string[] = [
    `#### ${finding.id} — ${finding.title}`,
    '',
    `- **Severity:** ${finding.severity}`,
    `- **Location:** ${locationLabel}`,
    `- **Description:** ${finding.description}`,
    `- **Remediation:** ${finding.remediation}`,
    `- **Owner:** ${finding.remediation_owner}`,
  ];
  if (finding.references.length > 0) {
    lines.push(`- **References:** ${finding.references.join(', ')}`);
  }
  return lines.join('\n');
}

function renderSecurityFindingsList(findings: readonly Vulnerability_Finding[]): string {
  const lines: string[] = [renderH2(SECTION_TITLES.securityFindings), ''];
  if (findings.length === 0) {
    lines.push('_No security findings recorded._');
    return lines.join('\n');
  }
  for (const finding of findings) {
    lines.push(renderVulnerabilityFinding(finding));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}


function renderCodeQualityFindings(cq: CodeQualityFindings): string {
  const lines: string[] = [renderH2(SECTION_TITLES.codeQualityFindings), ''];

  // Strict-mode coverage.
  lines.push('### TypeScript strict-mode coverage');
  lines.push('');
  const strictRows = Object.entries(cq.ts_strict_coverage).map(([target, value]) => [
    target,
    typeof value === 'number' ? `${value}%` : value,
  ]);
  lines.push(renderTable(['Target', 'Strict %'], strictRows));
  lines.push('');

  // ESLint counts.
  lines.push('### ESLint counts');
  lines.push('');
  const eslintRows = Object.entries(cq.eslint_counts).map(([target, counts]) => [
    target,
    typeof counts.errors === 'number' ? String(counts.errors) : counts.errors,
    typeof counts.warnings === 'number' ? String(counts.warnings) : counts.warnings,
  ]);
  lines.push(renderTable(['Target', 'Errors', 'Warnings'], eslintRows));
  lines.push('');

  // Root-script triage.
  lines.push('### Workspace-root script triage');
  lines.push('');
  const triageRows = cq.root_script_triage.map((entry) => [
    entry.path,
    entry.classification,
    entry.justification,
  ]);
  lines.push(renderTable(['Path', 'Classification', 'Justification'], triageRows));
  lines.push('');

  // Test coverage.
  lines.push('### Test coverage');
  lines.push('');
  const coverageRows = Object.entries(cq.test_coverage).map(([target, summary]) => [
    target,
    typeof summary.statements === 'number' ? `${summary.statements}%` : summary.statements,
    typeof summary.branches === 'number' ? `${summary.branches}%` : summary.branches,
    typeof summary.functions === 'number' ? `${summary.functions}%` : summary.functions,
    typeof summary.lines === 'number' ? `${summary.lines}%` : summary.lines,
  ]);
  lines.push(
    renderTable(['Target', 'Statements', 'Branches', 'Functions', 'Lines'], coverageRows),
  );
  lines.push('');

  // Complexity hotspots.
  lines.push('### Top complexity hotspots');
  lines.push('');
  const hotspotRows = cq.complexity_hotspots.map((h) => [
    String(h.rank),
    h.path,
    h.function,
    String(h.score),
  ]);
  lines.push(renderTable(['Rank', 'Path', 'Function', 'Score'], hotspotRows));
  lines.push('');

  // Duplicate clusters.
  lines.push('### Duplicate clusters');
  lines.push('');
  if (cq.duplicate_clusters.length === 0) {
    lines.push('_No cross-app duplicate clusters detected._');
  } else {
    const clusterRows = cq.duplicate_clusters.map((c) => [
      c.cluster_id,
      c.locations.join('; '),
      String(c.shared_lines),
      c.recommendation,
    ]);
    lines.push(
      renderTable(['Cluster', 'Locations', 'Shared Lines', 'Recommendation'], clusterRows),
    );
  }

  return lines.join('\n').trimEnd();
}

function renderSpecCoherenceReport(report: SpecCoherenceReport): string {
  const lines: string[] = [renderH2(SECTION_TITLES.specCoherence), ''];

  for (const sub of report.spec_subsections) {
    lines.push(`### ${sub.spec_id}`);
    lines.push('');
    lines.push(sub.scope_summary);
    lines.push('');
    if (sub.compares_design_and_tasks) {
      lines.push('_Compares `requirements.md`, `design.md`, and `tasks.md` against current implementation._');
      lines.push('');
    }
    if (sub.gaps.length === 0) {
      lines.push('_No implementation gaps identified._');
    } else {
      lines.push('**Implementation gaps:**');
      lines.push('');
      for (const gap of sub.gaps) {
        // Normalise `gap.satisfied_by` to a single string so the template
        // expression has a concrete type (the rule rejects
        // `string | readonly string[]` even though Array.prototype.toString
        // would coerce it).
        const satisfiedBy: string = Array.isArray(gap.satisfied_by)
          ? gap.satisfied_by.length === 0
            ? 'not yet present'
            : gap.satisfied_by.map((p) => `\`${p}\``).join(', ')
          : (gap.satisfied_by as string);
        lines.push(`- **${gap.behavior}** (${gap.spec_section}) → ${satisfiedBy}`);
      }
    }
    lines.push('');
  }

  // Privacy-stack subsection (Requirement 8.3) — explicitly emitted even
  // though it may also appear in spec_subsections.
  const privacy = report.privacy_stack_subsection;
  lines.push(`### ${privacy.spec_id} (cross-check)`);
  lines.push('');
  lines.push(privacy.scope_summary);
  lines.push('');
  lines.push('_Compares `requirements.md`, `design.md`, and `tasks.md` against current implementation._');
  lines.push('');
  if (privacy.gaps.length === 0) {
    lines.push('_No gaps surfaced._');
  } else {
    for (const gap of privacy.gaps) {
      const satisfiedBy: string = Array.isArray(gap.satisfied_by)
        ? gap.satisfied_by.length === 0
          ? 'not yet present'
          : gap.satisfied_by.map((p) => `\`${p}\``).join(', ')
        : (gap.satisfied_by as string);
      lines.push(`- **${gap.behavior}** (${gap.spec_section}) → ${satisfiedBy}`);
    }
  }
  lines.push('');

  // Unspecced behaviors (Requirement 8.5).
  lines.push('### Unspecced behaviors');
  lines.push('');
  if (report.unspecced_behaviors.length === 0) {
    lines.push('_No unspecced behaviors recorded._');
  } else {
    for (const entry of report.unspecced_behaviors) {
      lines.push(
        `- **${entry.behavior}** at \`${entry.source_path}\` — ${entry.recommendation}`,
      );
    }
  }
  return lines.join('\n').trimEnd();
}

function renderFrontendPolishPlan(plan: FrontendPolishPlan): string {
  const lines: string[] = [renderH2(SECTION_TITLES.frontendPolish), ''];
  lines.push(`**Authoring reference:** \`${plan.authoring_reference}\``);
  lines.push('');
  lines.push(plan.authoring_summary);
  lines.push('');

  lines.push('### Typography scale');
  lines.push('');
  lines.push(
    renderTable(
      ['Token', 'Family', 'Size (px)', 'Line height (px)', 'Weight'],
      plan.typography_scale.map((t) => [
        t.name,
        t.family,
        String(t.font_size_px),
        String(t.line_height_px),
        String(t.weight),
      ]),
    ),
  );
  lines.push('');

  lines.push('### Spacing system');
  lines.push('');
  lines.push(
    renderTable(
      ['Token', 'Value (px)'],
      plan.spacing_system.map((s) => [s.name, String(s.value_px)]),
    ),
  );
  lines.push('');

  lines.push('### Motion and transitions');
  lines.push('');
  lines.push(
    renderTable(
      ['Interaction', 'Duration (ms)', 'Easing'],
      plan.motion.map((m) => [m.interaction, String(m.duration_ms), m.easing]),
    ),
  );
  lines.push('');

  lines.push('### State patterns');
  lines.push('');
  lines.push(
    renderTable(
      ['Surface', 'Empty', 'Loading', 'Error'],
      plan.state_patterns.map((p) => [p.surface, p.empty, p.loading, p.error]),
    ),
  );
  lines.push('');

  lines.push('### Accessibility (WCAG 2.1 AA)');
  lines.push('');
  lines.push(`- Normal text contrast min: **${plan.accessibility.contrast_normal_min}:1**`);
  lines.push(`- Large text contrast min: **${plan.accessibility.contrast_large_min}:1**`);
  lines.push(`- Touch target min: **${plan.accessibility.touch_target_pt_min}pt**`);
  lines.push('');
  lines.push('**Verified screens:**');
  if (plan.accessibility.verified_screens.length === 0) {
    lines.push('- _none_');
  } else {
    for (const screen of plan.accessibility.verified_screens) {
      lines.push(`- ${screen}`);
    }
  }
  lines.push('');
  lines.push('**Unverified screens:**');
  if (plan.accessibility.unverified_screens.length === 0) {
    lines.push('- _none_');
  } else {
    for (const screen of plan.accessibility.unverified_screens) {
      lines.push(`- ${screen}`);
    }
  }
  lines.push('');

  lines.push('### Dark-mode parity');
  lines.push('');
  lines.push(plan.dark_mode_parity.definition);
  lines.push('');
  lines.push('**Gaps:**');
  if (plan.dark_mode_parity.gaps.length === 0) {
    lines.push('- _none_');
  } else {
    for (const gap of plan.dark_mode_parity.gaps) {
      lines.push(`- ${gap}`);
    }
  }
  lines.push('');

  lines.push('### Haptics');
  lines.push('');
  lines.push(
    renderTable(
      ['Interaction', 'Pattern'],
      plan.haptics.map((h) => [h.interaction, h.pattern]),
    ),
  );

  return lines.join('\n').trimEnd();
}

function renderNetworkIconPlan(icons: readonly Network_Icon[]): string {
  const lines: string[] = [renderH2(SECTION_TITLES.networkIconPlan), ''];
  if (icons.length === 0) {
    lines.push('_No Network_Icon entries recorded._');
    return lines.join('\n');
  }
  const rows = icons.map((icon) => [
    icon.chain_slug,
    icon.display_name,
    icon.target_filename,
    icon.target_directory,
    icon.brand_kit_url ?? '—',
    icon.license_terms ?? '—',
    String(icon.license_compatible),
    icon.fallback_action ?? '—',
  ]);
  lines.push(
    renderTable(
      [
        'Chain',
        'Display',
        'Target Filename',
        'Target Directory',
        'Brand Kit',
        'License',
        'Compatible',
        'Fallback Action',
      ],
      rows,
    ),
  );
  lines.push('');

  lines.push('### Renderer surfaces');
  lines.push('');
  for (const icon of icons) {
    const renderers =
      icon.renderer_paths.length === 0
        ? '_no current renderer_'
        : icon.renderer_paths.map((p) => `\`${p}\``).join(', ');
    lines.push(`- **${icon.chain_slug}**: ${renderers}`);
  }
  return lines.join('\n').trimEnd();
}

function renderPlansLibraryRefresh(plans: readonly Plan_Score[]): string {
  const lines: string[] = [renderH2(SECTION_TITLES.plansLibraryRefresh), ''];
  if (plans.length === 0) {
    lines.push('_No Plan_Documents discovered._');
    return lines.join('\n');
  }
  const rows = plans.map((p) => [
    `\`${p.plan_path}\``,
    p.disposition,
    String(p.scores.security),
    String(p.scores.code_quality),
    String(p.scores.ux_polish),
    String(p.scores.performance),
    String(p.scores.production_readiness),
    p.notes,
  ]);
  lines.push(
    renderTable(
      [
        'Plan_Document',
        'Disposition',
        'Security',
        'Code Quality',
        'UX Polish',
        'Performance',
        'Production-Readiness',
        'Notes',
      ],
      rows,
    ),
  );
  lines.push('');

  // Per Requirement 2.7 / Property 5: any dimension < 85 must surface tagged
  // gap notes. Render the gap list per plan when present.
  const plansWithGaps = plans.filter((p) => p.gaps.length > 0);
  if (plansWithGaps.length > 0) {
    lines.push('### Sub-pass gap notes');
    lines.push('');
    for (const plan of plansWithGaps) {
      lines.push(`- \`${plan.plan_path}\``);
      for (const gap of plan.gaps) {
        lines.push(`  - **${gap.dimension}**: ${gap.note}`);
      }
    }
  }
  return lines.join('\n').trimEnd();
}

function renderGraphifyRefreshSummary(summary: GraphifyRefreshSummary): string {
  assertIso8601('graphify_refresh_summary.run_at', summary.run_at);
  const lines: string[] = [renderH2(SECTION_TITLES.graphifyRefresh), ''];
  lines.push(`- Run at: ${summary.run_at}`);
  lines.push(`- Graph report: [GRAPH_REPORT.md](${summary.graph_report_link})`);
  lines.push('');
  lines.push('**Top observations:**');
  lines.push('');
  for (const obs of summary.top_observations) {
    lines.push(`> ${obs}`);
    lines.push('>');
  }
  // Trim the trailing empty blockquote line.
  while (lines.length > 0 && lines[lines.length - 1] === '>') {
    lines.pop();
  }
  if (summary.failure_capture) {
    lines.push('');
    lines.push('**Failure capture:**');
    lines.push('');
    lines.push(`- Command: \`${summary.failure_capture.command}\``);
    lines.push(`- Exit code: ${summary.failure_capture.exit_code}`);
    lines.push(`- Captured at: ${summary.failure_capture.captured_at}`);
    lines.push('');
    lines.push('```');
    for (const line of summary.failure_capture.output_tail) {
      lines.push(line);
    }
    lines.push('```');
  }
  return lines.join('\n').trimEnd();
}

function renderVerdict(verdict: Verdict): string {
  const headline =
    verdict === 'pass'
      ? 'PASS — every Production_Readiness_Threshold row is `pass`.'
      : 'FAIL — at least one Production_Readiness_Threshold row is `fail`.';
  return [renderH2(SECTION_TITLES.passFailVerdict), '', `**Verdict:** ${verdict}`, '', headline].join(
    '\n',
  );
}

function renderAppendices(): string {
  const lines: string[] = [renderH2(SECTION_TITLES.appendices), ''];
  lines.push('### Anchor map');
  lines.push('');
  lines.push(
    'Slug strategy: lowercase, runs of non-alphanumeric characters collapse to a single `_`, leading and trailing `_` stripped.',
  );
  lines.push('');
  lines.push(
    renderTable(
      ['Section', 'Anchor'],
      ALL_SECTIONS_IN_ORDER.map((title) => [title, `#${slugify(title)}`]),
    ),
  );
  lines.push('');
  lines.push('### Evidence pointers');
  lines.push('');
  lines.push(
    'Raw command outputs from Pass 2 are written under `d:\\Veilpay\\plans\\.audit-evidence\\` and referenced from the relevant audit sections.',
  );
  return lines.join('\n').trimEnd();
}

// =====================================================================
// Top-level renderer
// =====================================================================

/**
 * Pure renderer for the consolidated `Audit_Report`.
 *
 * Throws (rather than returning a partial document) when:
 *   - `metadata.generated_at` is not a valid ISO 8601 instant.
 *   - `metadata.workspace_sha` is empty / whitespace-only.
 *   - `metadata.graphify_run_at` is not a valid ISO 8601 instant.
 *   - `executive_summary` exceeds the 500-word budget (Requirement 1.5).
 *
 * These contract violations abort Pass 4 before any write hits disk, which
 * is the mechanism the design relies on for "abort on property failure".
 */
export function renderAuditReport(input: AuditReportData): string {
  const sections: string[] = [];

  // 1. Title + Run Metadata
  sections.push(renderTitleAndIntro(input.metadata));
  sections.push(renderRunMetadata(input.metadata));

  // 2. Executive Summary (<= 500 words)
  sections.push(renderExecutiveSummary(input.executive_summary));

  // 3. Scoring_Rubric
  sections.push(renderScoringRubric(input.scoring_rubric));

  // 4. Severity_Definitions
  sections.push(renderSeverityDefinitions(input.severity_definitions));

  // 5. Production_Readiness_Thresholds
  sections.push(renderProductionReadinessThresholds(input.production_readiness_thresholds));

  // 6. Per-surface sections (fixed order)
  const ps = input.per_surface_sections;
  sections.push(renderAuditSection(SECTION_TITLES.backendService, ps.backend_service));
  sections.push(renderAuditSection(SECTION_TITLES.consumerApp, ps.consumer_app));
  sections.push(renderAuditSection(SECTION_TITLES.frontendApp, ps.frontend_app));
  sections.push(renderAuditSection(SECTION_TITLES.indexerService, ps.indexer_service));
  sections.push(renderAuditSection(SECTION_TITLES.sharedPackages, ps.shared_packages));

  // 7. Cross-cutting sections (fixed order)
  const cc = input.cross_cutting_sections;
  sections.push(renderAuditSection(SECTION_TITLES.onChainIntegration, cc.on_chain_integration));
  sections.push(renderAuditSection(SECTION_TITLES.webhooks, cc.webhooks));
  sections.push(renderAuditSection(SECTION_TITLES.authBoundaries, cc.auth_boundaries));
  sections.push(renderAuditSection(SECTION_TITLES.errorHandling, cc.error_handling));
  sections.push(renderAuditSection(SECTION_TITLES.observability, cc.observability));
  sections.push(renderAuditSection(SECTION_TITLES.testCoverage, cc.test_coverage));
  sections.push(renderAuditSection(SECTION_TITLES.buildAndDeploy, cc.build_and_deploy));

  // 8. Security_Findings_List
  sections.push(renderSecurityFindingsList(input.security_findings_list));

  // 9. Code_Quality_Findings_List
  sections.push(renderCodeQualityFindings(input.code_quality_findings_list));

  // 10. Spec_Coherence_Report
  sections.push(renderSpecCoherenceReport(input.spec_coherence_report));

  // 11. Frontend_Polish_Plan
  sections.push(renderFrontendPolishPlan(input.frontend_polish_plan));

  // 12. Network_Icon Replacement Plan
  sections.push(renderNetworkIconPlan(input.network_icon_replacement_plan));

  // 13. Plans_Library Refresh Table
  sections.push(renderPlansLibraryRefresh(input.plans_library_refresh));

  // 14. Graphify Refresh Summary
  sections.push(renderGraphifyRefreshSummary(input.graphify_refresh_summary));

  // 15. Pass/Fail Verdict
  sections.push(renderVerdict(input.verdict));

  // 16. Appendices
  sections.push(renderAppendices());

  return sections.join('\n\n') + '\n';
}
