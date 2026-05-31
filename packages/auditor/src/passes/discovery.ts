/**
 * Pass 1: Discovery.
 *
 * Captures the workspace state used by every downstream audit pass. The
 * output is a `DiscoveryOutput` value consumed by Pass 3 (synthesis) and
 * Pass 4 (rendering) — Pass 1 itself does not write any audit deliverables
 * other than the evidence file produced by `git rev-parse HEAD`.
 *
 * Hard preconditions
 * ------------------
 * `git rev-parse HEAD` MUST succeed against the workspace. On failure,
 * `runDiscovery` throws `AuditAbortError` carrying the command, exit code,
 * last 50 lines of combined output, and ISO 8601 capture timestamp. Pass 4's
 * abort writer (`runReporting`) consumes that error to emit
 * `.audit-evidence/ABORT.md` and skip all other deliverables. This satisfies
 * Requirements 1.4 (Git SHA in Run Metadata) and 10.6 (read-only chain
 * access; explicit abort over silent guess).
 *
 * Read-only contract
 * ------------------
 * The pass walks `apps/`, `packages/*`, `.kiro/specs/`, `plans/`, and the
 * workspace root, but never writes outside the injected `evidenceDir`
 * (used solely for the `git rev-parse HEAD` evidence file). Wallet,
 * signing, and send paths in `apps/consumer-app` are read-only inputs
 * (Requirement 6.14).
 *
 * Windows compatibility
 * ---------------------
 * Uses the `runCommand` harness with `shell: false` so paths are not
 * subject to POSIX expansion. Inventoried paths are returned in
 * POSIX-style (forward slashes) for stable Markdown rendering.
 *
 * Inventory buckets
 * -----------------
 *   - `specDirs`              top-level dir names under `.kiro/specs/`
 *   - `planFiles`             top-level `*.md` under `plans/` excluding
 *                             `PRODUCTION_READINESS_AUDIT.md` and the
 *                             `.audit-evidence/` directory
 *   - `networkIconAssets`     image files under `apps/consumer-app/assets`
 *                             and `apps/consumer-app/src` whose basenames
 *                             match `network*` or any canonical chain slug
 *   - `networkIconRenderers`  TS/TSX files under `apps/consumer-app/src`
 *                             that textually reference one of the
 *                             inventoried asset basenames
 *   - `rootScripts`           top-level files matching
 *                             `tmp_*.js|autofix.js|audit.js`
 *   - `backendRoutes`         TS files under `apps/backend/src/` bucketed
 *                             by `routes/{webhook,merchant,invoice,admin}*`
 *                             path prefix or by route declarations in the
 *                             first 200 lines of the file
 *
 * The implementation skips `node_modules`, `dist`, `.next`, `.expo`,
 * `coverage`, `.git`, and `.audit-evidence` during recursive walks. These
 * directories are large, vendor-controlled, or audit-output, so including
 * them would inflate the inventory without adding signal.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { AuditAbortError } from '../util/errors';
import { runCommand } from './staticAnalysis/runner';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Backend route inventory bucketed by surface. Each list contains
 * repository-relative POSIX-style paths under `apps/backend/src/`.
 */
export interface BackendRoutes {
  readonly webhooks: readonly string[];
  readonly merchant: readonly string[];
  readonly invoice: readonly string[];
  readonly admin: readonly string[];
}

/**
 * Frozen snapshot of the workspace state used by Pass 3 / Pass 4.
 * All path fields are repository-relative and POSIX-style.
 */
