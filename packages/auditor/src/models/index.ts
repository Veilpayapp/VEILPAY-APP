/**
 * Audit data model.
 *
 * Mirrors the YAML schemas in `.kiro/specs/production-readiness-audit/design.md`
 * "Data Models" section. Every shape here describes the structure of Markdown
 * content the Auditor emits in the consolidated `Audit_Report` at
 * `d:\Veilpay\plans\PRODUCTION_READINESS_AUDIT.md`. Nothing in this module is
 * persisted to a database — the types are content schemas consumed by the
 * Pass 4 renderer.
 *
 * Conventions:
 *   - Score values are integers in the inclusive range 0..100 (rubric bands).
 *   - ISO 8601 timestamps are typed as `string` and validated at the edges.
 *   - Fixed-length collections are encoded as readonly tuples so the type
 *     system carries the cardinality constraint (e.g., 10 complexity hotspots,
 *     4 severity definitions, 3 graphify observations).
 *   - Nullable fields use `T | null` rather than `T | undefined` so the YAML
 *     `null` sentinel maps cleanly into TypeScript.
 */

// =====================================================================
// Branded helpers — string-literal unions used across the audit schema
// =====================================================================

/**
 * Severity classification for any `Vulnerability_Finding` or
 * `Severity_Definition` row. The exact four levels are fixed by Requirement 6.2.
 */
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

/**
 * Disposition assigned to each Plan_Document during the Plans_Library refresh
 * (Requirement 2.4 / 2.5).
 */
export type Disposition = 'updated' | 'superseded';

/**
 * Overall production-readiness verdict. `pass` only when every threshold row
 * passes (Requirement 9.10 / Property 13).
 */
export type Verdict = 'pass' | 'fail';

/**
 * The five rubric dimensions defined by Requirement 2.1 / Property 15. Used as
 * a key set on `Scoring_Rubric` and `Plan_Score`, and as the discriminant on
 * `GapNote.dimension`.
 */
export type RubricDimension =
  | 'security'
  | 'code_quality'
  | 'ux_polish'
  | 'performance'
  | 'production_readiness';

/**
 * Tri-state license compatibility for a `Network_Icon` entry. Per Property 8 a
 * Network_Icon is well-formed when its license sourcing yields one of these
 * three values, and `fallback_action` covers the non-`true` cases.
 */
export type LicenseCompatibility = boolean | 'unknown';

/**
 * Triage classification for workspace-root scripts matching `tmp_*.js`,
 * `autofix.js`, or `audit.js` (Requirement 7.4).
 */
export type ScriptTriageClassification = 'keep' | 'archive' | 'remove';

/**
 * Audit measurement that could not be obtained because a probe failed
 * (Error Handling — soft failures). Used in place of a numeric metric when
 * the underlying tool exited non-zero or is unavailable.
 */
export const UNMEASURED = 'unmeasured' as const;
export type Unmeasured = typeof UNMEASURED;

// =====================================================================
// Numeric helpers — score in 0..100 (rubric range)
// =====================================================================

/**
 * Integer score in the inclusive range 0..100. The TypeScript type system
 * cannot enforce the bound directly, so this alias documents intent and is
 * validated by the property tests for `Scoring_Rubric` and `Plan_Score`.
 */
export type Score = number;

// =====================================================================
// Run Metadata block (Requirements 1.4, 3.5)
// =====================================================================

/**
 * The fixed-shape metadata block that opens every Audit_Report.
 *
 * Mirrors the design.md "Run Metadata block" YAML:
 *   - generated_at: ISO 8601 string
 *   - workspace_sha: string (from `git rev-parse HEAD`)
 *   - graphify_run_at: ISO 8601 string
 *   - auditor: string (name or `"automated"`)
 *
 * Validates Requirements 1.4 (Git SHA + ISO 8601 timestamp) and 3.5
 * (Graphify run timestamp).
 */
export interface RunMetadata {
  /** ISO 8601 timestamp at which the audit run started. */
  readonly generated_at: string;
  /** Output of `git rev-parse HEAD` against the workspace at audit time. */
  readonly workspace_sha: string;
  /** ISO 8601 timestamp for the Graphify_Pipeline invocation. */
  readonly graphify_run_at: string;
  /** Auditor identity — human name or the literal string `"automated"`. */
  readonly auditor: string;
  /** Snapshot of every Plan_Document path discovered during Pass 1. */
  readonly plans_library_snapshot: readonly string[];
}

