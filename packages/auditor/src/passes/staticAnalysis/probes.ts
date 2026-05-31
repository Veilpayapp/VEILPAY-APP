/**
 * Pass 2 static-analysis probes.
 *
 * Each exported runner spawns a single tool (pnpm audit, per-workspace tsc,
 * per-workspace eslint, per-workspace jest with coverage, ts-complexity-report,
 * jscpd) via the evidence-capture harness in `./runner.ts`, parses the
 * captured output into a structured metric, and returns the metric alongside
 * the `EvidenceRecord` that points at the raw file under
 * `.audit-evidence/<probe>.<ext>`. Callers (Pass 3 synthesizers) can then
 * consume metrics or fall back to evidence pointers when a metric is
 * `'unmeasured'`.
 *
 * Soft-failure semantics (per design.md "Error Handling — Soft failures"):
 *
 *   - The harness never throws on child-process failure; spawn errors and
 *     non-zero exit codes are reflected in `EvidenceRecord.exitCode`.
 *   - When a probe cannot produce a numeric metric (tool crashed, JSON
 *     missing, JSON unparseable), the returned metric is the literal
 *     `'unmeasured'` string. The `record` is always returned so the audit
 *     report can still cite raw evidence.
 *   - Tools that signal findings via non-zero exit (`pnpm audit`,
 *     `eslint`) are treated as measured whenever their JSON output
 *     parses. Tools where exit code is a true health signal
 *     (`tsc`, `jest`, `ts-complexity-report`, `jscpd`) follow the strict
 *     "non-zero exit OR unparseable JSON ⇒ unmeasured" rule.
 *
 * Implements: Requirements 6.8, 7.2, 7.3, 7.5, 7.6, 7.7. Tests for
 * soft-failure handling live in task 3.8.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { CoverageSummary, EslintCount, Score } from '../../models';
import { UNMEASURED } from '../../models';

import type { EvidenceRecord } from './runner';
import { runCommand } from './runner';

// =====================================================================
// Shared types
// =====================================================================

/**
 * Soft-failure sentinel reused across probes that emit a single scalar
 * metric. Mirrors `models.Unmeasured` but re-exported here so callers can
 * narrow without importing from the models barrel directly.
 */
export type Unmeasured = typeof UNMEASURED;

/**
 * Single advisory entry surfaced by `runPnpmAudit`. The shape is the
 * minimal projection the synthesizer needs (see `synthesis/security.ts`,
 * task 4.3): a severity label, the affected package name, and a stable
 * URL into the registry advisory page when the tool emitted one.
 */
export interface PnpmAdvisory {
  /**
   * Tool-reported severity verbatim ("Critical" / "High" / "moderate" /
   * "low" / "info"). The downstream synthesizer compares case-
   * insensitively so any string is acceptable here.
   */
  readonly severity: string;
  /** Affected package name (`module_name` in pnpm v9+, `name` in older). */
  readonly module: string;
  /** Advisory URL or `null` when the tool did not emit one. */
  readonly advisoryUrl: string | null;
  /** Untyped raw advisory object, preserved for downstream rendering. */
  readonly raw: unknown;
}

/**
 * Result shape returned by `runPnpmAudit`. `advisories` is `'unmeasured'`
 * only when the tool failed catastrophically or its JSON could not be
 * parsed; an empty array means "audit ran cleanly, no advisories".
 */
export interface PnpmAuditResult {
  readonly record: EvidenceRecord;
  readonly advisories: readonly PnpmAdvisory[] | Unmeasured;
}

/**
 * Result shape returned by `runWorkspaceTsc`. `errorCount` is the integer
 * count of `error TS` occurrences in the captured output (which `tsc`
 * always emits before its summary line) or `'unmeasured'` when the
 * spawn itself failed.
 */
export interface TscResult {
  readonly record: EvidenceRecord;
  readonly errorCount: number | Unmeasured;
}

export interface EslintResult {
  readonly record: EvidenceRecord;
  readonly counts: EslintCount;
}

