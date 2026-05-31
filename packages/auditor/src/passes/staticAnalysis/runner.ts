/**
 * Evidence-capture harness for Pass 2 (Static Analysis).
 *
 * Spawns a single command, captures combined stdout/stderr to an evidence
 * file on disk via an atomic write (temp file + rename), and returns a
 * structured `EvidenceRecord` describing the run. The harness intentionally
 * does NOT throw on non-zero exit codes — callers (probes, graphify, etc.)
 * decide how to surface failures into the audit.
 *
 * Hard failures of process spawning (e.g., command not found) are surfaced
 * as a non-zero `exitCode` with the spawn error appended to the evidence
 * file and the trailing tail. Hard aborts of the audit (e.g., `git rev-parse
 * HEAD` in Pass 1 Discovery) are handled separately by `AuditAbortError`
 * in `passes/discovery.ts`.
 *
 * Implements: Requirements 3.6 — failure capture as `command`, `exit code`,
 * and the last 50 lines of combined output. The 50-line cap also satisfies
 * Property 14 (Graphify failure capture matches exit code).
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Maximum number of trailing combined-output lines retained in
 * `EvidenceRecord.tail`. Sourced from Requirement 3.6 ("last 50 lines of
 * output").
 */
export const MAX_TAIL_LINES = 50;

/**
 * Structured record describing a single command invocation captured by
 * `runCommand`. Mirrors the YAML schema in `design.md` "Components and
 * Interfaces — Pass 2 evidence record".
 *
 * - `command` is the bare executable name as passed to spawn.
 * - `args` is the literal argv array passed to spawn (copied to avoid
 *   aliasing caller arrays).
 * - `exitCode` is the integer process exit code. A signal-terminated
 *   process is reported as a non-zero exit code (1) so that callers treat
 *   it identically to a normal failure.
 * - `runAt` is the ISO 8601 timestamp captured at spawn time, before the
 *   child process exits.
 * - `evidencePath` is the absolute or workspace-relative path the raw
 *   combined stdout+stderr was written to. The write is atomic
 *   (temp file + rename) so that partial writes never appear at this path.
 * - `tail` is the trailing slice of combined output, capped at
 *   `MAX_TAIL_LINES`. The tail is populated ONLY when `exitCode !== 0`;
 *   on success it is an empty array. This matches Property 14's invariant
 *   that failure capture is non-null iff exit code is non-zero.
 */
export interface EvidenceRecord {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly runAt: string;
  readonly evidencePath: string;
  readonly tail: readonly string[];
}

/**
 * Result of a single spawn, before evidence persistence and tail extraction.
 */
interface SpawnResult {
  readonly exitCode: number;
  readonly combined: string;
}

/**
 * Optional knobs for `runCommand`. Kept as an object so additional fields
 * (env passthrough, timeout) can be added without breaking the call sites
 * that already exist.
 *
 * - `cwd` — working directory for the spawned process. When omitted the
 *   child inherits Node's `process.cwd()`, matching the behavior of
 *   `child_process.spawn` with no `cwd` option.
 */
export interface RunCommandOptions {
  readonly cwd?: string;
}

/**
 * Optional knobs accepted by `runCommand`. Kept as a separate object so the
 * harness signature can grow over time without churning every call site.
 *
 * - `cwd`: Working directory for the spawned process. When omitted, the
 *   child inherits the parent's `process.cwd()`. Pass `workspaceRoot` here
 *   for tools (like `graphify`) that must resolve sources relative to the
 *   workspace root rather than the package directory.
 */
export interface RunCommandOptions {
  readonly cwd?: string;
}

/**
 * Spawn a command, capture its combined stdout/stderr to an evidence file,
 * and return a structured `EvidenceRecord`.
 *
 * Behavior:
 * 1. Records `runAt` as an ISO 8601 timestamp before spawning.
 * 2. Spawns `cmd` with `args` using `child_process.spawn` and `shell: false`
 *    so that arguments are passed verbatim (no shell-expansion of paths
 *    or globs). This is also Windows-cmd compatible — Node resolves bare
 *    executable names like `node` or `git` via `PATH`/`PATHEXT`.
 * 3. Buffers stdout and stderr chunks in arrival order to approximate the
 *    interleaved output a user would see in a terminal.
 * 4. Ensures `path.dirname(evidencePath)` exists (recursive mkdir).
 * 5. Writes the combined output to `<evidencePath>.tmp` and atomically
 *    renames it to `evidencePath`. A partially written tmp file therefore
 *    never appears at the published path.
 * 6. On non-zero exit, computes `tail` as the last `MAX_TAIL_LINES` lines
 *    of combined output (trimming a single trailing empty line caused by a
 *    final newline). On zero exit, `tail` is empty.
 *
 * This function never throws on child-process failures: spawn errors are
 * captured into the evidence body and surfaced as `exitCode = -1`. The
 * function may still throw if the evidence write itself fails (e.g., disk
 * full, permission denied) — those are programmer-environment errors that
 * the audit pipeline should not silently swallow.
 *
 * @param cmd - Bare executable name or absolute path.
 * @param args - Literal argv passed to the child process.
 * @param evidencePath - Destination path for the raw combined output. Parent
 *   directories are created if missing. The caller chooses the extension
 *   (`.json` for JSON-emitting tools, `.txt` otherwise).
 * @param options - Optional spawn knobs. See `RunCommandOptions`.
 * @returns A populated `EvidenceRecord`.
 */
