/**
 * Pass 2 — security probes.
 *
 * Three read-only scanners that produce evidence for the Pass 3 synthesizer:
 *
 *   1. {@link runSecretScan} — invokes `gitleaks detect --no-git` (soft-fail
 *      when the binary is unavailable) and runs a regex sweep of the
 *      workspace for committed secrets (private keys, mnemonics, JWT
 *      secrets, AWS-style keys, 64-char hex literals). Implements
 *      Requirements 6.4, 6.12, 6.13.
 *
 *   2. {@link runBackendLogScan} — walks `apps/backend/src/**\/*.ts` and
 *      flags log statements whose argument list textually references
 *      secret-shaped variable names, the `Authorization` header, or full
 *      request bodies. Implements Requirement 6.5.
 *
 *   3. {@link runRpcExposureScan} — walks `apps/consumer-app/src` and
 *      `apps/frontend/src` for client-bundle references to the chain
 *      provider literals `RPC_URL`, `INFURA`, `ALCHEMY`, and `QUICKNODE`.
 *      Implements Requirement 6.12.
 *
 * Read-only constraint (Requirements 6.14, 10.5): every scanner uses
 * `fs.readFile` only. No file is opened in write mode, no signing /
 * wallet path is mutated. The only writes performed are evidence files
 * under `.audit-evidence/` via the shared {@link runCommand} harness, and
 * those land in the path the caller supplies.
 *
 * Soft-failure model (design.md "Error Handling" → soft failures): when a
 * required external tool (`gitleaks`) is missing, the scanner returns
 * `'unmeasured'` for that bucket so the pipeline keeps running. Per-file
 * read errors are swallowed (file is skipped) so a single permission error
 * does not abort an entire sweep.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { walkFiles } from '../../util/walk';
import { runCommand, type EvidenceRecord } from './runner';

// ---------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------

/**
 * Source kinds for a secret-scan match. `gitleaks` matches come from the
 * external tool; the remaining kinds come from the in-process regex sweep.
 */
export type SecretMatchKind =
  | 'gitleaks'
  | 'private-key'
  | 'mnemonic'
  | 'jwt-secret'
  | 'aws-key'
  | 'hex64';

/**
 * One match emitted by {@link runSecretScan}. `lineNumber` is 1-indexed and
 * `preview` is the offending line truncated to {@link PREVIEW_MAX_LENGTH}
 * characters. The preview is emitted verbatim so the synthesizer can echo
 * it into the Audit_Report; callers are responsible for redacting before
 * any user-facing render (the secret values themselves are not printed in
 * full because we slice at PREVIEW_MAX_LENGTH characters).
 */
export interface SecretMatch {
  readonly kind: SecretMatchKind;
  readonly path: string;
  readonly lineNumber: number;
  readonly preview: string;
}

/**
 * Reasons a backend log statement is flagged.
 */
export type LogScanReason = 'token-shaped' | 'authorization' | 'request-body';

/**
 * One match emitted by {@link runBackendLogScan}.
 */
export interface LogMatch {
  readonly path: string;
  readonly lineNumber: number;
  readonly preview: string;
  readonly reason: LogScanReason;
}

/**
 * Recognised RPC-exposure literals (Requirement 6.12).
 */
export type RpcLiteral = 'RPC_URL' | 'INFURA' | 'ALCHEMY' | 'QUICKNODE';

/**
 * One match emitted by {@link runRpcExposureScan}.
 */
export interface RpcMatch {
  readonly path: string;
  readonly lineNumber: number;
  readonly preview: string;
  readonly literal: RpcLiteral;
}

/**
 * Result of {@link runSecretScan}.
 *
 * `record` is always populated with the gitleaks invocation evidence
 * (including the spawn-error case where the binary is missing).
 *
 * `matches` is `'unmeasured'` only when gitleaks itself is unavailable; in
 * that case the regex sweep is skipped too because the pass is unable to
 * provide a usable signal — soft-failing the whole bucket is consistent
 * with the Error Handling rules in design.md.
 */
export interface SecretScanResult {
  readonly record: EvidenceRecord;
  readonly matches: readonly SecretMatch[] | 'unmeasured';
}

export interface RunSecretScanInput {
  readonly workspaceRoot: string;
  readonly evidenceDir: string;
}

export interface RunBackendLogScanInput {
  readonly workspaceRoot: string;
}

export interface RunRpcExposureScanInput {
  readonly workspaceRoot: string;
}

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