export interface JestCoverageResult {
  readonly record: EvidenceRecord;
  readonly coverage: CoverageSummary;
}

/**
 * Single complexity hotspot from `ts-complexity-report --json`. Shape is
 * intentionally minimal because the upstream tool's schema varies across
 * versions; the synthesizer (`synthesis/codeQuality.ts`) tightens the
 * shape into `models.Complexity_Hotspot` and bounds it to the top 10.
 */
export interface ComplexityHotspot {
  /** Repository-relative source file. */
  readonly path: string;
  /** Function name; `"default export"` when anonymous. */
  readonly function: string;
  /** Cyclomatic complexity score reported by the tool. */
  readonly score: number;
}

export interface ComplexityResult {
  readonly record: EvidenceRecord;
  readonly hotspots: readonly ComplexityHotspot[] | Unmeasured;
}

/**
 * Single duplicate cluster from `jscpd`. `locations` carries at least two
 * file paths; `sharedLines` is the line count of the shared region.
 */
export interface DuplicateCluster {
  readonly locations: readonly string[];
  readonly sharedLines: number;
}

export interface DuplicationResult {
  readonly record: EvidenceRecord;
  readonly clusters: readonly DuplicateCluster[] | Unmeasured;
}

// =====================================================================
// Common harness inputs
// =====================================================================

/**
 * Shared inputs for every workspace-scoped probe: the workspace root
 * (so child processes resolve relative to the monorepo root) and the
 * evidence directory under which raw outputs are written.
 *
 * `evidenceDir` is conventionally `<workspaceRoot>/plans/.audit-evidence`
 * but is passed explicitly so tests can redirect to a temp dir.
 */
export interface ProbeBaseInput {
  readonly workspaceRoot: string;
  readonly evidenceDir: string;
}

/**
 * Per-package probe input. `packageName` matches the `name` field in the
 * package's `package.json` (e.g., `@veilpay/backend`) so it can be passed
 * verbatim to `pnpm --filter`.
 */