export interface DiscoveryOutput {
  /** Output of `git rev-parse HEAD` against the workspace. 40-char hex SHA. */
  readonly workspaceSha: string;
  /** ISO 8601 timestamp captured at the start of `runDiscovery`. */
  readonly generatedAt: string;
  /** Top-level spec directory names under `.kiro/specs/`. */
  readonly specDirs: readonly string[];
  /** Top-level Markdown plan files under `plans/`. */
  readonly planFiles: readonly string[];
  /** Network icon asset files under `apps/consumer-app/`. */
  readonly networkIconAssets: readonly string[];
  /** TS/TSX files under `apps/consumer-app/src/` referencing the assets. */
  readonly networkIconRenderers: readonly string[];
  /** Workspace-root scripts matching `tmp_*.js|autofix.js|audit.js`. */
  readonly rootScripts: readonly string[];
  /** Backend route TS files bucketed by surface. */
  readonly backendRoutes: BackendRoutes;
}

/**
 * Options for `runDiscovery`. All fields are optional so production callers
 * can `runDiscovery()` with no arguments. Tests inject a fixture
 * `workspaceRoot` plus a temp `evidenceDir` so they never touch
 * `d:\Veilpay\plans\.audit-evidence\`.
 */
export interface DiscoveryOptions {
  /**
   * Workspace root containing `.kiro/`, `plans/`, `apps/`, `packages/`.
   * Defaults to the resolved repo root four levels above this file
   * (`packages/auditor/src/passes/discovery.ts` → workspace root).
   */
  readonly workspaceRoot?: string;
  /**
   * Directory in which to drop the `git rev-parse HEAD` evidence file.
   * Defaults to `<workspaceRoot>/plans/.audit-evidence`. Tests inject a
   * temp dir so the production evidence dir stays untouched during unit
   * runs (the pipeline-level evidence path is threaded by Pass 4).
   */
  readonly evidenceDir?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical lowercase chain slugs (Requirement 4.2). Used both to match
 * network icon asset filenames and to bucket renderers.
 */
const CANONICAL_CHAIN_SLUGS: readonly string[] = [
  'ethereum',
  'polygon',
  'base',
  'arbitrum',
  'optimism',
  'solana',
  'bnb',
  'avalanche',
];

/** Image extensions considered for the Network_Icon_Set inventory. */
const ICON_EXTENSIONS: ReadonlySet<string> = new Set([
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
]);

/** TS/TSX extensions used for renderer / route walks. */
const TS_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx']);

/** Workspace-root script patterns from Requirement 7.4. */
const ROOT_SCRIPT_PATTERN = /^(?:tmp_.+\.js|autofix\.js|audit\.js)$/;

/**
 * Directories skipped during recursive walks. These are vendor-controlled,
 * generated, or audit-output; including them inflates the inventory
 * without adding signal.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.next',
  '.expo',
  'coverage',
  '.git',
  '.audit-evidence',
]);

/**
 * Maximum lines read from a candidate backend route file when classifying
 * by route declaration (`router.<method>('/...')` form). The cap protects
 * against accidentally loading very large files into memory.
 */
const ROUTE_DECL_LINE_BUDGET = 200;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert a Windows-style path to POSIX-style for stable Markdown output. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Probe whether a path exists. Returns false on any access error. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

interface FileEntry {
  readonly absPath: string;
  /** POSIX-style path relative to the workspace root. */
  readonly relFromRoot: string;
}

/**
 * Recursively collect files under `rootAbs`, optionally filtering by
 * extension. Skips `SKIP_DIRS` at every depth. Returns paths
 * relative to `workspaceRoot` in POSIX form.
 *
 * Errors reading a directory are swallowed (the directory contributes no
 * entries) so that permission glitches on a single subtree do not abort
 * the entire pass. Hard aborts are reserved for explicit precondition
 * failures (`git rev-parse HEAD`).
 */
async function collectFiles(
  rootAbs: string,
  workspaceRoot: string,
  options: { readonly extensions?: ReadonlySet<string> } = {},
): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const extensions = options.extensions;

  async function visit(dirAbs: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childAbs = path.join(dirAbs, entry.name);
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
      if (extensions !== undefined) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions.has(ext)) {
          continue;
        }
      }
      out.push({
        absPath: childAbs,
        relFromRoot: toPosix(path.relative(workspaceRoot, childAbs)),
      });
    }
  }

  await visit(rootAbs);
  return out;
}

