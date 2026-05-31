/**
 * TypeScript strict-mode coverage resolver for Pass 2 (Static Analysis).
 *
 * This module implements task 3.5 of `production-readiness-audit/tasks.md`:
 * walk every `tsconfig.json` reachable from a target's source tree, follow
 * `extends` chains, resolve the effective `strict` value per file, and
 * compute a single integer coverage percentage per app/package.
 *
 * The result feeds the `code_quality_findings_list.ts_strict_coverage` map
 * synthesized in Pass 3 (`src/passes/synthesis/codeQuality.ts`, task 4.5)
 * and from there into the Code_Quality section of the rendered Audit_Report.
 *
 * Resolution rules (mirrors design.md "Tooling adapted for Windows cmd"
 * "Strict-mode probe" row and Requirement 7.2):
 *
 *   1. The effective `strict` for a tsconfig is the value of
 *      `compilerOptions.strict` from the closest config in the `extends`
 *      chain that defines it (TypeScript's standard "child overrides
 *      parent" inheritance). If no config in the chain defines `strict`,
 *      the umbrella defaults to `false`.
 *   2. As an escape hatch, a tsconfig that does NOT set the umbrella but
 *      sets every individual strict sub-flag to `true`
 *      (`strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`,
 *      `strictBindCallApply`, `strictPropertyInitialization`,
 *      `alwaysStrict`, `useUnknownInCatchVariables`) is treated as strict.
 *      This handles repos that pin sub-flags individually instead of using
 *      the umbrella alias.
 *   3. Per-file effective strict = the strict resolution of the deepest
 *      ancestor directory containing a `tsconfig.json`. If no such
 *      tsconfig exists for a file, the file is treated as non-strict.
 *
 * The walker skips standard build-output directories so it never opens
 * generated files: `node_modules`, `dist`, `.next`, `.expo`, `.expo-shared`,
 * `coverage`, `.git`, `.turbo`, `build`. It also honors any literal
 * directory entries in the target's `exclude` field.
 *
 * The resolver is intentionally pure: it spawns no child processes and
 * makes no network calls. All inputs are filesystem reads. JSON-with-
 * comments support is implemented inline (strip `//` and `/* ... *\/`
 * comments while preserving string contents, then strip trailing commas)
 * because importing a JSONC parser would add a runtime dep just for
 * tsconfig reading.
 *
 * Implements: Requirements 7.2 (TypeScript strict-mode coverage probe).
 */

import { promises as fs, type Dirent } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

/**
 * Subset of `tsconfig.json` shape consumed by the resolver. Only fields
 * affecting strict resolution and file enumeration are typed; everything
 * else flows through as the loosely-typed parsed JSON object.
 */
interface TsConfigJson {
  readonly extends?: string | readonly string[];
  readonly compilerOptions?: {
    readonly strict?: boolean;
    readonly strictNullChecks?: boolean;
    readonly noImplicitAny?: boolean;
    readonly strictFunctionTypes?: boolean;
    readonly strictBindCallApply?: boolean;
    readonly strictPropertyInitialization?: boolean;
    readonly alwaysStrict?: boolean;
    readonly useUnknownInCatchVariables?: boolean;
  };
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly files?: readonly string[];
}

/**
 * Directories the walker NEVER descends into, regardless of include/exclude.
 * These are universally generated or vendored and TypeScript should not be
 * compiling them as part of the source surface.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.expo',
  '.expo-shared',
  '.turbo',
]);

/**
 * The seven individual flags that the TypeScript `strict` umbrella alias
 * enables. If a config explicitly sets the umbrella, that value wins. If
 * the umbrella is unset but every flag in this list is explicitly `true`,
 * the resolver treats the config as effectively strict.
 *
 * Source: TypeScript docs — `--strict` master alias.
 */
const STRICT_SUB_FLAGS = [
  'strictNullChecks',
  'noImplicitAny',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'alwaysStrict',
  'useUnknownInCatchVariables',
] as const;

type StrictSubFlag = (typeof STRICT_SUB_FLAGS)[number];

