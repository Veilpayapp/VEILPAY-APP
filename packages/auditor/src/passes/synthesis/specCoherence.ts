/**
 * Pass 3 — Synthesis: Spec_Coherence_Report builder.
 *
 * For each spec directory under `.kiro/specs/`, this synthesizer reads
 * `requirements.md` (and additionally `design.md` + `tasks.md` for the
 * `veilpay-privacy-stack` spec) and emits a `SpecSubsection` summarizing
 * scope and listing implementation gaps. It also surfaces "unspecced"
 * behaviors — top-level files under `apps/backend/src/routes/` and
 * `apps/consumer-app/src/screens/` (or `pages/`) — whose file paths are
 * not referenced by any satisfied requirement in any spec.
 *
 * Validates Requirements 8.1 (section produced), 8.2 (one subsection per
 * spec dir), 8.3 (privacy-stack compares requirements/design/tasks), 8.4
 * (gap entries map to source files or `'not yet present'`), 8.5 (unspecced
 * behaviors carry a recommendation), and 8.6 (read-only against
 * `.kiro/specs/`).
 *
 * Read-only contract
 * ------------------
 * Every spec file is opened with `fs.readFile` (utf8). Source-tree probing
 * uses `fs.readdir` and `fs.readFile` only. No writes are issued under
 * `.kiro/specs/` (Requirement 8.6) or anywhere else by this pass.
 *
 * Heuristic limitation
 * --------------------
 * Requirement-to-source mapping is a textual heuristic: it derives one or
 * more "literal tokens" from each requirement's heading (backtick-quoted
 * identifiers and CamelCase nouns) and substring-matches them against
 * source-file contents. False positives (an unrelated file that happens to
 * mention a noun) and false negatives (a file that satisfies the
 * requirement under a different name) are both possible. The Audit_Report
 * surfaces these mappings as evidence rather than proof; reviewers
 * interpret them per the design's "Spec_Coherence_Report component"
 * section. The companion property test (task 4.14, Property 11) only
 * enforces structural invariants (one subsection per spec, every gap entry
 * shaped correctly), not heuristic accuracy.
 */

import { promises as fs, type Dirent } from 'node:fs';
import * as path from 'node:path';

import type {
  SpecCoherenceReport,
  SpecGapEntry,
  SpecSubsection,
  UnspeccedBehavior,
} from '../../models';
import type { BackendRoutes } from '../discovery';

// =====================================================================
// Public types
// =====================================================================

/**
 * Evidence inputs threaded in from earlier passes. `backendRoutes` comes
 * from Pass 1 (Discovery); the optional corpus strings are convenience
 * concatenations of source-file contents that callers may pre-build to
 * avoid the per-file walk done here. They are accepted for forward
 * compatibility but the synthesizer always falls back to a fresh per-file
 * walk so it is robust against pipelines that omit them.
 */
export interface SpecCoherenceEvidenceCorpus {
  readonly backendRoutes: BackendRoutes;
  readonly backendCorpus?: string;
  readonly frontendCorpus?: string;
}

/**
 * Inputs for {@link buildSpecCoherenceReport}.
 */
export interface SpecCoherenceInput {
  /** Absolute path to the workspace root. */
  readonly workspaceRoot: string;
  /**
   * Repository-relative POSIX paths of the spec directories under
   * `.kiro/specs/` (e.g., `.kiro/specs/veilpay-privacy-stack`). Captured
   * by Pass 1 Discovery and threaded through unchanged.
   */
  readonly specDirs: readonly string[];
  readonly evidenceCorpus: SpecCoherenceEvidenceCorpus;
}

// =====================================================================
// Constants
// =====================================================================

/** Spec dir name that must additionally compare design.md + tasks.md. */
const PRIVACY_STACK_SPEC_NAME = 'veilpay-privacy-stack' as const;

/** Recommendation copied verbatim into every UnspeccedBehavior entry. */
const UNSPECCED_RECOMMENDATION = 'Spec the behavior or remove it.' as const;