export async function runCommand(
  cmd: string,
  args: readonly string[],
  evidencePath: string,
  options?: RunCommandOptions,
): Promise<EvidenceRecord> {
  const runAt = new Date().toISOString();
  const argv = [...args];

  await fs.mkdir(path.dirname(evidencePath), { recursive: true });

  const spawnResult = await spawnAndCapture(cmd, argv, options?.cwd);

  await atomicWrite(evidencePath, spawnResult.combined);

  const tail =
    spawnResult.exitCode === 0
      ? []
      : extractTail(spawnResult.combined, MAX_TAIL_LINES);

  return {
    command: cmd,
    args: argv,
    exitCode: spawnResult.exitCode,
    runAt,
    evidencePath,
    tail,
  };
}

/**
 * Spawn the child process and resolve to its combined output and exit code.
 * Never rejects: spawn errors are coerced into a non-zero exit and the
 * error message is appended to the combined output.
 *
 * Windows shim resolution. Node's `child_process.spawn` with `shell: false`
 * does not honor `PATHEXT` — so `spawn('pnpm', [...])` fails with ENOENT
 * on Windows because `pnpm` ships as `pnpm.cmd`. We refuse to flip
 * `shell: true` (it would re-introduce shell-expansion of args) and
 * instead resolve the bare command against `PATH` × `PATHEXT` ourselves
 * before handing it to spawn. POSIX is unaffected because
 * `resolveCommand` is a no-op when `process.platform !== 'win32'`.
 */
function spawnAndCapture(
  cmd: string,
  args: readonly string[],
  cwd?: string,
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve) => {
    const resolved = resolveCommand(cmd, args, cwd);
    const child = spawn(resolved.cmd, [...resolved.args], {
      shell: false,
      windowsHide: true,
      ...(cwd !== undefined ? { cwd } : {}),
    });

    /**
     * Chunks are stored in arrival order across both streams to preserve
     * approximate interleaving for the tail. Node does not guarantee
     * perfectly interleaved ordering between stdout and stderr, but
     * arrival-order concatenation is the closest we can get without a
     * pseudo-tty.
     */
    const chunks: string[] = [];

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      chunks.push(chunk);
    });

    let settled = false;
    const settle = (result: SpawnResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.on('error', (err: NodeJS.ErrnoException) => {
      // Surface spawn errors (ENOENT, EACCES, etc.) into the evidence body.
      const message = err.message ?? String(err);
      chunks.push(`\nspawn error: ${message}\n`);
      settle({
        exitCode: -1,
        combined: chunks.join(''),
      });
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      // Treat null exit codes (signal termination, abnormal close) as
      // non-zero so the tail is captured exactly as Requirement 3.6
      // expects on failure.
      let exitCode: number;
      if (typeof code === 'number') {
        exitCode = code;
      } else if (signal !== null) {
        exitCode = 1;
      } else {
        exitCode = 1;
      }
      settle({
        exitCode,
        combined: chunks.join(''),
      });
    });
  });
}

/**
 * Write `body` to `evidencePath` atomically by writing to
 * `<evidencePath>.tmp` first and then renaming. `fs.rename` on the same
 * filesystem is atomic on Windows and POSIX, so observers either see the
 * previous file (or no file) or the fully written new one — never a
 * partial write.
 */
async function atomicWrite(evidencePath: string, body: string): Promise<void> {
  const tmpPath = `${evidencePath}.tmp`;
  await fs.writeFile(tmpPath, body, 'utf8');
  await fs.rename(tmpPath, evidencePath);
}

/**
 * Spawn-ready descriptor returned by {@link resolveCommand}. On POSIX this
 * always carries the original `cmd` and `args`; on Windows it may rewrite
 * a `.cmd`/`.bat` shim invocation to go through `cmd.exe /d /s /c "..."`
 * because Node's `spawn` with `shell: false` cannot directly execute
 * batch shims (it returns ENOENT or EINVAL depending on the version).
 *
 * The rewrite is deliberately narrow: only `.cmd`/`.bat` targets get
 * wrapped. Real native `.exe` binaries are launched directly so we
 * preserve the security guarantee documented at the top of this file
 * ("argv is passed verbatim, no shell expansion").
 */