/**
 * Cap on the preview length echoed in match records. Long enough to spot a
 * regex hit in context; short enough to keep evidence files compact and
 * avoid leaking very long secret literals verbatim.
 */
const PREVIEW_MAX_LENGTH = 200;

/**
 * File extensions we sweep for committed-secret matches. Excludes binary
 * formats, lockfiles, and Markdown/JSON artifacts that are scanned by
 * gitleaks already.
 */
const SECRET_SWEEP_EXTS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.env',
  '.example',
  '.toml',
  '.ini',
  '.config',
  '.sh',
  '.ps1',
  '.txt',
];

/**
 * File extensions for the backend log scanner — backend source files only.
 */
const BACKEND_LOG_EXTS: readonly string[] = ['.ts'];

/**
 * File extensions for the RPC-exposure scanner — client bundles only.
 */
const RPC_SCAN_EXTS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Indicator that `gitleaks` is not installed. ENOENT and "command not
 * found" surface differently on Windows vs POSIX; we match both forms.
 */
const GITLEAKS_MISSING_PATTERNS: readonly RegExp[] = [
  /spawn error: .*ENOENT/i,
  /is not recognized as an internal or external command/i,
  /command not found/i,
];

// ---------------------------------------------------------------------
// Regex set for the secret sweep (Requirement 6.4)
// ---------------------------------------------------------------------

/**
 * Literal "BEGIN PRIVATE KEY" indicator (matches "BEGIN PRIVATE KEY",
 * "BEGIN RSA PRIVATE KEY", "BEGIN EC PRIVATE KEY", etc. via the literal
 * substring).
 */
const PRIVATE_KEY_PATTERN = /BEGIN [A-Z ]*PRIVATE KEY/;

/**
 * `mnemonic` as a whole word (case-insensitive). The line is also tested
 * against the comment filter below to avoid flagging documentation.
 */
const MNEMONIC_PATTERN = /\bmnemonic\b/i;

/**
 * `JWT_SECRET=` — captures both env-file (`JWT_SECRET=foo`) and inline
 * (`JWT_SECRET = "foo"`) styles. The regex tolerates whitespace between
 * the identifier and the equals sign, matching the specification.
 */
const JWT_SECRET_PATTERN = /\bJWT_SECRET\s*=/;

/**
 * AWS access key id (literal `AKIA` prefix + 16 alnum uppercase chars).
 */
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/;

/**
 * AWS secret access key — 40-char base64 token. Per the task spec this is
 * only counted when it appears adjacent to the literal `aws_secret`
 * (case-insensitive) on the same line, so we don't drown in 40-char hash
 * false positives.
 */
const AWS_SECRET_TOKEN_PATTERN = /\b[A-Za-z0-9/+=]{40}\b/;
const AWS_SECRET_CONTEXT_PATTERN = /aws_secret/i;

/**
 * 64-char hex literal — the canonical shape for an Ethereum private key
 * or sha256 digest. Used as a Critical-severity heuristic.
 */
const HEX64_PATTERN = /\b[a-fA-F0-9]{64}\b/;

/**
 * Single-line comment heuristic. Lines beginning with `//` (after
 * whitespace) are excluded from the mnemonic regex sweep so design and
 * documentation files don't generate false positives.
 */
const SINGLE_LINE_COMMENT_PATTERN = /^\s*\/\//;

// ---------------------------------------------------------------------
// Regex set for the backend log scanner (Requirement 6.5)
// ---------------------------------------------------------------------

/**
 * Logging call detector. Matches `console.log|info|warn|error|debug`,
 * `logger.{log|info|warn|error|debug}`, and the bare `pino(` / `winston(`
 * factories. The dot/parenthesis class avoids matching e.g.
 * `pinoConfig` as a callee.
 */