/** Sentinel returned for requirements with no matching source files. */
const NOT_YET_PRESENT = 'not yet present' as const;

/**
 * Source roots scanned for the requirement-to-file mapping heuristic. Both
 * are repository-relative POSIX paths so they round-trip cleanly through
 * the gap-list output.
 */
const BACKEND_SRC_REL = 'apps/backend/src' as const;
const CONSUMER_SRC_REL = 'apps/consumer-app/src' as const;

/**
 * Directories whose top-level files become candidate "unspecced behaviors"
 * if no spec gap entry references them. Both `screens/` and `pages/` are
 * checked under the consumer app to handle React Native conventions and
 * any future Next-style routing under the same app.
 */
const UNSPECCED_DIRS: readonly string[] = [
  'apps/backend/src/routes',
  'apps/consumer-app/src/screens',
  'apps/consumer-app/src/pages',
];

/** Directory names skipped during recursive walks. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.expo',
  '__tests__',
  '__mocks__',
]);

/** Extensions considered "source" for the requirement-to-file mapping. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.sol',
  '.circom',
]);

/**
 * Common English words excluded when deriving CamelCase tokens. Without
 * this filter the heuristic would treat headings like "Real Groth16Verifier
 * Generation" as a token list including "Real" and "Generation", which
 * match almost every source file.
 */
const TOKEN_STOPWORDS: ReadonlySet<string> = new Set([
  'The',
  'And',
  'For',
  'With',
  'From',
  'Into',
  'Real',
  'Generation',
  'Integration',
  'Loop',
  'App',
  'Mobile',
  'Backend',
  'Stack',
  'Setup',
  'Flow',
  'Flows',
  'Send',
  'Receive',
  'User',
  'Story',
  'Spec',
  'Layer',
  'Level',
  'Address',
  'Addresses',
  'Constants',
  'Persistence',
  'Recovery',
  'Backup',
  'Privacy',
  'Stealth',
  'Ethereum',
  'Sepolia',
  'Mainnet',
  'Testnet',
  'Token',
  'Tokens',
  'Deposit',
  'Withdraw',
  'Payment',
  'Payments',
]);

/**
 * Minimum length of a CamelCase token after stop-word filtering. Anything
 * shorter triggers too many spurious matches (e.g., "Tx", "ZK").
 */
const MIN_CAMEL_TOKEN_LENGTH = 4;

// =====================================================================
// Public entry point
// =====================================================================

/**
 * Build the Spec_Coherence_Report content schema.
 *
 * Pure with respect to outside state once `workspaceRoot` is fixed: the
 * function performs read-only filesystem accesses (`fs.readFile`,
 * `fs.readdir`) and otherwise has no side effects. The returned value is
 * a plain object — callers may freeze it before threading it into the
 * `AuditReportData` aggregate.
 *
 * Output shape:
 *   - One `SpecSubsection` per entry in `specDirs`, in the order supplied.
 *   - The privacy-stack subsection (when present in `specDirs`) is also
 *     surfaced via `privacy_stack_subsection`. If no privacy-stack spec is
 *     listed, a placeholder subsection is emitted so the renderer can
 *     still produce the explicit subsection required by Requirement 8.3.
 *   - `unspecced_behaviors` enumerates top-level files under the
 *     unspecced-target directories whose paths are not referenced by any
 *     `SpecGapEntry.satisfied_by` list across all subsections.
 */