// =====================================================================
// Scoring rubric and severity definitions (Requirements 2.1, 6.2)
// =====================================================================

/**
 * One band inside a rubric dimension. The five band labels listed in the
 * design "Scoring_Rubric section" (`Excellent` / `Strong` / `Adequate` /
 * `Weak` / `Critical`) partition 0..100 contiguously per Property 15.
 */
export interface ScoringBand {
  readonly label: 'Excellent' | 'Strong' | 'Adequate' | 'Weak' | 'Critical';
  /** Inclusive lower bound. */
  readonly min: Score;
  /** Inclusive upper bound. */
  readonly max: Score;
  /** Plain-language meaning of the band. */
  readonly meaning: string;
}

/**
 * The five-band specification for a single rubric dimension. The bands array
 * is a fixed-length tuple of five entries (Excellent/Strong/Adequate/Weak/
 * Critical) — this matches the table in the design.md "Scoring_Rubric section"
 * and is enforced for Property 15.
 */
export interface RubricDimensionSpec {
  readonly dimension: RubricDimension;
  /** Exactly five contiguous bands covering 0..100. */
  readonly bands: readonly [ScoringBand, ScoringBand, ScoringBand, ScoringBand, ScoringBand];
  /** Pass threshold for this dimension; design fixes this at 85. */
  readonly pass_threshold: Score;
}

/**
 * The Scoring_Rubric section of the Audit_Report. Exactly five dimensions
 * (security, code_quality, ux_polish, performance, production_readiness) are
 * required by Property 15. Encoded as a 5-tuple so the cardinality is part of
 * the type.
 */
export interface ScoringRubric {
  readonly dimensions: readonly [
    RubricDimensionSpec,
    RubricDimensionSpec,
    RubricDimensionSpec,
    RubricDimensionSpec,
    RubricDimensionSpec,
  ];
}

/**
 * One row of the Severity_Definitions section. Exactly four rows
 * (Critical/High/Medium/Low) are required by Requirement 6.2 and enforced by
 * the `SeverityDefinitionList` tuple below.
 */
export interface Severity_Definition {
  readonly level: Severity;
  readonly definition: string;
  /** Short, audit-document-only references — never repository paths. */
  readonly example_findings: readonly string[];
}

/**
 * Fixed-length tuple carrying the four required severity definitions, one per
 * `Severity` level, in the order Critical → High → Medium → Low.
 */
export type SeverityDefinitionList = readonly [
  Severity_Definition,
  Severity_Definition,
  Severity_Definition,
  Severity_Definition,
];

// =====================================================================
// Vulnerability_Finding (Requirements 1.6, 6.3)
// =====================================================================

/**
 * Source-code location for a `Vulnerability_Finding`.
 *
 * Per Requirement 1.6, the `path` is repository-relative and `lines` is
 * present only when the finding pinpoints specific lines (otherwise null).
 * Property 3 enforces that `location.lines` is non-null iff the finding is
 * line-scoped.
 */
export interface FindingLocation {
  /** Repository-relative file path. */
  readonly path: string;
  /** e.g., "L42-L58"; `null` when the finding is file-scope only. */
  readonly lines: string | null;
}

/**
 * A single security issue recorded in the Security_Findings_List.
 *
 * Field set is fixed by Requirement 6.3:
 *   id, title, severity, location, description, remediation, remediation_owner.
 *
 * `id` is the zero-padded sequential string (e.g., `"VULN-0001"`) assigned by
 * the Pass 3 synthesizer.
 */
export interface Vulnerability_Finding {
  readonly id: string;
  readonly title: string;
  readonly severity: Severity;
  readonly location: FindingLocation;
  readonly description: string;
  readonly remediation: string;
  /** Team or role; e.g., `"backend"`, `"consumer-app"`, `"platform"`. */
  readonly remediation_owner: string;
  /** URLs to advisories or skill references. */
  readonly references: readonly string[];
}

// =====================================================================
// Plan_Score / GapNote (Requirements 2.2, 2.6, 2.7)
// =====================================================================

/**
 * A single gap entry attached to a `Plan_Score` whose corresponding rubric
 * dimension scored below the pass threshold. Required by Requirement 2.7 /
 * Property 5: every dimension < 85 must contribute at least one tagged note.
 */
