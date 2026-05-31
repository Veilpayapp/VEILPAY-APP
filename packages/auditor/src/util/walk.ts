/**
 * Recursive directory walker for Pass 2 file scanners.
 *
 * Used by the security/RPC/log probes (`passes/staticAnalysis/security.ts`)
 * to enumerate source files under a workspace subtree without depending on a
 * shell glob library. Walks are performed with `fs.readdir(..., { withFileTypes: true })`
 * so directories are skipped without an extra `stat` call.
 *
 * Read-only constraint (Requirements 6.14, 10.5): the walker never opens
 * file contents — it only enumerates `Dirent` entries. Callers consume the
 * returned paths with `fs.readFile`.
 *
 * Skip rules are applied per-directory (so the entire subtree is pruned when
 * a matching directory is encountered) and per-file (extension filter).
 * Default skips cover dependency caches, build outputs, and the auditor's
 * own evidence directory so a probe walking `d:\Veilpay` does not recurse
 * into `node_modules\` or trip over its own writes.
 */

import { promises as fs, type Dirent } from 'node:fs';
import * as path from 'node:path';

/**
 * Directory base names that are pruned from every walk by default. Each
 * entry is matched as a base name (not a path segment list), so e.g.
 * `apps\backend\node_modules\foo` and `node_modules` at the root both
 * trigger the skip.
 */
export const DEFAULT_SKIP_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.next',
  '.expo',
  '.expo-export-check',
  '.maestro',
  'graphify-out',
  '.audit-evidence',
  '.cache',
  '.parcel-cache',
  'out',
];

/**
 * Walk options.
 *
 * - `extensions` — when non-empty, only files whose lowercased extension
 *   (including the leading dot) matches an entry are returned. When empty
 *   or omitted, every regular file under `root` is returned.
 * - `skipDirs` — directory base names to prune in addition to
 *   `DEFAULT_SKIP_DIRS`. Pass `[]` to keep the defaults.
 * - `replaceSkipDirs` — when `true`, `skipDirs` replaces (rather than
 *   extends) `DEFAULT_SKIP_DIRS`. Useful for tests.
 * - `maxDepth` — optional recursion cap; `0` returns only files in `root`,
 *   `1` adds direct children, and so on. Omit for unlimited depth.
 */
export interface WalkOptions {
  readonly extensions?: readonly string[];
  readonly skipDirs?: readonly string[];
  readonly replaceSkipDirs?: boolean;
  readonly maxDepth?: number;
}

/**
 * Recursively enumerate regular files under `root` that match the configured
 * extensions and skip rules. Returns absolute paths in an unspecified but
 * deterministic-per-platform order (the order of `fs.readdir`).
 *
 * Errors from `fs.readdir` other than `ENOENT` propagate to the caller; an
 * `ENOENT` on `root` resolves to an empty list so probes can be run against
 * partially scaffolded workspaces without crashing.
 */
export async function walkFiles(
  root: string,
  options: WalkOptions = {},
): Promise<string[]> {
  const skipSet = new Set<string>(
    options.replaceSkipDirs === true
      ? options.skipDirs ?? []
      : [...DEFAULT_SKIP_DIRS, ...(options.skipDirs ?? [])],
  );

  const allowedExt =
    options.extensions && options.extensions.length > 0
      ? new Set(options.extensions.map((ext) => ext.toLowerCase()))
      : null;

  const results: string[] = [];
  await walkInto(root, 0, options.maxDepth, skipSet, allowedExt, results);
  return results;
}

async function walkInto(
  dir: string,
  depth: number,
  maxDepth: number | undefined,
  skipSet: ReadonlySet<string>,
  allowedExt: ReadonlySet<string> | null,
  out: string[],
): Promise<void> {
  // `fs.readdir` has multiple overloads; the `withFileTypes: true` form
  // returns `Dirent[]` in modern @types/node, but inferring through
  // `Awaited<ReturnType<...>>` selects the buffer overload. Annotate
  // explicitly so the rest of the loop works on string-typed entries.
  let entries: Dirent[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipSet.has(entry.name)) {
        continue;
      }
      if (maxDepth !== undefined && depth >= maxDepth) {
        continue;
      }
      await walkInto(fullPath, depth + 1, maxDepth, skipSet, allowedExt, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (allowedExt !== null) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowedExt.has(ext)) {
        continue;
      }
    }
    out.push(fullPath);
  }
}