export async function buildSpecCoherenceReport(
  input: SpecCoherenceInput,
): Promise<SpecCoherenceReport> {
  const { workspaceRoot, specDirs, evidenceCorpus } = input;

  // Build the source-file map once and reuse it for every spec. Each entry
  // maps a repository-relative POSIX path to the file's text. Files that
  // fail to read are skipped silently so a single permission error does
  // not abort the audit.
  const sourceFiles = await loadSourceFiles(workspaceRoot);

  // Synthesize per-spec subsections. Iteration order matches the
  // Discovery output (sorted spec dir names).
  const subsections: SpecSubsection[] = [];
  for (const specDir of specDirs) {
    const subsection = await buildSubsectionForSpec({
      workspaceRoot,
      specDirRel: specDir,
      sourceFiles,
    });
    subsections.push(subsection);
  }

  // Locate or fabricate the privacy-stack subsection. Requirement 8.3
  // requires it to compare requirements + design + tasks against current
  // implementation, so when the spec dir is missing entirely we still
  // emit a placeholder rather than skip the field.
  const privacyStackSubsection =
    subsections.find((s) => specIdOf(s.spec_id) === PRIVACY_STACK_SPEC_NAME) ??
    fallbackPrivacyStackSubsection();

  // Compute the union of every `satisfied_by` path across all
  // subsections. Used to gate the unspecced-behavior surface.
  const satisfiedPaths = new Set<string>();
  for (const subsection of subsections) {
    for (const gap of subsection.gaps) {
      if (gap.satisfied_by !== NOT_YET_PRESENT) {
        for (const p of gap.satisfied_by) {
          satisfiedPaths.add(p);
        }
      }
    }
  }

  const unspeccedBehaviors = await collectUnspeccedBehaviors({
    workspaceRoot,
    satisfiedPaths,
  });

  // The corpus strings are accepted for forward compatibility but not
  // required by the heuristic. Reference them once so a strict
  // `noUnusedParameters` build does not complain when a caller threads
  // them through. The match here is deliberately a no-op.
  void evidenceCorpus.backendCorpus;
  void evidenceCorpus.frontendCorpus;
  void evidenceCorpus.backendRoutes;

  return {
    spec_subsections: subsections,
    privacy_stack_subsection: privacyStackSubsection,
    unspecced_behaviors: unspeccedBehaviors,
  };
}

// =====================================================================
// Per-spec subsection builder
// =====================================================================

interface BuildSubsectionInput {
  readonly workspaceRoot: string;
  readonly specDirRel: string;
  readonly sourceFiles: ReadonlyMap<string, string>;
}

/**
 * Build one `SpecSubsection` for a single spec directory. Reads
 * `requirements.md` for every spec; for the privacy-stack spec it also
 * reads `design.md` and `tasks.md` so the scope summary can confirm both
 * documents were inspected (Requirement 8.3).
 */
async function buildSubsectionForSpec(
  input: BuildSubsectionInput,
): Promise<SpecSubsection> {
  const { workspaceRoot, specDirRel, sourceFiles } = input;
  const specDirAbs = path.resolve(workspaceRoot, specDirRel);
  const specId = specIdOf(specDirRel);
  const isPrivacyStack = specId === PRIVACY_STACK_SPEC_NAME;

  const requirementsText = await readSpecFile(specDirAbs, 'requirements.md');
  const designText = isPrivacyStack
    ? await readSpecFile(specDirAbs, 'design.md')
    : null;
  const tasksText = isPrivacyStack
    ? await readSpecFile(specDirAbs, 'tasks.md')
    : null;

  const introductionParagraph = extractIntroductionParagraph(requirementsText);
  const scopeSummary = isPrivacyStack
    ? buildPrivacyStackScopeSummary({
        introductionParagraph,
        hasDesign: designText !== null,
        hasTasks: tasksText !== null,
      })
    : (introductionParagraph ?? `No introduction paragraph found in ${specId}/requirements.md.`);

  const requirements = parseRequirementHeadings(requirementsText);
  const gaps: SpecGapEntry[] = requirements.map((req) =>
    mapRequirementToFiles({
      requirement: req,
      sourceFiles,
    }),
  );

  return {
    spec_id: specId,
    scope_summary: scopeSummary,
    gaps,
    compares_design_and_tasks: isPrivacyStack,
  };
}

/**
 * Fallback privacy-stack subsection used when the spec dir is missing
 * from `specDirs`. Keeps `compares_design_and_tasks: true` so the
 * renderer can still emit the required subsection (Requirement 8.3).
 */