export interface GapNote {
  readonly dimension: RubricDimension;
  /** What specifically dragged the score below pass. */
  readonly note: string;
}

/**
 * The five rubric dimension scores for a single Plan_Document. Keys mirror
 * `RubricDimension` so iteration is straightforward in the renderer.
 */
export interface PlanScoreDimensions {
  readonly security: Score;
  readonly code_quality: Score;
  readonly ux_polish: Score;
  readonly performance: Score;
  readonly production_readiness: Score;
}

/**
 * One row of the Plans_Library Refresh Table. Each canonical Plan_Document
 * (Requirement 2.2) produces exactly one `Plan_Score`.
 */
export interface Plan_Score {
  /** Repository-relative path, e.g., `plans/ROADMAP.md`. */
  readonly plan_path: string;
  readonly disposition: Disposition;
  readonly scores: PlanScoreDimensions;
  /** Non-empty for any dimension < pass threshold; otherwise may be empty. */
  readonly gaps: readonly GapNote[];
  /** Free-text column for the refresh table (e.g., "merged into Consumer_App"). */
  readonly notes: string;
}

// =====================================================================
// Network_Icon (Requirements 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 4.9)
// =====================================================================

/**
 * The eight chain slugs required in the Network_Icon_Set by Requirement 4.2.
 * Property 8 asserts exactly one Network_Icon entry exists per slug.
 */
export type CanonicalChainSlug =
  | 'ethereum'
  | 'polygon'
  | 'base'
  | 'arbitrum'
  | 'optimism'
  | 'solana'
  | 'bnb'
  | 'avalanche';

/**
 * One entry in the Network_Icon_Set replacement plan.
 *
 * `target_filename` must match `^network-[a-z0-9-]+\.svg$` (Property 8).
 * `target_directory` must start with `apps/consumer-app/` (Property 8).
 * When `license_compatible !== true` the `fallback_action` field describes the
 * recommended gap-fill (Requirement 4.9).
 */
export interface Network_Icon {
  readonly chain_slug: string;
  readonly display_name: string;
  /** Repository-relative paths of the asset files currently shipped. */
  readonly current_assets: readonly string[];
  /** Files that import or render the asset. */
  readonly renderer_paths: readonly string[];
  readonly brand_kit_url: string | null;
  readonly license_terms: string | null;
  readonly license_compatible: LicenseCompatibility;
  /** SVG primary asset filename (`network-<chain-slug>.svg`). */
  readonly target_filename: string;
  /** Target directory under `apps/consumer-app/`. */
  readonly target_directory: string;
  /** Populated when `license_compatible !== true` or asset is missing. */
  readonly fallback_action: string | null;
}

// =====================================================================
// Code quality models (Requirements 7.2, 7.3, 7.4, 7.5, 7.6, 7.7)
// =====================================================================

/**
 * Top-N cyclomatic complexity hotspot row. Exactly ten entries are emitted
 * per Requirement 7.6 / Property 10 — see `ComplexityHotspotList` below.
 */
export interface Complexity_Hotspot {
  /** 1..10, dense rank. */
  readonly rank: number;
  /** Repository-relative file path. */
  readonly path: string;
  /** Function name; `"default export"` when anonymous. */
  readonly function: string;
  /** Cyclomatic complexity score (positive integer). */
  readonly score: number;
}

/**
 * Fixed-length tuple of exactly ten complexity hotspots (Requirement 7.6).
 * Encoding the cardinality in the type system means downstream renderers
 * cannot accidentally emit a shorter list.
 */
export type ComplexityHotspotList = readonly [
  Complexity_Hotspot,
  Complexity_Hotspot,
  Complexity_Hotspot,
  Complexity_Hotspot,
  Complexity_Hotspot,
  Complexity_Hotspot,
  Complexity_Hotspot,
  Complexity_Hotspot,
  Complexity_Hotspot,
  Complexity_Hotspot,
];

/**
 * One cluster of duplicated logic spanning at least two of the four apps
 * (apps/backend, apps/consumer-app, apps/frontend, apps/indexer). Property 10
 * enforces the cross-app constraint.
 */
export interface Duplicate_Cluster {
  readonly cluster_id: string;
  /** At least two paths drawn from at least two of the four apps. */
  readonly locations: readonly string[];
  readonly shared_lines: number;
  /** e.g., `"extract to packages/shared/<module>"`. */
  readonly recommendation: string;
}