interface ResolvedCommand {
  readonly cmd: string;
  readonly args: readonly string[];
}

/**
 * Resolve a bare command name to a concrete spawn-ready descriptor.
 *
 * On POSIX systems the OS resolver already does the right thing, so this
 * helper returns `{ cmd, args }` unchanged. On Windows, `spawn` with
 * `shell: false` does NOT honor `PATHEXT` — so a bare `pnpm` is not
 * found, because the executable on disk is `pnpm.cmd`. We replicate the
 * standard `PATH × PATHEXT` walk:
 *
 *   1. If `cmd` already contains a path separator, treat it as a literal
 *      target — but still wrap if the extension is `.cmd`/`.bat`.
 *   2. Otherwise iterate every `PATH` entry, then every `PATHEXT` entry,
 *      and return the first concrete file that exists.
 *   3. If the resolved target is a `.cmd`/`.bat`, wrap the invocation in
 *      `cmd.exe /d /s /c "..."` and quote each argument so that argv is
 *      preserved verbatim. This is the same approach `cross-spawn` uses;
 *      we inline it here to avoid pulling in another dependency.
 *   4. If nothing matches, return `cmd` unchanged so the caller still
 *      sees the original ENOENT (and the evidence file records the
 *      provided command name).
 */
function resolveCommand(
  cmd: string,
  args: readonly string[],
  cwd?: string,
): ResolvedCommand {
  if (process.platform !== 'win32') {
    return { cmd, args };
  }

  // Already a path — figure out whether it's a shim that needs wrapping.
  if (cmd.includes('/') || cmd.includes('\\') || path.extname(cmd) !== '') {
    return wrapIfBatchShim(cmd, args);
  }

  const pathExtRaw = process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD';
  const pathExt = pathExtRaw
    .split(';')
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0);
  // Prefer the cwd first (so a workspace-local shim wins) and then PATH.
  const pathDirs = [cwd ?? '', ...(process.env['PATH'] ?? '').split(';')]
    .map((d) => d.trim())
    .filter((d) => d.length > 0);

  // Lazy require so we don't pay the syscall cost on POSIX.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { existsSync } = require('node:fs') as typeof import('node:fs');

  for (const dir of pathDirs) {
    for (const ext of pathExt) {
      const candidate = path.join(dir, `${cmd}${ext}`);
      if (existsSync(candidate)) {
        return wrapIfBatchShim(candidate, args);
      }
    }
  }
  return { cmd, args };
}

/**
 * If `target` ends in `.cmd` / `.bat`, rewrite the invocation to go
 * through `cmd.exe /d /s /c "<target> <args>"`. Each argument is wrapped
 * in double quotes and embedded `"` characters are escaped so argv
 * survives unchanged. The `/d` flag suppresses AutoRun, `/s` adjusts the
 * quoting rules to be parser-stable, and `/c` runs the command and
 * exits.
 */
function wrapIfBatchShim(
  target: string,
  args: readonly string[],
): ResolvedCommand {
  if (process.platform !== 'win32') {
    return { cmd: target, args };
  }
  const ext = path.extname(target).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') {
    return { cmd: target, args };
  }
  const escaped = [target, ...args].map(escapeForCmdExe).join(' ');
  return {
    cmd: 'cmd.exe',
    args: ['/d', '/s', '/c', escaped],
  };
}

/**
 * Quote a single argv token for `cmd.exe /c`. Empty arguments and any
 * argument containing whitespace, `"`, `&`, `|`, `<`, `>`, `^`, `(`, or
 * `)` get wrapped in double quotes; embedded `"` characters become `""`,
 * the cmd.exe escape. This is the well-known cross-spawn quoting rule
 * and is sufficient for every probe the auditor invokes (no probe ever
 * passes an arg containing a literal newline).
 */
function escapeForCmdExe(arg: string): string {
  if (arg.length === 0) {
    return '""';
  }
  if (!/[\s"&|<>^()]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Extract the trailing `maxLines` lines of `combined`. Splits on both
 * `\r\n` and `\n` to handle mixed line endings (common on Windows). A
 * single trailing empty string produced by a final newline is dropped so
 * the tail does not pad with a phantom blank line.
 */
function extractTail(combined: string, maxLines: number): string[] {
  if (combined.length === 0) {
    return [];
  }
  const lines = combined.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length <= maxLines) {
    return lines;
  }
  return lines.slice(lines.length - maxLines);
}