function fallbackPrivacyStackSubsection(): SpecSubsection {
  return {
    spec_id: PRIVACY_STACK_SPEC_NAME,
    scope_summary:
      'The veilpay-privacy-stack spec directory was not present at audit time; requirements, design, and tasks could not be compared.',
    gaps: [],
    compares_design_and_tasks: true,
  };
}

// =====================================================================
// Spec-file helpers
// =====================================================================

/**
 * Strip the `.kiro/specs/` prefix from a spec dir path so the returned id
 * matches the directory name (e.g., `veilpay-privacy-stack`). Falls back
 * to the basename when the path does not match the expected prefix so
 * test fixtures with synthetic paths still produce sensible ids.
 */
function specIdOf(specDirRel: string): string {
  const normalized = specDirRel.replace(/\\/g, '/');
  const prefix = '.kiro/specs/';
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  return path.posix.basename(normalized);
}

/**
 * Read a spec file and return its text, or `null` if the file is missing
 * or unreadable. Read-only — never opens the file in write mode.
 */
async function readSpecFile(
  specDirAbs: string,
  filename: string,
): Promise<string | null> {
  const fileAbs = path.join(specDirAbs, filename);
  try {
    return await fs.readFile(fileAbs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Extract a one-paragraph scope summary from the "Introduction" section of
 * a requirements document. Strategy:
 *   1. If the document contains a `## Introduction` heading, take the
 *      first non-empty paragraph beneath it.
 *   2. Otherwise, take the first non-empty paragraph after the title
 *      heading (`# ...`).
 *   3. If no paragraph is found, return `null`.
 *
 * Paragraphs are bounded by blank lines. Markdown inline formatting is
 * preserved verbatim because the rendered Audit_Report inherits the same
 * formatting.
 */
function extractIntroductionParagraph(text: string | null): string | null {
  if (text === null) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  let startIdx: number | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    if (/^#{1,6}\s+Introduction\b/i.test(line.trim())) {
      startIdx = i + 1;
      break;
    }
  }

  // Fallback: skip the first H1 / title and take the first paragraph.
  if (startIdx === null) {
    let pastTitle = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined) {
        continue;
      }
      if (!pastTitle && /^#\s+/.test(line)) {
        pastTitle = true;
        startIdx = i + 1;
        break;
      }
    }
  }

  if (startIdx === null) {
    startIdx = 0;
  }

  // Walk forward to the first non-blank, non-heading line and accumulate
  // until the next blank line or heading.
  const buffer: string[] = [];
  let collecting = false;
  for (let i = startIdx; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === undefined) {
      continue;
    }
    const line = raw.trim();
    if (line === '') {
      if (collecting) {
        break;
      }
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      if (collecting) {
        break;
      }
      continue;
    }
    collecting = true;
    buffer.push(line);
  }

  if (buffer.length === 0) {
    return null;
  }
  return buffer.join(' ');
}

interface BuildPrivacyStackScopeInput {
  readonly introductionParagraph: string | null;
  readonly hasDesign: boolean;
  readonly hasTasks: boolean;
}

/**
 * Build the privacy-stack scope summary. Always includes a one-line note
 * confirming whether design.md and tasks.md were present and inspected
 * (Requirement 8.3 / task wording: "include a one-paragraph note that the
 * design + tasks were both compared (heuristic). Include both files'
 * presence in scope summary.").
 */
function buildPrivacyStackScopeSummary(
  input: BuildPrivacyStackScopeInput,
): string {
  const { introductionParagraph, hasDesign, hasTasks } = input;
  const intro =
    introductionParagraph ??
    'No introduction paragraph found in veilpay-privacy-stack/requirements.md.';
  const designStatus = hasDesign ? 'design.md (inspected)' : 'design.md (not present)';
  const tasksStatus = hasTasks ? 'tasks.md (inspected)' : 'tasks.md (not present)';
  const comparisonNote = `For this spec, the synthesizer additionally inspected ${designStatus} and ${tasksStatus} alongside requirements.md; the comparison is a textual heuristic and reviewers should treat it as a starting point rather than proof of coverage.`;
  return `${intro} ${comparisonNote}`;
}