/**
 * One row in the workspace-root-script triage table (Requirement 7.4).
 * Captured for every file matching `tmp_*.js`, `autofix.js`, or `audit.js`.
 */
export interface ScriptTriage {
  /** Repository-relative path at the workspace root. */
  readonly path: string;
  readonly classification: ScriptTriageClassification;
  /** Non-empty justification per Property 10. */
  readonly justification: string;
}

/**
 * Per-target test coverage summary captured from `coverage-summary.json`.
 * Each percentage is in the inclusive range 0..100, or `unmeasured` when the
 * jest coverage probe failed for that target (Error Handling — soft failure).
 */
export interface CoverageSummary {
  readonly statements: Score | Unmeasured;
  readonly branches: Score | Unmeasured;
  readonly functions: Score | Unmeasured;
  readonly lines: Score | Unmeasured;
}

/**
 * Per-target ESLint result. Counts are non-negative integers, or `unmeasured`
 * when the per-workspace eslint invocation failed.
 */
export interface EslintCount {
  readonly errors: number | Unmeasured;
  readonly warnings: number | Unmeasured;
}

/**
 * Aggregated Code_Quality_Findings_List (design.md "Audit_Report top-level
 * structure"). Keys of the per-target maps are workspace identifiers
 * (e.g., `"apps/backend"`, `"packages/shared"`).
 */
export interface CodeQualityFindings {
  /** Strict-mode coverage % per app/package. */
  readonly ts_strict_coverage: Readonly<Record<string, Score | Unmeasured>>;
  readonly eslint_counts: Readonly<Record<string, EslintCount>>;
  /** One entry per matching root script. */
  readonly root_script_triage: readonly ScriptTriage[];
  readonly test_coverage: Readonly<Record<string, CoverageSummary>>;
  /** Exactly ten hotspots — see `ComplexityHotspotList`. */
  readonly complexity_hotspots: ComplexityHotspotList;
  readonly duplicate_clusters: readonly Duplicate_Cluster[];
}

// =====================================================================
// Spec_Coherence_Report (Requirements 8.1..8.5)
// =====================================================================

/**
 * One mapped requirement inside a Spec_Coherence subsection. Per Requirement
 * 8.4 / Property 11, every entry has a behavior description, a spec section
 * reference, and either a non-empty source-file path list or the literal
 * sentinel `"not yet present"`.
 */
export interface SpecGapEntry {
  readonly behavior: string;
  /** Pointer back into the spec, e.g., `"requirements.md §6.6"`. */
  readonly spec_section: string;
  /**
   * Either a non-empty list of files satisfying the requirement, or the
   * literal `"not yet present"` when the behavior is missing.
   */
  readonly satisfied_by: readonly string[] | 'not yet present';
}

/**
 * Behavior present in the implementation but described by no spec
 * (Requirement 8.5). Each entry carries a recommendation to either spec the
 * behavior or remove it.
 */
export interface UnspeccedBehavior {
  readonly behavior: string;
  /** Repository-relative source file path. */
  readonly source_path: string;
  readonly recommendation: string;
}

/**
 * One Spec_Coherence subsection — exactly one per spec directory under
 * `.kiro/specs/` (Requirement 8.2 / Property 11). The privacy-stack
 * subsection additionally compares `requirements.md`, `design.md`, and
 * `tasks.md` (Requirement 8.3).
 */
export interface SpecSubsection {
  /** Spec directory name, e.g., `"veilpay-privacy-stack"`. */
  readonly spec_id: string;
  /** One-paragraph scope summary. */
  readonly scope_summary: string;
  readonly gaps: readonly SpecGapEntry[];
  /**
   * For the privacy-stack subsection, set to `true` so renderer emits the
   * design + tasks comparison (Requirement 8.3). Other subsections set to
   * `false`.
   */
  readonly compares_design_and_tasks: boolean;
}

/**
 * The Spec_Coherence_Report section as a whole.
 */
export interface SpecCoherenceReport {
  readonly spec_subsections: readonly SpecSubsection[];
  /** Required explicit subsection per Requirement 8.3. */
  readonly privacy_stack_subsection: SpecSubsection;
  readonly unspecced_behaviors: readonly UnspeccedBehavior[];
}

// =====================================================================
// Frontend_Polish_Plan (Requirements 5.1..5.9)
// =====================================================================