// ---------------------------------------------------------------------------
// Inventory functions (one per bucket)
// ---------------------------------------------------------------------------

async function inventorySpecDirs(workspaceRoot: string): Promise<string[]> {
  const specsRoot = path.join(workspaceRoot, '.kiro', 'specs');
  if (!(await pathExists(specsRoot))) {
    return [];
  }
  let entries;
  try {
    entries = await fs.readdir(specsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      out.push(toPosix(path.join('.kiro', 'specs', entry.name)));
    }
  }
  return out.sort();
}

async function inventoryPlanFiles(workspaceRoot: string): Promise<string[]> {
  const plansRoot = path.join(workspaceRoot, 'plans');
  if (!(await pathExists(plansRoot))) {
    return [];
  }
  let entries;
  try {
    entries = await fs.readdir(plansRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.toLowerCase().endsWith('.md')) {
      continue;
    }
    // Exclude the consolidated audit deliverable itself; it is overwritten
    // by Pass 4 and must not appear in the refresh table as a plan input.
    if (entry.name === 'PRODUCTION_READINESS_AUDIT.md') {
      continue;
    }
    out.push(toPosix(path.join('plans', entry.name)));
  }
  return out.sort();
}

/**
 * Match an icon basename against `network*` or any canonical chain slug.
 * The check is on the basename (without extension is fine — we keep the
 * extension for substring matching since slugs themselves don't contain
 * dots). Case-insensitive.
 */
function isNetworkIconBasename(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (lower.startsWith('network')) {
    return true;
  }
  for (const slug of CANONICAL_CHAIN_SLUGS) {
    if (lower.includes(slug)) {
      return true;
    }
  }
  return false;
}

interface NetworkIconInventory {
  readonly assets: string[];
  readonly renderers: string[];
}

async function inventoryNetworkIcons(
  workspaceRoot: string,
): Promise<NetworkIconInventory> {
  const consumerRoot = path.join(workspaceRoot, 'apps', 'consumer-app');
  const assetsRoot = path.join(consumerRoot, 'assets');
  const srcRoot = path.join(consumerRoot, 'src');

  const assetWalkRoots: string[] = [];
  if (await pathExists(assetsRoot)) {
    assetWalkRoots.push(assetsRoot);
  }
  if (await pathExists(srcRoot)) {
    assetWalkRoots.push(srcRoot);
  }

  const candidateAssets: FileEntry[] = [];
  for (const walkRoot of assetWalkRoots) {
    const found = await collectFiles(walkRoot, workspaceRoot, {
      extensions: ICON_EXTENSIONS,
    });
    candidateAssets.push(...found);
  }

  const matchedAssets = candidateAssets.filter((entry) =>
    isNetworkIconBasename(path.basename(entry.relFromRoot)),
  );

  // Renderers grep TS/TSX content for the literal asset basename. If no
  // assets are inventoried, the renderer list is empty by construction —
  // Pass 3 surfaces this as a coverage gap rather than guessing.
  const assetBasenames = new Set(
    matchedAssets.map((entry) => path.basename(entry.relFromRoot)),
  );
  const renderers: string[] = [];
  if (assetBasenames.size > 0 && (await pathExists(srcRoot))) {
    const tsFiles = await collectFiles(srcRoot, workspaceRoot, {
      extensions: TS_EXTENSIONS,
    });
    for (const tsFile of tsFiles) {
      let content: string;
      try {
        content = await fs.readFile(tsFile.absPath, 'utf8');
      } catch {
        continue;
      }
      let referenced = false;
      for (const basename of assetBasenames) {
        if (content.includes(basename)) {
          referenced = true;
          break;
        }
      }
      if (referenced) {
        renderers.push(tsFile.relFromRoot);
      }
    }
  }

  return {
    assets: matchedAssets.map((e) => e.relFromRoot).sort(),
    renderers: renderers.sort(),
  };
}