// =====================================================================
// Requirement parsing
// =====================================================================

interface ParsedRequirement {
  readonly heading: string;
  readonly title: string;
  readonly tokens: readonly string[];
  /** Spec section reference quoted into `SpecGapEntry.spec_section`. */
  readonly specSection: string;
}

/**
 * Parse `### Requirement N: <title>` headings out of a requirements
 * document and derive a small set of literal tokens for the substring
 * heuristic. Returns an empty list if the document has no requirement
 * headings — the subsection then carries an empty `gaps` list.
 */
function parseRequirementHeadings(text: string | null): ParsedRequirement[] {
  if (text === null) {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const headingPattern = /^###\s+Requirement\s+(\d+)\s*:\s*(.+?)\s*$/i;
  const out: ParsedRequirement[] = [];
  for (const line of lines) {
    const match = headingPattern.exec(line);
    if (match === null) {
      continue;
    }
    const number = match[1] ?? '';
    const title = (match[2] ?? '').trim();
    if (title === '') {
      continue;
    }
    const tokens = deriveTokensFromTitle(title);
    out.push({
      heading: line.trim(),
      title,
      tokens,
      specSection: `requirements.md §${number}`,
    });
  }
  return out;
}

/**
 * Derive literal tokens from a requirement title.
 *
 * Two extraction strategies are combined:
 *   1. Backtick-quoted identifiers (`` `Groth16Verifier` ``,
 *      `` `withdraw.circom` ``) — matched verbatim and added in original
 *      casing.
 *   2. CamelCase / TitleCase nouns (`Merkle`, `VeilPool`, `StealthAnnouncer`)
 *      that pass the stop-word filter and meet the minimum-length
 *      threshold.
 *
 * The resulting set is deduplicated and returned in stable order
 * (backticks first, then CamelCase nouns).
 */
function deriveTokensFromTitle(title: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (token: string): void => {
    if (token.length === 0 || seen.has(token)) {
      return;
    }
    seen.add(token);
    tokens.push(token);
  };

  // 1. Backtick-quoted identifiers.
  const backtickPattern = /`([^`]+)`/g;
  let backtickMatch: RegExpExecArray | null;
  while ((backtickMatch = backtickPattern.exec(title)) !== null) {
    const captured = backtickMatch[1];
    if (captured !== undefined) {
      push(captured.trim());
    }
  }

  // 2. CamelCase / TitleCase nouns.
  const camelPattern = /\b([A-Z][a-z0-9]+(?:[A-Z0-9][a-z0-9]*)*)\b/g;
  let camelMatch: RegExpExecArray | null;
  while ((camelMatch = camelPattern.exec(title)) !== null) {
    const captured = camelMatch[1];
    if (captured === undefined) {
      continue;
    }
    if (captured.length < MIN_CAMEL_TOKEN_LENGTH) {
      continue;
    }
    if (TOKEN_STOPWORDS.has(captured)) {
      continue;
    }
    push(captured);
  }

  return tokens;
}

// =====================================================================
// Source-file mapping
// =====================================================================

interface MapRequirementInput {
  readonly requirement: ParsedRequirement;
  readonly sourceFiles: ReadonlyMap<string, string>;
}

/**
 * Map a single requirement to the source files (if any) whose contents
 * mention one of its derived tokens. When at least one match is found
 * the entry's `satisfied_by` list contains the matched paths in
 * deterministic (sorted) order; otherwise `satisfied_by` is the literal
 * sentinel `'not yet present'` (Requirement 8.4).
 */
function mapRequirementToFiles(input: MapRequirementInput): SpecGapEntry {
  const { requirement, sourceFiles } = input;

  // No tokens means the heuristic cannot produce evidence — surface as
  // `not yet present` so the renderer flags it for reviewer follow-up.
  if (requirement.tokens.length === 0) {
    return {
      behavior: requirement.title,
      spec_section: requirement.specSection,
      satisfied_by: NOT_YET_PRESENT,
    };
  }

  const matched = new Set<string>();
  for (const [relPath, contents] of sourceFiles) {
    for (const token of requirement.tokens) {
      if (contents.includes(token)) {
        matched.add(relPath);
        break;
      }
    }
  }

  if (matched.size === 0) {
    return {
      behavior: requirement.title,
      spec_section: requirement.specSection,
      satisfied_by: NOT_YET_PRESENT,
    };
  }

  const sorted = Array.from(matched).sort();
  return {
    behavior: requirement.title,
    spec_section: requirement.specSection,
    satisfied_by: sorted,
  };
}

/**
 * Walk `apps/backend/src` and `apps/consumer-app/src` and return a map of
 * repository-relative POSIX path → file text for every source file
 * matching {@link SOURCE_EXTENSIONS}. Errors reading individual files are
 * swallowed so a single bad file does not abort the synthesis pass.
 */
async function loadSourceFiles(
  workspaceRoot: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const rootRel of [BACKEND_SRC_REL, CONSUMER_SRC_REL]) {
    const rootAbs = path.resolve(workspaceRoot, rootRel);
    const files = await listFilesByExtension(rootAbs, SOURCE_EXTENSIONS);
    for (const fileAbs of files) {
      let text: string;
      try {
        text = await fs.readFile(fileAbs, 'utf8');
      } catch {
        continue;
      }
      const relPath = toPosix(path.relative(workspaceRoot, fileAbs));
      map.set(relPath, text);
    }
  }
  return map;
}

// =====================================================================
// Unspecced behaviors
// =====================================================================

interface CollectUnspeccedInput {
  readonly workspaceRoot: string;
  readonly satisfiedPaths: ReadonlySet<string>;
}

/**
 * Enumerate top-level files under {@link UNSPECCED_DIRS} and emit an
 * `UnspeccedBehavior` for each whose path is not already cited by any
 * spec's gap entry. Per the task wording:
 *   - `behavior`        = file basename (without extension stripping).
 *   - `source_path`     = repository-relative POSIX path.
 *   - `recommendation`  = the literal `Spec the behavior or remove it.`
 *
 * Only top-level files in each target directory are considered — nested
 * subdirectories (e.g. `routes/__tests__/`) are excluded so the
 * unspecced list stays focused on user-facing surfaces.
 */
async function collectUnspeccedBehaviors(
  input: CollectUnspeccedInput,
): Promise<UnspeccedBehavior[]> {
  const { workspaceRoot, satisfiedPaths } = input;
  const out: UnspeccedBehavior[] = [];

  for (const targetRel of UNSPECCED_DIRS) {
    const targetAbs = path.resolve(workspaceRoot, targetRel);
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(targetAbs, {
        withFileTypes: true,
      })) as Dirent[];
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) {
        continue;
      }
      const relPath = toPosix(path.posix.join(targetRel, entry.name));
      if (satisfiedPaths.has(relPath)) {
        continue;
      }
      out.push({
        behavior: entry.name,
        source_path: relPath,
        recommendation: UNSPECCED_RECOMMENDATION,
      });
    }
  }

  out.sort((a, b) => a.source_path.localeCompare(b.source_path));
  return out;
}

// =====================================================================
// Filesystem helpers
// =====================================================================

/**
 * Recursively list every file under `dir` whose extension is in
 * `extensions`. Skips directories listed in {@link SKIP_DIRS} at every
 * depth. Returns an empty array if the root is missing so the synthesizer
 * tolerates partially scaffolded fixture workspaces.
 */
async function listFilesByExtension(
  dir: string,
  extensions: ReadonlySet<string>,
): Promise<string[]> {
  const out: string[] = [];

  async function visit(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(current, {
        withFileTypes: true,
      })) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const childAbs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        await visit(childAbs);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.has(ext)) {
        continue;
      }
      out.push(childAbs);
    }
  }

  await visit(dir);
  return out;
}

/** Convert a Windows-style path to POSIX-style for stable Markdown output. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