/**
 * Compute the integer strict-mode coverage percentage (0..100) for each
 * target in `targets`.
 *
 * Coverage = round(100 * filesWithStrict / totalFiles). When a target has
 * no enumerable `.ts` / `.tsx` source files, coverage is reported as 100
 * (vacuously fully strict — there is nothing to mis-configure). When a
 * target has source files but no resolvable tsconfig, every file is
 * treated as non-strict and coverage is 0.
 *
 * @param workspaceRoot - Absolute path to the workspace root. Used to
 *   resolve any relative `target.path` entries.
 * @param targets - One entry per app or package. `name` is used as the
 *   key in the returned map. `path` may be absolute or workspace-relative.
 * @returns A record mapping `target.name` to an integer in 0..100. Order
 *   of iteration follows insertion order, which matches the input array.
 */
export async function resolveStrictCoverage({
  workspaceRoot,
  targets,
}: {
  readonly workspaceRoot: string;
  readonly targets: ReadonlyArray<{ readonly name: string; readonly path: string }>;
}): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  for (const target of targets) {
    const absoluteTargetDir = path.isAbsolute(target.path)
      ? target.path
      : path.resolve(workspaceRoot, target.path);
    results[target.name] = await computeTargetCoverage(absoluteTargetDir);
  }
  return results;
}

/**
 * Compute coverage for a single target directory. Internal helper exposed
 * only via the per-target loop in `resolveStrictCoverage`.
 */
async function computeTargetCoverage(targetDir: string): Promise<number> {
  // 1. Discover every `tsconfig.json` reachable inside the target tree.
  //    Per-file resolution requires knowing every nested tsconfig so a
  //    file inside `packages/foo/sub-pkg/` resolves to `sub-pkg/tsconfig.json`
  //    rather than the root one when both exist.
  const tsconfigPaths = await findTsconfigsInTree(targetDir);

  // 2. Memoize effective strict per tsconfig directory so the per-file
  //    loop below is O(files * log dirs) rather than re-loading configs.
  const chainCache = new Map<string, readonly TsConfigJson[]>();
  const strictByDir = new Map<string, boolean>();
  for (const tsconfigPath of tsconfigPaths) {
    const dir = path.dirname(tsconfigPath);
    const chain = await loadConfigChain(tsconfigPath, chainCache, new Set());
    strictByDir.set(dir, resolveEffectiveStrict(chain));
  }

  // 3. Compute the directory exclude set from the target's own tsconfig
  //    (when present). Glob-style excludes like `**/__tests__/**` are
  //    intentionally NOT honored — the resolver treats only literal
  //    leading directory names as excludes, which covers the typical
  //    `["node_modules", "dist"]` shape used across the workspace.
  const targetTsconfigPath = path.join(targetDir, 'tsconfig.json');
  const extraExcludeDirs = await readExcludeDirs(targetTsconfigPath);

  // 4. Walk the target tree and gather candidate files.
  const files = await walkSourceFiles(targetDir, extraExcludeDirs);

  if (files.length === 0) {
    return 100;
  }

  // 5. Sort tsconfig directories deepest-first so the per-file lookup
  //    finds the closest enclosing tsconfig in O(N) per file. With at
  //    most a handful of tsconfigs per target this is fine in practice.
  const tsconfigDirs = Array.from(strictByDir.keys()).sort(
    (a, b) => b.length - a.length,
  );

  let strictCount = 0;
  for (const file of files) {
    if (resolveStrictForFile(file, tsconfigDirs, strictByDir)) {
      strictCount += 1;
    }
  }

  return Math.round((100 * strictCount) / files.length);
}

/**
 * Resolve the effective strict value for a single file by finding the
 * deepest ancestor directory that contains a tsconfig and reading its
 * memoized strict resolution. Returns `false` when no enclosing tsconfig
 * exists — that file is not under any TypeScript project.
 */
function resolveStrictForFile(
  filePath: string,
  tsconfigDirsDeepestFirst: readonly string[],
  strictByDir: ReadonlyMap<string, boolean>,
): boolean {
  for (const dir of tsconfigDirsDeepestFirst) {
    if (filePath === dir || filePath.startsWith(dir + path.sep)) {
      return strictByDir.get(dir) ?? false;
    }
  }
  return false;
}

/**
 * Recursively walk `targetDir` and return the absolute paths of every
 * `*.ts` and `*.tsx` file. `*.d.ts` declaration files are excluded — they
 * carry no compiled output and including them would inflate the
 * denominator with files that strict-mode does not check the same way.
 *
 * `extraExcludeDirs` is layered on top of the universal `SKIP_DIRS` set
 * and is read from the target's tsconfig `exclude` field.
 */