async function inventoryRootScripts(workspaceRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && ROOT_SCRIPT_PATTERN.test(entry.name)) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

/**
 * Bucket order for backend route classification. Matters because the
 * `for` loop below assigns each file to the first matching bucket and
 * stops — `webhooks` is checked before `admin` etc. so a file under
 * `routes/webhooks/admin-callback.ts` (if it ever existed) would land
 * in webhooks rather than admin.
 */
const BACKEND_BUCKETS = ['webhooks', 'merchant', 'invoice', 'admin'] as const;
type BackendBucket = (typeof BACKEND_BUCKETS)[number];

/**
 * Path-prefix matchers for backend routes. The `webhooks` matcher accepts
 * both `routes/webhook.ts` (singular file) and `routes/webhooks/...`
 * (subdirectory) since the existing backend uses the singular form.
 * Same lenience for `merchant`, `invoice`, `admin`.
 */
const BACKEND_PATH_MATCHERS: Readonly<Record<BackendBucket, RegExp>> = {
  webhooks: /\/routes\/webhook/i,
  merchant: /\/routes\/merchant/i,
  invoice: /\/routes\/invoice/i,
  admin: /\/routes\/admin/i,
};

/**
 * Route-declaration matchers used as a fallback for files that aren't
 * named after the bucket but still register routes for it (e.g. a
 * `routes/index.ts` mounting `/webhooks`). Matches the actual style used
 * in `apps/backend/src/routes/*.ts`:
 *   `router.<method>('/webhooks', ...)`
 * Singular and plural forms are both accepted.
 */