/**
 * One typography token. Property 9 requires every entry to carry a positive
 * integer pixel size.
 */
export interface TypographyToken {
  /** e.g., `"display-xl"`, `"body-sm"`. */
  readonly name: string;
  readonly font_size_px: number;
  readonly line_height_px: number;
  readonly weight: number;
  /** `"display"` or `"body"` — paired per the frontend-design skill. */
  readonly family: 'display' | 'body';
}

/**
 * One spacing token on the base-4 scale. Property 9 requires non-negative
 * integer pixel values.
 */
export interface SpacingToken {
  /** e.g., `"space-0"`..`"space-12"`. */
  readonly name: string;
  readonly value_px: number;
}

/**
 * The four required motion entries (screen transitions, button presses,
 * modal entry, modal exit) plus any additional interactions. Property 9
 * requires duration_ms and an easing curve string.
 */
export interface MotionEntry {
  readonly interaction: string;
  readonly duration_ms: number;
  readonly easing: string;
}

/**
 * Empty / loading / error patterns for one surface (e.g., wallet, invoice,
 * transaction history, merchant dashboard). Property 9 requires the four
 * required surfaces all be covered.
 */
export interface StatePatternEntry {
  readonly surface: string;
  readonly empty: string;
  readonly loading: string;
  readonly error: string;
}

/**
 * WCAG accessibility target — Requirement 5.7. The thresholds match the
 * design.md target values (>= 4.5:1 contrast for normal text, >= 3:1 for
 * large text, >= 44pt touch targets).
 */
export interface AccessibilityTarget {
  readonly contrast_normal_min: number;
  readonly contrast_large_min: number;
  readonly touch_target_pt_min: number;
  /** Screens currently verified against the target. */
  readonly verified_screens: readonly string[];
  /** Screens not yet verified. */
  readonly unverified_screens: readonly string[];
}

/**
 * Dark mode parity expectation (Requirement 5.8).
 */
export interface DarkModeParity {
  /** Plain-language definition of "parity". */
  readonly definition: string;
  /** Screens that lack parity at audit time. */
  readonly gaps: readonly string[];
}

/**
 * Haptic pattern entry for Consumer_App interactions (Requirement 5.9).
 */
export interface HapticEntry {
  readonly interaction: string;
  /** e.g., `"impactMedium"`, `"notificationSuccess"`. */
  readonly pattern: string;
}

/**
 * The Frontend_Polish_Plan as a whole. Cites
 * `.agents/anthropics-skills/skills/frontend-design/SKILL.md` per
 * Requirement 5.2.
 */
export interface FrontendPolishPlan {
  /** Skill citation path (Requirement 5.2). */
  readonly authoring_reference: string;
  /** One-line summary of the cited skill. */
  readonly authoring_summary: string;
  readonly typography_scale: readonly TypographyToken[];
  readonly spacing_system: readonly SpacingToken[];
  readonly motion: readonly MotionEntry[];
  readonly state_patterns: readonly StatePatternEntry[];
  readonly accessibility: AccessibilityTarget;
  readonly dark_mode_parity: DarkModeParity;
  readonly haptics: readonly HapticEntry[];
}

// =====================================================================
// Per-surface and cross-cutting Audit_Report sections (Requirements 1.2, 1.3)
// =====================================================================

/**
 * Generic content schema for one Audit_Report section (e.g., Backend_Service
 * or Webhooks). Keeps section content uniform so the renderer can emit
 * stable headings and the property tests can walk subsections deterministically.
 */
export interface AuditSection {
  /** Section title as it appears in Markdown. */
  readonly title: string;
  /** Unique anchor slug used for intra-document links. */
  readonly anchor: string;
  /** One-paragraph summary surfaced by the renderer. */
  readonly summary: string;
  /** Findings scoped to this section (security findings live in their own list). */
  readonly findings: readonly string[];
  /** Repository-relative paths back to the source files this section covers. */
  readonly source_refs: readonly string[];
}

/**
 * The five per-surface sections required by Requirement 1.2. Encoded as a
 * struct of named fields rather than a list so each surface is reachable by
 * key and the renderer enforces the fixed ordering.
 */
export interface PerSurfaceSections {
  readonly backend_service: AuditSection;
  readonly consumer_app: AuditSection;
  readonly frontend_app: AuditSection;
  readonly indexer_service: AuditSection;
  readonly shared_packages: AuditSection;
}