async function walkSourceFiles(
  targetDir: string,
  extraExcludeDirs: ReadonlySet<string>,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      // Unreadable directories are skipped silently; the audit pipeline
      // surfaces filesystem errors via separate evidence channels.
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      const fullPath = path.join(dir, name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        if (extraExcludeDirs.has(name)) continue;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (name.endsWith('.d.ts')) continue;
      if (name.endsWith('.ts') || name.endsWith('.tsx')) {
        out.push(fullPath);
      }
    }
  }

  await walk(targetDir);
  return out;
}

/**
 * Locate every `tsconfig.json` under `root`, skipping the universal
 * `SKIP_DIRS` so we never recurse into `node_modules` or build output.
 * Filename matching is exact: alternate names like `tsconfig.build.json`
 * are not picked up because TypeScript only follows them when invoked
 * with `-p` and the strict-mode probe targets the canonical config.
 */
async function findTsconfigsInTree(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'tsconfig.json') {
        out.push(fullPath);
      }
    }
  }

  await walk(root);
  return out;
}

/**
 * Load a tsconfig file and recursively resolve its `extends` chain.
 *
 * The returned array is ordered child-first: index 0 is the requested
 * tsconfig, index 1 is its first extends parent, and so on. This ordering
 * matches `resolveEffectiveStrict`, which walks child → parent and stops
 * at the first config that defines `strict`.
 *
 * - Relative extends (`./base.json`, `../node.json`) are resolved against
 *   the parent tsconfig's directory using `path.resolve`.
 * - Bare-module extends (`expo/tsconfig.base.json`) are resolved via
 *   `createRequire` against the parent tsconfig's directory so workspace
 *   packages and pnpm hoisted modules both resolve correctly.
 * - The `.json` extension is implied when omitted, matching TypeScript's
 *   own behavior on `extends` strings.
 * - Cycles are detected via a `visited` set passed through the recursion;
 *   a self-cycle (or longer) silently truncates the chain rather than
 *   throwing, since the audit pipeline must continue past malformed
 *   configs.
 */
async function loadConfigChain(
  tsconfigPath: string,
  cache: Map<string, readonly TsConfigJson[]>,
  visited: Set<string>,
): Promise<readonly TsConfigJson[]> {
  const absolute = path.resolve(tsconfigPath);
  const cached = cache.get(absolute);
  if (cached !== undefined) return cached;
  if (visited.has(absolute)) return [];
  visited.add(absolute);

  let parsed: TsConfigJson;
  try {
    parsed = await readJsoncFile(absolute);
  } catch {
    // Treat unreadable / malformed configs as "no config" — the per-file
    // resolution will fall through to non-strict for files under this dir.
    cache.set(absolute, []);
    return [];
  }

  const chain: TsConfigJson[] = [parsed];

  const extendsRaw = parsed.extends;
  const extendsList: readonly string[] = Array.isArray(extendsRaw)
    ? extendsRaw
    : typeof extendsRaw === 'string'
      ? [extendsRaw]
      : [];

  for (const ext of extendsList) {
    const resolved = resolveExtendsTarget(ext, path.dirname(absolute));
    if (resolved === null) continue;
    const parentChain = await loadConfigChain(resolved, cache, visited);
    chain.push(...parentChain);
  }

  cache.set(absolute, chain);
  return chain;
}

/**
 * Resolve the absolute path that an `extends` string points at, mirroring
 * TypeScript's own resolution algorithm in spirit:
 *
 *   - Relative or absolute paths: `path.resolve` against `fromDir`. If
 *     the resolved path lacks `.json`, append it.
 *   - Bare module specifiers (e.g., `expo/tsconfig.base.json`):
 *     `createRequire` against a placeholder under `fromDir` so Node uses
 *     `fromDir` as the resolution base. Tries the literal specifier
 *     first, then falls back to appending `.json`.
 *
 * Returns `null` when nothing resolves; callers treat this as "no parent"
 * and the chain ends.
 */