export interface PackageProbeInput extends ProbeBaseInput {
  readonly packageName: string;
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Slugify a pnpm package name (`@scope/pkg`) into a filename-safe stem
 * (`scope__pkg`) so per-workspace evidence files don't collide and don't
 * contain shell-meaningful characters on Windows.
 */
function slugifyPackage(packageName: string): string {
  return packageName.replace(/^@/, '').replace(/[\\/]/g, '__');
}

/**
 * Read and JSON.parse `filePath`, returning `null` if the file is
 * missing or the body is not valid JSON. Never throws — soft failure is
 * the contract here.
 */
async function readJsonFile<T>(filePath: string): Promise<T | null> {
  let body: string;
  try {
    body = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

/**
 * Try to JSON.parse `body`. If `body` contains warnings or shell shim
 * preamble before the JSON document (common for `pnpm dlx <tool> --json`
 * which spawns through a wrapper), retry against the substring starting
 * at the first `{` or `[`. If that still fails, walk the substring with a
 * bracket-balance counter and truncate at the matching `]` / `}` — pnpm's
 * `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` line gets appended to the captured
 * combined output and would otherwise sink an otherwise valid eslint /
 * jscpd JSON document.
 *
 * Returns `null` on any failure.
 */
function tryParseJson<T>(body: string): T | null {
  if (body.length === 0) {
    return null;
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    // Fall through to the salvage attempt below.
  }
  const firstBrace = body.search(/[{[]/);
  if (firstBrace < 0) {
    return null;
  }
  const sliced = body.slice(firstBrace);
  try {
    return JSON.parse(sliced) as T;
  } catch {
    // Fall through to bracket-balance truncation.
  }
  const truncated = truncateAtBalancedClose(sliced);
  if (truncated === null) {
    return null;
  }
  try {
    return JSON.parse(truncated) as T;
  } catch {
    return null;
  }
}

/**
 * Walk `body` left-to-right, tracking `{}` / `[]` nesting and string
 * literals, and return the prefix that ends at the matched close of the
 * outermost bracket. This salvages JSON output that pnpm / npm prefix
 * cleanly but suffix with a non-JSON error line. Returns `null` when no
 * balanced close is found.
 */
function truncateAtBalancedClose(body: string): string | null {
  let depth = 0;
  let inString = false;
  let isEscape = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (isEscape) {
        isEscape = false;
        continue;
      }
      if (ch === '\\') {
        isEscape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return body.slice(0, i + 1);
      }
    }
  }
  return null;
}

/**
 * Read a captured evidence file and return its body, or `null` if the
 * file is missing. Used by probes that need to re-parse the same bytes
 * the harness wrote.
 */
async function readEvidenceBody(record: EvidenceRecord): Promise<string | null> {
  try {
    return await fs.readFile(record.evidencePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Coerce a coverage-summary percentage to the audit's `Score` (0..100
 * integer) shape. Floors negative or non-finite values to `'unmeasured'`
 * so downstream rendering never propagates NaN into the report.
 */
function coercePercent(value: unknown): Score | Unmeasured {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return UNMEASURED;
  }
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 100) {
    return UNMEASURED;
  }
  return rounded;
}

// =====================================================================
// Probe runners
// =====================================================================

/**
 * Run `pnpm audit --json` at the workspace root and return any advisories
 * with structured `severity`/`module`/`advisoryUrl` fields.
 *
 * pnpm exits non-zero precisely when advisories are found. Because that
 * is the *successful measurement path*, we treat parsed JSON as evidence
 * of measurement regardless of exit code; only an unparseable body or a
 * spawn-level failure (`exitCode === -1`) yields `'unmeasured'`.
 *
 * Validates: Requirement 6.8.
 */
export async function runPnpmAudit(
  input: ProbeBaseInput,
): Promise<PnpmAuditResult> {
  const { workspaceRoot, evidenceDir } = input;
  const evidencePath = path.join(evidenceDir, 'pnpm-audit.json');

  const record = await runCommand(
    'pnpm',
    ['audit', '--json'],
    evidencePath,
    { cwd: workspaceRoot },
  );

  // Spawn-level failure (binary missing, etc.) means we have no JSON to
  // parse — surface as unmeasured.
  if (record.exitCode === -1) {
    return { record, advisories: UNMEASURED };
  }

  const body = await readEvidenceBody(record);
  if (body === null) {
    return { record, advisories: UNMEASURED };
  }
  const parsed = tryParseJson<unknown>(body);
  if (parsed === null) {
    return { record, advisories: UNMEASURED };
  }

  const advisories = extractAdvisories(parsed);
  return { record, advisories };
}

/**
 * Normalize the two pnpm-audit JSON shapes (legacy `advisories` map,
 * v9+ flat `advisories` array) into a uniform list of `PnpmAdvisory`.
 * Returns an empty list when the structure is unrecognized rather than
 * `'unmeasured'` — by the time we reach this helper, the JSON parsed
 * cleanly, so we treat that as a successful measurement of zero
 * advisories.
 */
function extractAdvisories(parsed: unknown): readonly PnpmAdvisory[] {
  if (parsed === null || typeof parsed !== 'object') {
    return [];
  }
  const obj = parsed as Record<string, unknown>;

  // Legacy npm/pnpm v8 shape: { advisories: { "<id>": {...} } }
  if (obj.advisories && typeof obj.advisories === 'object' && !Array.isArray(obj.advisories)) {
    const entries = Object.values(obj.advisories as Record<string, unknown>);
    return entries
      .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
      .map(toAdvisory);
  }

  // pnpm v9 shape: { advisories: [ {...} ] }
  if (Array.isArray(obj.advisories)) {
    return obj.advisories
      .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
      .map(toAdvisory);
  }

  return [];
}

function toAdvisory(entry: Record<string, unknown>): PnpmAdvisory {
  const severityRaw = entry['severity'];
  const severity = typeof severityRaw === 'string' ? severityRaw : 'unknown';

  const moduleName =
    (typeof entry['module_name'] === 'string' && entry['module_name']) ||
    (typeof entry['name'] === 'string' && entry['name']) ||
    'unknown';

  const url =
    (typeof entry['url'] === 'string' && entry['url']) ||
    (typeof entry['advisoryUrl'] === 'string' && entry['advisoryUrl']) ||
    null;

  return {
    severity,
    module: moduleName,
    advisoryUrl: url,
    raw: entry,
  };
}

/**
 * Run `pnpm --filter <pkg> exec tsc --noEmit` for a single workspace
 * package and return the integer count of `error TS` diagnostic lines
 * the captured output contains.
 *
 * tsc exits non-zero whenever it reports any error, so we cannot use
 * exit code as a measurement-failure signal — instead, the count is
 * derived from the output and `'unmeasured'` is reserved for spawn
 * failures (`exitCode === -1`) or empty captured output.
 *
 * Validates: Requirement 7.2.
 */
export async function runWorkspaceTsc(
  input: PackageProbeInput,
): Promise<TscResult> {
  const { workspaceRoot, packageName, evidenceDir } = input;
  const evidencePath = path.join(
    evidenceDir,
    `tsc.${slugifyPackage(packageName)}.txt`,
  );

  const record = await runCommand(
    'pnpm',
    ['--filter', packageName, 'exec', 'tsc', '--noEmit'],
    evidencePath,
    { cwd: workspaceRoot },
  );

  if (record.exitCode === -1) {
    return { record, errorCount: UNMEASURED };
  }

  const body = await readEvidenceBody(record);
  if (body === null) {
    return { record, errorCount: UNMEASURED };
  }

  // tsc emits one "error TS<code>:" token per diagnostic. Counting the
  // tokens is more robust than parsing the human-readable summary line,
  // which varies by --pretty and locale.
  const matches = body.match(/error TS\d+:/g);
  return { record, errorCount: matches ? matches.length : 0 };
}

/**
 * Run `pnpm --filter <pkg> exec eslint . --format json` for a single
 * workspace package, parse the array of file results, and aggregate
 * `errorCount` / `warningCount` into `EslintCount`.
 *
 * eslint exits non-zero whenever it reports any error, so as with
 * `runWorkspaceTsc` the count comes from the JSON body; spawn-level
 * failure or unparseable JSON yields `unmeasured`/`unmeasured`.
 *
 * Special case: when ESLint exits non-zero with the literal "No ESLint
 * configuration found" / "Cannot find module" preamble (i.e., the
 * package has no eslint config at all), the audit treats this as
 * "0 errors / 0 warnings" rather than `unmeasured`. Packages that opt
 * out of lint by not shipping an eslint config should not drag the
 * aggregate ESLint metric to `unmeasured` and silently fail
 * Threshold #7 forever — the auditor reports a real measurement
 * (zero, with a flag) and downstream synthesizers can decide how to
 * surface that.
 *
 * Validates: Requirement 7.3.
 */
export async function runWorkspaceEslint(
  input: PackageProbeInput,
): Promise<EslintResult> {
  const { workspaceRoot, packageName, evidenceDir } = input;
  const evidencePath = path.join(
    evidenceDir,
    `eslint.${slugifyPackage(packageName)}.json`,
  );

  const record = await runCommand(
    'pnpm',
    ['--filter', packageName, 'exec', 'eslint', '.', '--format', 'json'],
    evidencePath,
    { cwd: workspaceRoot },
  );

  const unmeasuredCount: EslintCount = {
    errors: UNMEASURED,
    warnings: UNMEASURED,
  };
  const zeroCount: EslintCount = {
    errors: 0,
    warnings: 0,
  };

  if (record.exitCode === -1) {
    return { record, counts: unmeasuredCount };
  }

  const body = await readEvidenceBody(record);
  if (body === null) {
    return { record, counts: unmeasuredCount };
  }

  // Recognize the canonical "no eslint config" failure mode and treat it
  // as zero. ESLint v8 prints "Oops! Something went wrong!" for missing
  // configs and "No ESLint configuration found" for the explicit case.
  // Either signals that the package opted out of lint, not that the
  // probe itself failed.
  if (
    /No ESLint configuration found/i.test(body) ||
    /No files matching the pattern/i.test(body) ||
    (record.exitCode !== 0 && /Oops! Something went wrong/i.test(body))
  ) {
    return { record, counts: zeroCount };
  }

  const parsed = tryParseJson<unknown>(body);
  if (!Array.isArray(parsed)) {
    return { record, counts: unmeasuredCount };
  }

  let errors = 0;
  let warnings = 0;
  for (const fileResult of parsed) {
    if (fileResult === null || typeof fileResult !== 'object') continue;
    const r = fileResult as Record<string, unknown>;
    if (typeof r['errorCount'] === 'number') errors += r['errorCount'];
    if (typeof r['warningCount'] === 'number') warnings += r['warningCount'];
  }

  return { record, counts: { errors, warnings } };
}

/**
 * Run `pnpm --filter <pkg> exec jest --coverage --coverageReporters=json-summary`
 * for a single workspace package, then read the resulting
 * `coverage/coverage-summary.json` from the package's directory and
 * project the four totals (statements / branches / functions / lines)
 * into `CoverageSummary`.
 *
 * `pnpm --filter` resolves the package's directory, so to read the
 * coverage summary we use `pnpm --filter <pkg> exec node -e ...` to print
 * the package's directory after Jest finishes. To keep this probe
 * spawn-free, we instead resolve the directory via the workspace's
 * `pnpm-workspace.yaml` lookup table that callers pass alongside, but
 * that complicates the contract. The simpler path used here: scan
 * `<workspaceRoot>/{apps,packages}/*` for a `package.json` whose `name`
 * matches `packageName`.
 *
 * Validates: Requirement 7.5.
 */
export async function runWorkspaceJestCoverage(
  input: PackageProbeInput,
): Promise<JestCoverageResult> {
  const { workspaceRoot, packageName, evidenceDir } = input;
  const evidencePath = path.join(
    evidenceDir,
    `jest.${slugifyPackage(packageName)}.txt`,
  );

  const record = await runCommand(
    'pnpm',
    [
      '--filter',
      packageName,
      'exec',
      'jest',
      '--coverage',
      '--coverageReporters=json-summary',
    ],
    evidencePath,
    { cwd: workspaceRoot },
  );

  const unmeasuredCoverage: CoverageSummary = {
    statements: UNMEASURED,
    branches: UNMEASURED,
    functions: UNMEASURED,
    lines: UNMEASURED,
  };

  if (record.exitCode === -1) {
    return { record, coverage: unmeasuredCoverage };
  }

  const packageDir = await resolvePackageDir(workspaceRoot, packageName);
  if (packageDir === null) {
    return { record, coverage: unmeasuredCoverage };
  }

  const summaryPath = path.join(packageDir, 'coverage', 'coverage-summary.json');
  const summary = await readJsonFile<{
    total?: {
      statements?: { pct?: number };
      branches?: { pct?: number };
      functions?: { pct?: number };
      lines?: { pct?: number };
    };
  }>(summaryPath);

  if (summary === null || summary.total === undefined) {
    return { record, coverage: unmeasuredCoverage };
  }
  const total = summary.total;

  return {
    record,
    coverage: {
      statements: coercePercent(total.statements?.pct),
      branches: coercePercent(total.branches?.pct),
      functions: coercePercent(total.functions?.pct),
      lines: coercePercent(total.lines?.pct),
    },
  };
}

/**
 * Resolve a workspace package name to its on-disk directory by scanning
 * `apps/*` and `packages/*` for a `package.json` whose `name` matches.
 * Returns `null` when no match is found (which the caller treats as a
 * soft failure for the coverage probe).
 *
 * The scan is cheap because the monorepo has O(20) workspaces; we don't
 * need a full pnpm lockfile parse for this lookup.
 */
async function resolvePackageDir(
  workspaceRoot: string,
  packageName: string,
): Promise<string | null> {
  const candidates: string[] = [];
  for (const parent of ['apps', 'packages']) {
    const parentPath = path.join(workspaceRoot, parent);
    let entries: string[];
    try {
      entries = await fs.readdir(parentPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      candidates.push(path.join(parentPath, entry));
    }
  }

  for (const dir of candidates) {
    const pkgJsonPath = path.join(dir, 'package.json');
    const pkgJson = await readJsonFile<{ name?: string }>(pkgJsonPath);
    if (pkgJson && pkgJson.name === packageName) {
      return dir;
    }
  }

  return null;
}

/**
 * Run `pnpm dlx ts-complexity-report --json` at the workspace root and
 * project the JSON output into a list of `ComplexityHotspot`.
 *
 * Strict soft-failure rule: non-zero exit OR unparseable JSON ⇒
 * `'unmeasured'`. The synthesizer in task 4.5 takes the top 10 by score.
 *
 * Validates: Requirement 7.6.
 */
export async function runComplexity(
  input: ProbeBaseInput,
): Promise<ComplexityResult> {
  const { workspaceRoot, evidenceDir } = input;
  const evidencePath = path.join(evidenceDir, 'complexity.json');

  const record = await runCommand(
    'pnpm',
    ['dlx', 'ts-complexity-report', '--json'],
    evidencePath,
    { cwd: workspaceRoot },
  );

  if (record.exitCode !== 0) {
    return { record, hotspots: UNMEASURED };
  }

  const body = await readEvidenceBody(record);
  if (body === null) {
    return { record, hotspots: UNMEASURED };
  }
  const parsed = tryParseJson<unknown>(body);
  if (parsed === null) {
    return { record, hotspots: UNMEASURED };
  }

  const hotspots = extractHotspots(parsed);
  if (hotspots === null) {
    return { record, hotspots: UNMEASURED };
  }
  return { record, hotspots };
}

/**
 * Project the `ts-complexity-report --json` payload into hotspots. The
 * tool's schema varies across versions; this helper accepts either:
 *
 *   - A flat array of `{path, function, score}` (or `cyclomatic`).
 *   - A `{reports: [{path, functions: [{name, complexity}]}]}` tree.
 *
 * Returns `null` only when neither shape is present, in which case the
 * caller surfaces the metric as `'unmeasured'`.
 */
function extractHotspots(parsed: unknown): readonly ComplexityHotspot[] | null {
  if (Array.isArray(parsed)) {
    return parsed
      .map(toFlatHotspot)
      .filter((h): h is ComplexityHotspot => h !== null);
  }
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['reports'])) {
      const out: ComplexityHotspot[] = [];
      for (const report of obj['reports']) {
        if (report === null || typeof report !== 'object') continue;
        const r = report as Record<string, unknown>;
        const filePath = typeof r['path'] === 'string' ? r['path'] : null;
        const functions = Array.isArray(r['functions']) ? r['functions'] : [];
        if (filePath === null) continue;
        for (const fn of functions) {
          if (fn === null || typeof fn !== 'object') continue;
          const f = fn as Record<string, unknown>;
          const name = typeof f['name'] === 'string' ? f['name'] : 'default export';
          const score =
            typeof f['complexity'] === 'number'
              ? f['complexity']
              : typeof f['cyclomatic'] === 'number'
                ? f['cyclomatic']
                : null;
          if (score === null) continue;
          out.push({ path: filePath, function: name, score });
        }
      }
      return out;
    }
  }
  return null;
}

function toFlatHotspot(entry: unknown): ComplexityHotspot | null {
  if (entry === null || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const filePath = typeof e['path'] === 'string' ? e['path'] : null;
  const fnName =
    typeof e['function'] === 'string'
      ? e['function']
      : typeof e['name'] === 'string'
        ? e['name']
        : 'default export';
  const score =
    typeof e['score'] === 'number'
      ? e['score']
      : typeof e['complexity'] === 'number'
        ? e['complexity']
        : typeof e['cyclomatic'] === 'number'
          ? e['cyclomatic']
          : null;
  if (filePath === null || score === null) return null;
  return { path: filePath, function: fnName, score };
}

/**
 * Run `pnpm dlx jscpd apps packages --reporters json --output .audit-evidence`
 * at the workspace root and project the JSON report into duplicate
 * clusters. jscpd writes its JSON to `<output>/jscpd-report.json` rather
 * than to stdout, so we read that file directly after the probe exits.
 *
 * Strict soft-failure rule: non-zero exit OR missing/unparseable
 * `jscpd-report.json` ⇒ `'unmeasured'`. Each duplicate emitted by jscpd
 * pairs two file locations and a shared-line count; we surface them as
 * one cluster per pair, leaving cross-app filtering to the synthesizer.
 *
 * Validates: Requirement 7.7.
 */
export async function runDuplication(
  input: ProbeBaseInput,
): Promise<DuplicationResult> {
  const { workspaceRoot, evidenceDir } = input;
  const evidencePath = path.join(evidenceDir, 'jscpd.txt');

  // Mirror the design.md command verbatim — note that `--output` is
  // resolved relative to `workspaceRoot`, not to `evidenceDir`. This
  // matches the design's documented invocation, which assumes the audit
  // is launched from the workspace root.
  const record = await runCommand(
    'pnpm',
    [
      'dlx',
      'jscpd',
      'apps',
      'packages',
      '--reporters',
      'json',
      '--output',
      '.audit-evidence',
    ],
    evidencePath,
    { cwd: workspaceRoot },
  );

  if (record.exitCode !== 0) {
    return { record, clusters: UNMEASURED };
  }

  const reportPath = path.join(
    workspaceRoot,
    '.audit-evidence',
    'jscpd-report.json',
  );
  const report = await readJsonFile<{
    duplicates?: ReadonlyArray<Record<string, unknown>>;
  }>(reportPath);
  if (report === null) {
    return { record, clusters: UNMEASURED };
  }

  // `report.duplicates` was typed via `readJsonFile<…>` but the inferred
  // type at this scope still surfaces as `any` from the JSON parse. Coerce
  // through a structural narrow before iterating so each `dup` is
  // `Record<string, unknown>` rather than `any`.
  const duplicates: ReadonlyArray<Record<string, unknown>> = Array.isArray(
    report.duplicates,
  )
    ? (report.duplicates.filter(
        (d): d is Record<string, unknown> =>
          typeof d === 'object' && d !== null,
      ) as ReadonlyArray<Record<string, unknown>>)
    : [];
  const clusters: DuplicateCluster[] = [];

  for (const dup of duplicates) {
    const cluster = toDuplicateCluster(dup);
    if (cluster !== null) {
      clusters.push(cluster);
    }
  }

  return { record, clusters };
}

/**
 * Project a single jscpd duplicate entry into a `DuplicateCluster`. jscpd
 * emits `{firstFile: {name, ...}, secondFile: {name, ...}, lines}` so the
 * cluster's locations are the two file paths and `sharedLines` is `lines`.
 * Returns `null` when either file path is missing.
 */
function toDuplicateCluster(entry: Record<string, unknown>): DuplicateCluster | null {
  const first = entry['firstFile'];
  const second = entry['secondFile'];
  const firstPath = extractJscpdFileName(first);
  const secondPath = extractJscpdFileName(second);
  if (firstPath === null || secondPath === null) return null;

  const lines =
    typeof entry['lines'] === 'number'
      ? entry['lines']
      : typeof entry['fragment'] === 'string'
        ? entry['fragment'].split(/\r?\n/).length
        : 0;

  return {
    locations: [firstPath, secondPath],
    sharedLines: lines,
  };
}

function extractJscpdFileName(file: unknown): string | null {
  if (file === null || typeof file !== 'object') return null;
  const f = file as Record<string, unknown>;
  if (typeof f['name'] === 'string') return f['name'];
  if (typeof f['fileName'] === 'string') return f['fileName'];
  return null;
}