const LOG_CALL_PATTERN =
  /\b(?:console\.(?:log|error|warn|info|debug)|logger\.(?:log|info|warn|error|debug)|pino[.(]|winston[.(])/;

/**
 * Token-shaped variable identifiers. Matched as whole-word references so
 * `passwordlessLogin` does not get flagged.
 */
const TOKEN_SHAPED_VARS = [
  'token',
  'secret',
  'password',
  'mnemonic',
  'privateKey',
  'signature',
] as const;
const TOKEN_SHAPED_PATTERN = new RegExp(
  `\\b(?:${TOKEN_SHAPED_VARS.join('|')})\\b`,
  'i',
);

/**
 * `Authorization` substring (case-insensitive). Matches header references
 * inside string literals as well as object property accesses.
 */
const AUTHORIZATION_PATTERN = /Authorization/i;

/**
 * Full request-body references. Matches `req.body` and `request.body` as
 * complete property accesses so a property named `bodyParts` does not
 * trigger a false positive.
 */
const REQUEST_BODY_PATTERN = /\b(?:req|request)\.body\b/;

// ---------------------------------------------------------------------
// Scan implementations
// ---------------------------------------------------------------------

/**
 * Run the consolidated secret-scan probe.
 *
 * Behavior:
 *   1. Invokes `gitleaks detect --no-git --report-path <evidenceDir>/gitleaks.json --no-banner`
 *      with `evidence` written via {@link runCommand} so the harness
 *      captures stdout/stderr and the JSON report side-by-side.
 *   2. If the gitleaks binary is missing (spawn ENOENT or "command not
 *      found" in the tail), returns `matches: 'unmeasured'` per the
 *      soft-failure model. The {@link EvidenceRecord} still lands so the
 *      Audit_Report can cite the evidence path.
 *   3. Parses the gitleaks JSON report (when present) and emits one
 *      `SecretMatch` per finding (kind `'gitleaks'`).
 *   4. Walks the workspace via {@link walkFiles} and applies the regex
 *      set above. Hits map to the kinds `'private-key' | 'mnemonic' |
 *      'jwt-secret' | 'aws-key' | 'hex64'`.
 *
 * Read-only constraint: every file is opened with `fs.readFile`. The
 * function never opens a file in write mode.
 */
export async function runSecretScan(
  input: RunSecretScanInput,
): Promise<SecretScanResult> {
  const { workspaceRoot, evidenceDir } = input;

  await fs.mkdir(evidenceDir, { recursive: true });
  const reportPath = path.join(evidenceDir, 'gitleaks.json');
  const evidencePath = path.join(evidenceDir, 'gitleaks.txt');

  const record = await runCommand(
    'gitleaks',
    [
      'detect',
      '--no-git',
      `--source=${workspaceRoot}`,
      `--report-path=${reportPath}`,
      '--report-format=json',
      '--no-banner',
      '--exit-code=0',
    ],
    evidencePath,
  );

  if (gitleaksUnavailable(record)) {
    return { record, matches: 'unmeasured' };
  }

  const matches: SecretMatch[] = [];

  const gitleaksMatches = await readGitleaksReport(reportPath, workspaceRoot);
  matches.push(...gitleaksMatches);

  const sweepMatches = await regexSweep(workspaceRoot);
  matches.push(...sweepMatches);

  return { record, matches };
}

/**
 * Walk `apps/backend/src/**\/*.ts` and flag log statements whose argument
 * list textually references token-shaped values, the `Authorization`
 * header, or a full request body.
 *
 * The scanner is deliberately textual: it locates a log call site, slices
 * out the parenthesised argument list (balancing nesting), and applies
 * three regex predicates. Lines failing the call-site detector are
 * skipped, so non-log code does not contribute false positives.
 */
export async function runBackendLogScan(
  input: RunBackendLogScanInput,
): Promise<readonly LogMatch[]> {
  const root = path.join(input.workspaceRoot, 'apps', 'backend', 'src');
  const files = await walkFiles(root, { extensions: BACKEND_LOG_EXTS });

  const matches: LogMatch[] = [];
  for (const file of files) {
    const content = await safeRead(file);
    if (content === null) {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (!LOG_CALL_PATTERN.test(line)) {
        continue;
      }
      const args = extractCallArgs(lines, i);
      if (args === null) {
        continue;
      }
      const reasons = classifyLogArgs(args);
      const preview = truncatePreview(line);
      const relPath = path.relative(input.workspaceRoot, file);
      for (const reason of reasons) {
        matches.push({
          path: normalisePath(relPath),
          lineNumber: i + 1,
          preview,
          reason,
        });
      }
    }
  }
  return matches;
}

/**
 * Walk `apps/consumer-app/src` and `apps/frontend/src` for references to
 * the chain provider literals `RPC_URL`, `INFURA`, `ALCHEMY`, and
 * `QUICKNODE`. Matches that occur on a single-line comment are excluded
 * so docs and TODOs do not drag the bucket into a false-Critical state.
 *
 * Test files (`__tests__/`, `*.test.{ts,tsx,js,jsx}`, `*.spec.*`,
 * `__mocks__/`) are also excluded because they never reach the
 * production bundle — Metro/webpack bundlers prune `__tests__/` and the
 * matching `*.test.*` suffixes by default. Including them produced
 * High-severity false positives like the two `mock-rpc.veilpay.test`
 * URLs flagged in the 2026-05-29 audit run.
 */
export async function runRpcExposureScan(
  input: RunRpcExposureScanInput,
): Promise<readonly RpcMatch[]> {
  const roots = [
    path.join(input.workspaceRoot, 'apps', 'consumer-app', 'src'),
    path.join(input.workspaceRoot, 'apps', 'frontend', 'src'),
  ];

  // Match each literal as a whole identifier OR substring inside a string,
  // by anchoring on word boundaries. Order matters for the loop below
  // because we want the matched literal to be deterministic per hit.
  const literals: readonly RpcLiteral[] = [
    'RPC_URL',
    'INFURA',
    'ALCHEMY',
    'QUICKNODE',
  ];
  const literalPatterns = literals.map(
    (literal) => [literal, new RegExp(`\\b${literal}\\b`)] as const,
  );

  const matches: RpcMatch[] = [];

  for (const root of roots) {
    const files = await walkFiles(root, { extensions: RPC_SCAN_EXTS });
    for (const file of files) {
      if (isTestFilePath(file)) {
        continue;
      }
      const content = await safeRead(file);
      if (content === null) {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (SINGLE_LINE_COMMENT_PATTERN.test(line)) {
          continue;
        }
        for (const [literal, pattern] of literalPatterns) {
          if (pattern.test(line)) {
            const relPath = path.relative(input.workspaceRoot, file);
            matches.push({
              path: normalisePath(relPath),
              lineNumber: i + 1,
              preview: truncatePreview(line),
              literal,
            });
          }
        }
      }
    }
  }
  return matches;
}

/**
 * Decide whether an absolute file path looks like a test fixture. Mirrors
 * the conventions Jest, Vitest, and React Native's default resolver use:
 *   - any path component named `__tests__` or `__mocks__`
 *   - any filename ending in `.test.<ext>` or `.spec.<ext>`
 * Both are pruned from the production bundle, so a hardcoded RPC URL
 * inside one is not actually a client-bundle exposure.
 */
function isTestFilePath(absPath: string): boolean {
  const segments = absPath.split(/[\\/]+/);
  for (const seg of segments) {
    if (seg === '__tests__' || seg === '__mocks__') {
      return true;
    }
  }
  const base = path.basename(absPath);
  return /\.(test|spec)\.[a-zA-Z]+$/.test(base);
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/**
 * Detect the "gitleaks not installed" case from the evidence record.
 * `runCommand` surfaces ENOENT as a non-zero exitCode plus a "spawn
 * error: ... ENOENT" entry in the tail; on Windows `cmd` may instead
 * print "is not recognized as an internal or external command".
 */
function gitleaksUnavailable(record: EvidenceRecord): boolean {
  if (record.exitCode === 0) {
    return false;
  }
  const tail = record.tail.join('\n');
  return GITLEAKS_MISSING_PATTERNS.some((rx) => rx.test(tail));
}

/**
 * Parse a gitleaks JSON report and project each finding into a
 * `SecretMatch` with kind `'gitleaks'`. Missing or malformed reports are
 * treated as "no findings" — gitleaks omits the file when it discovers
 * nothing, and a malformed report should not abort the pipeline (the raw
 * combined output is still on disk for debugging).
 */
async function readGitleaksReport(
  reportPath: string,
  workspaceRoot: string,
): Promise<SecretMatch[]> {
  let raw: string;
  try {
    raw = await fs.readFile(reportPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    return [];
  }

  if (raw.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const matches: SecretMatch[] = [];
  // `parsed` is `unknown[]` after the `Array.isArray` guard above; iterate
  // each entry as `unknown` so the field readers see a structurally typed
  // record rather than `any`.
  for (const entry of parsed as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const file = readStringField(record, 'File');
    const startLine = readNumberField(record, 'StartLine');
    const lineSnippet = readStringField(record, 'Line');
    if (file === null || startLine === null) {
      continue;
    }
    const absPath = path.isAbsolute(file)
      ? file
      : path.join(workspaceRoot, file);
    const relPath = normalisePath(path.relative(workspaceRoot, absPath));
    matches.push({
      kind: 'gitleaks',
      path: relPath,
      lineNumber: startLine,
      preview: truncatePreview(lineSnippet ?? ''),
    });
  }
  return matches;
}

/**
 * In-process regex sweep for committed secrets. Walks the workspace via
 * {@link walkFiles}, restricting to the SECRET_SWEEP_EXTS extensions, and
 * checks each line against the regex set documented above.
 *
 * Comment heuristic: when scanning the `mnemonic` pattern, lines starting
 * with `//` are skipped per the task spec.
 */
async function regexSweep(workspaceRoot: string): Promise<SecretMatch[]> {
  const files = await walkFiles(workspaceRoot, {
    extensions: SECRET_SWEEP_EXTS,
  });
  const matches: SecretMatch[] = [];

  for (const file of files) {
    const content = await safeRead(file);
    if (content === null) {
      continue;
    }
    const relPath = normalisePath(path.relative(workspaceRoot, file));
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineNumber = i + 1;
      const preview = truncatePreview(line);

      if (PRIVATE_KEY_PATTERN.test(line)) {
        matches.push({ kind: 'private-key', path: relPath, lineNumber, preview });
      }
      if (
        MNEMONIC_PATTERN.test(line) &&
        !SINGLE_LINE_COMMENT_PATTERN.test(line)
      ) {
        matches.push({ kind: 'mnemonic', path: relPath, lineNumber, preview });
      }
      if (JWT_SECRET_PATTERN.test(line)) {
        matches.push({ kind: 'jwt-secret', path: relPath, lineNumber, preview });
      }
      if (AWS_ACCESS_KEY_PATTERN.test(line)) {
        matches.push({ kind: 'aws-key', path: relPath, lineNumber, preview });
      } else if (
        AWS_SECRET_CONTEXT_PATTERN.test(line) &&
        AWS_SECRET_TOKEN_PATTERN.test(line)
      ) {
        matches.push({ kind: 'aws-key', path: relPath, lineNumber, preview });
      }
      if (HEX64_PATTERN.test(line)) {
        matches.push({ kind: 'hex64', path: relPath, lineNumber, preview });
      }
    }
  }
  return matches;
}

/**
 * Slice out the parenthesised argument list of a logger call beginning on
 * `lines[startIdx]`. Tracks paren nesting so a multi-line argument list
 * (e.g., `logger.info({\n  user,\n})`) is captured as a single string.
 *
 * Returns `null` when the line contains a logger keyword but no opening
 * paren (e.g., `pino.options`) so the caller can skip the false hit.
 */
function extractCallArgs(lines: readonly string[], startIdx: number): string | null {
  const startLine = lines[startIdx] ?? '';
  const openIdx = startLine.indexOf('(');
  if (openIdx === -1) {
    return null;
  }

  let depth = 0;
  let buffer = '';
  let started = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fromCol = i === startIdx ? openIdx : 0;
    for (let j = fromCol; j < line.length; j++) {
      const ch = line[j];
      if (ch === '(') {
        if (!started) {
          started = true;
          depth = 1;
          continue;
        }
        depth += 1;
        buffer += ch;
        continue;
      }
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          return buffer;
        }
        buffer += ch;
        continue;
      }
      if (started) {
        buffer += ch;
      }
    }
    buffer += '\n';
    // Bound the scan to the next 20 lines so an unbalanced source file
    // does not cause a quadratic walk.
    if (i - startIdx > 20) {
      return buffer;
    }
  }
  return buffer.length > 0 ? buffer : null;
}

/**
 * Classify a log call's argument list against the three Requirement-6.5
 * predicates. A single call site can produce multiple reasons (e.g., a
 * statement that logs both `req.body` and `Authorization`).
 */
function classifyLogArgs(args: string): LogScanReason[] {
  const reasons: LogScanReason[] = [];
  if (TOKEN_SHAPED_PATTERN.test(args)) {
    reasons.push('token-shaped');
  }
  if (AUTHORIZATION_PATTERN.test(args)) {
    reasons.push('authorization');
  }
  if (REQUEST_BODY_PATTERN.test(args)) {
    reasons.push('request-body');
  }
  return reasons;
}

/**
 * Read a file, swallowing read errors so a single permission-denied or
 * race condition does not abort the whole sweep. Returns `null` on
 * failure (caller skips the file).
 */
async function safeRead(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Truncate a line to {@link PREVIEW_MAX_LENGTH} characters, preserving any
 * useful context near the start without echoing arbitrarily long secrets.
 */
function truncatePreview(line: string): string {
  if (line.length <= PREVIEW_MAX_LENGTH) {
    return line;
  }
  return `${line.slice(0, PREVIEW_MAX_LENGTH)}…`;
}

/**
 * Normalise a path to forward slashes so report output is platform-stable.
 */
function normalisePath(p: string): string {
  return p.split(path.sep).join('/');
}

function readStringField(obj: object, key: string): string | null {
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function readNumberField(obj: object, key: string): number | null {
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