/**
 * The seven cross-cutting sections required by Requirement 1.3.
 */
export interface CrossCuttingSections {
  readonly on_chain_integration: AuditSection;
  readonly webhooks: AuditSection;
  readonly auth_boundaries: AuditSection;
  readonly error_handling: AuditSection;
  readonly observability: AuditSection;
  readonly test_coverage: AuditSection;
  readonly build_and_deploy: AuditSection;
}

// =====================================================================
// Graphify refresh summary (Requirements 3.1..3.6, Property 14)
// =====================================================================

/**
 * Captures the failing graphify (or other tool) invocation per Requirement
 * 3.6 / Property 14. `output_tail` carries at most the last 50 lines of
 * combined stdout/stderr.
 */
export interface FailureCapture {
  /** Exact failing command line, e.g., `"graphify ."`. */
  readonly command: string;
  /** Integer exit code from the failed process. */
  readonly exit_code: number;
  /** Up to 50 lines of combined stdout/stderr — line count is bounded by the harness. */
  readonly output_tail: readonly string[];
  /** ISO 8601 timestamp of the failed invocation. */
  readonly captured_at: string;
}

/**
 * The Graphify_Pipeline refresh summary section. Property 14 enforces:
 * `failure_capture` is non-null iff the invocation exit code was non-zero.
 *
 * `top_observations` is exactly three observations quoted verbatim from
 * `GRAPH_REPORT.md` per Requirement 3.4 — encoded as a 3-tuple so the
 * cardinality is part of the type.
 */
export interface GraphifyRefreshSummary {
  /** ISO 8601 timestamp at which graphify completed. */
  readonly run_at: string;
  /** Repository-relative link target for the regenerated GRAPH_REPORT.md. */
  readonly graph_report_link: string;
  /** Exactly three architectural observations (Requirement 3.4). */
  readonly top_observations: readonly [string, string, string];
  /** Non-null iff the graphify invocation exited non-zero. */
  readonly failure_capture: FailureCapture | null;
}

// =====================================================================
// Production-readiness thresholds + verdict (Requirements 9.1..9.10)
// =====================================================================

/**
 * One row of the Production_Readiness_Thresholds checklist (Requirement 9.1
 * / Property 12). The table has eight required rules in a fixed order; each
 * row carries label, target description, current value, pass status, and a
 * one-line explanation referencing the underlying Audit_Report section.
 */
export interface Production_Readiness_Threshold {
  /** Stable id, 1..N. Order matches the design.md threshold table. */
  readonly id: number;
  /** Short descriptive label, e.g., `"Critical security findings = 0"`. */
  readonly label: string;
  /** Human-readable target, e.g., `"= 0"`, `">= 80%"`. */
  readonly target: string;
  /** Measured value at audit time. */
  readonly current_value: string;
  readonly pass: boolean;
  /** Short, one-line, references the underlying section. */
  readonly explanation: string;
}

// =====================================================================
// Audit_Report top-level structure (design.md "Data Models")
// =====================================================================

/**
 * The complete in-memory representation of the Audit_Report consumed by the
 * Pass 4 renderer. Section ordering in the rendered Markdown is fixed by the
 * design.md "Audit_Report section ordering" list and enforced by the
 * renderer; ordering is not encoded in this struct because every field is
 * named and reachable by key.
 */
export interface AuditReportData {
  readonly metadata: RunMetadata;
  /** <= 500 words per Requirement 1.5 — enforced by Property 2. */
  readonly executive_summary: string;
  readonly scoring_rubric: ScoringRubric;
  readonly severity_definitions: SeverityDefinitionList;
  readonly production_readiness_thresholds: readonly Production_Readiness_Threshold[];
  readonly per_surface_sections: PerSurfaceSections;
  readonly cross_cutting_sections: CrossCuttingSections;
  readonly security_findings_list: readonly Vulnerability_Finding[];
  readonly code_quality_findings_list: CodeQualityFindings;
  readonly spec_coherence_report: SpecCoherenceReport;
  readonly frontend_polish_plan: FrontendPolishPlan;
  readonly network_icon_replacement_plan: readonly Network_Icon[];
  readonly plans_library_refresh: readonly Plan_Score[];
  readonly graphify_refresh_summary: GraphifyRefreshSummary;
  /** Conjunction of every threshold row's `pass` field (Requirement 9.10). */
  readonly verdict: Verdict;
}