const BACKEND_DECL_MATCHERS: Readonly<Record<BackendBucket, RegExp>> = {
  webhooks: /router\.\w+\s*\(\s*['"`]\/webhooks?\b/,
  merchant: /router\.\w+\s*\(\s*['"`]\/merchants?\b/,
  invoice: /router\.\w+\s*\(\s*['"`]\/invoices?\b/,
  admin: /router\.\w+\s*\(\s*['"`]\/admin\b/,
};

async function inventoryBackendRoutes(
  workspaceRoot: string,
): Promise<BackendRoutes> {
  const backendSrc = path.join(workspaceRoot, 'apps', 'backend', 'src');
  const empty: BackendRoutes = {
    webhooks: [],
    merchant: [],
    invoice: [],
    admin: [],
  };
  if (!(await pathExists(backendSrc))) {
    return empty;
  }

  const tsFiles = await collectFiles(backendSrc, workspaceRoot, {
    extensions: TS_EXTENSIONS,
  });

  const buckets: Record<BackendBucket, string[]> = {
    webhooks: [],
    merchant: [],
    invoice: [],
    admin: [],
  };

  for (const file of tsFiles) {
    // Normalize to a POSIX path with a leading '/' so the `\/routes\/...`
    // regex matches regardless of whether the relative path itself
    // starts with `apps/backend/...`.
    const relWithSlash = '/' + file.relFromRoot;
    let assigned: BackendBucket | null = null;
    for (const bucket of BACKEND_BUCKETS) {
      if (BACKEND_PATH_MATCHERS[bucket].test(relWithSlash)) {
        assigned = bucket;
        break;
      }
    }

    if (assigned === null) {
      // Fallback: scan the first 200 lines for a route declaration. Only
      // assigns when a declaration matches one of the four buckets.
      let head: string | null = null;
      try {
        const content = await fs.readFile(file.absPath, 'utf8');
        head = content.split(/\r?\n/).slice(0, ROUTE_DECL_LINE_BUDGET).join('\n');
      } catch {
        head = null;
      }
      if (head !== null) {
        for (const bucket of BACKEND_BUCKETS) {
          if (BACKEND_DECL_MATCHERS[bucket].test(head)) {
            assigned = bucket;
            break;
          }
        }
      }
    }

    if (assigned !== null) {
      buckets[assigned].push(file.relFromRoot);
    }
  }

  for (const bucket of BACKEND_BUCKETS) {
    buckets[bucket].sort();
  }

  return {
    webhooks: buckets.webhooks,
    merchant: buckets.merchant,
    invoice: buckets.invoice,
    admin: buckets.admin,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Default workspace root: four levels above this file.
 *
 * `__dirname` resolves at runtime to `packages/auditor/src/passes` (under
 * ts-jest) or `packages/auditor/dist/passes` (after `tsc`). Both layouts
 * are exactly four levels deep relative to the workspace root, so the
 * same `'..', '..', '..', '..'` path applies.
 */
function defaultWorkspaceRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

/**
 * Run Pass 1 of the audit pipeline.
 *
 * Captures the workspace SHA, generation timestamp, and per-bucket
 * inventory. Throws `AuditAbortError` if `git rev-parse HEAD` exits
 * non-zero or returns output that is not a 40-char hex SHA — the latter
 * indicates a corrupt workspace and is handled identically to a failed
 * spawn so Pass 4's abort writer surfaces it the same way.
 */
export async function runDiscovery(
  options: DiscoveryOptions = {},
): Promise<DiscoveryOutput> {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
  const evidenceDir =
    options.evidenceDir ?? path.join(workspaceRoot, 'plans', '.audit-evidence');

  const generatedAt = new Date().toISOString();

  // ---- Hard precondition: capture the workspace SHA ----------------------
  await fs.mkdir(evidenceDir, { recursive: true });
  const gitEvidencePath = path.join(evidenceDir, 'git-rev-parse-head.txt');
  // Run `git rev-parse HEAD` inside the workspace root (not the auditor's
  // own cwd) so the captured SHA reflects the workspace under audit. This
  // also makes the abort path testable against a non-git fixture: when the
  // fixture has no `.git`, git exits non-zero and Pass 4 surfaces the abort.
  const gitRecord = await runCommand(
    'git',
    ['rev-parse', 'HEAD'],
    gitEvidencePath,
    { cwd: workspaceRoot },
  );

  if (gitRecord.exitCode !== 0) {
    throw new AuditAbortError({
      command: 'git rev-parse HEAD',
      exitCode: gitRecord.exitCode,
      outputTail: gitRecord.tail,
      capturedAt: gitRecord.runAt,
    });
  }

  // The harness wrote the combined output atomically; read it back rather
  // than re-running the command. `git rev-parse HEAD` emits a single
  // 40-char hex SHA followed by a newline.
  let gitOutput: string;
  try {
    gitOutput = await fs.readFile(gitRecord.evidencePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AuditAbortError({
      command: 'git rev-parse HEAD',
      exitCode: gitRecord.exitCode,
      outputTail: [`failed to read git evidence: ${message}`],
      capturedAt: gitRecord.runAt,
    });
  }

  const workspaceSha = gitOutput.trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/i.test(workspaceSha)) {
    // Treat unexpected output as a hard abort — the rest of the audit
    // depends on a real SHA in the Run Metadata block.
    const preview = gitOutput.slice(0, 200);
    throw new AuditAbortError({
      command: 'git rev-parse HEAD',
      exitCode: gitRecord.exitCode,
      outputTail: [`unexpected git rev-parse output: ${JSON.stringify(preview)}`],
      capturedAt: gitRecord.runAt,
    });
  }

  // ---- Inventory buckets (run in parallel; each is independent) ----------
  const [specDirs, planFiles, networkIcons, rootScripts, backendRoutes] =
    await Promise.all([
      inventorySpecDirs(workspaceRoot),
      inventoryPlanFiles(workspaceRoot),
      inventoryNetworkIcons(workspaceRoot),
      inventoryRootScripts(workspaceRoot),
      inventoryBackendRoutes(workspaceRoot),
    ]);

  return {
    workspaceSha,
    generatedAt,
    specDirs,
    planFiles,
    networkIconAssets: networkIcons.assets,
    networkIconRenderers: networkIcons.renderers,
    rootScripts,
    backendRoutes,
  };
}