function resolveExtendsTarget(extendsValue: string, fromDir: string): string | null {
  if (extendsValue.startsWith('.') || path.isAbsolute(extendsValue)) {
    let candidate = path.resolve(fromDir, extendsValue);
    if (!candidate.toLowerCase().endsWith('.json')) {
      candidate = `${candidate}.json`;
    }
    return candidate;
  }

  // Bare module specifier — let Node's resolver locate the file. The
  // placeholder filename forces createRequire to anchor at `fromDir`.
  try {
    const requireFn = createRequire(path.join(fromDir, 'noop.js'));
    const literal = extendsValue;
    const withExt = literal.toLowerCase().endsWith('.json') ? literal : `${literal}.json`;
    try {
      return requireFn.resolve(literal);
    } catch {
      try {
        return requireFn.resolve(withExt);
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
}

/**
 * Resolve the effective strict value for a chain produced by
 * `loadConfigChain` (child first, ancestors after).
 *
 * Algorithm:
 *   1. Walk child → parent. The first config that defines
 *      `compilerOptions.strict` wins (TypeScript's "child overrides
 *      parent" semantics).
 *   2. If no config defines the umbrella, walk the chain parent → child
 *      and merge the seven individual strict sub-flags. If every flag
 *      ends up explicitly `true`, treat the chain as strict.
 *   3. Otherwise the default is `false`.
 */
function resolveEffectiveStrict(chain: readonly TsConfigJson[]): boolean {
  for (const cfg of chain) {
    const value = cfg.compilerOptions?.strict;
    if (value !== undefined) {
      return value;
    }
  }

  const merged: Partial<Record<StrictSubFlag, boolean>> = {};
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const co = chain[i]?.compilerOptions;
    if (!co) continue;
    for (const flag of STRICT_SUB_FLAGS) {
      const value = co[flag];
      if (value !== undefined) {
        merged[flag] = value;
      }
    }
  }
  return STRICT_SUB_FLAGS.every((flag) => merged[flag] === true);
}

/**
 * Read and parse a JSONC tsconfig file. JSON-with-comments support is
 * inlined here so the auditor doesn't take a runtime dependency on a
 * dedicated JSONC parser. The implementation strips `//` line comments
 * and `/* ... *\/` block comments while preserving any comment-shaped
 * substrings that appear inside JSON string literals, then strips
 * trailing commas before delegating to `JSON.parse`.
 */
async function readJsoncFile(absolutePath: string): Promise<TsConfigJson> {
  const raw = await fs.readFile(absolutePath, 'utf8');
  const stripped = stripTrailingCommas(stripJsonComments(raw));
  return JSON.parse(stripped) as TsConfigJson;
}

/**
 * Strip `//` and `/* ... *\/` comments from `src` while preserving the
 * contents of double-quoted string literals. Single-quoted strings are
 * not part of JSON and are intentionally ignored.
 *
 * The state machine is small but explicit because a single missed
 * transition can corrupt the resulting JSON in subtle ways (e.g., an
 * unbalanced `*\/` in a comment can swallow real content).
 */
function stripJsonComments(src: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i] ?? '';
    const next = i + 1 < src.length ? src[i + 1] : '';

    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Strip trailing commas before `}` or `]`. Operates on input that has
 * already had comments removed; runs after `stripJsonComments` to avoid
 * accidentally matching commas inside comments.
 *
 * The naive regex can in theory match commas inside strings, but tsconfig
 * string values do not contain `,}` or `,]` patterns in practice and the
 * auditor errors out on any malformed parse anyway.
 */
function stripTrailingCommas(src: string): string {
  return src.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Read the `exclude` field of the target's own tsconfig and return the
 * literal directory names mentioned. Glob fragments (`*`, `**`) are
 * dropped because the walker only matches by exact directory name.
 *
 * Example: `"exclude": ["node_modules", "dist", "**\/__tests__/**"]` →
 * Set { 'node_modules', 'dist' }. The `__tests__` glob is dropped
 * because it is not a leading literal directory.
 */
async function readExcludeDirs(tsconfigPath: string): Promise<ReadonlySet<string>> {
  let parsed: TsConfigJson;
  try {
    parsed = await readJsoncFile(tsconfigPath);
  } catch {
    return new Set<string>();
  }
  const dirs = new Set<string>();
  const excludeList = parsed.exclude;
  if (!excludeList) return dirs;
  for (const pattern of excludeList) {
    const cleaned = pattern.replace(/^\.[\\/]/, '');
    const firstSegment = cleaned.split(/[\\/]/)[0] ?? '';
    if (firstSegment.length > 0 && !firstSegment.includes('*')) {
      dirs.add(firstSegment);
    }
  }
  return dirs;
}
