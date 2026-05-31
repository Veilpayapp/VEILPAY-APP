/**
 * Smoke test for the `auditor run` CLI entrypoint (task 7.2).
 *
 * Exercises the full Pass 1 → Pass 2 → Pass 3 → Pass 4 pipeline end-to-end
 * by spawning the CLI as a subprocess against a synthetic fixture
 * workspace under `os.tmpdir()`. The fixture contains the bare minimum
 * to satisfy Pass 1 Discovery (a real git repo with a single commit, the
 * seven canonical Plan_Documents, an `apps/`, a `packages/`, and a
 * `.kiro/specs/spec-a/requirements.md`). Pass 2 probes that depend on
 * tools the fixture does not ship (pnpm, eslint, jest, jscpd, gitleaks,
 * graphify) degrade to `'unmeasured'` via the runner harness's
 * ENOENT-coercion path — `runProbeBestEffort` swallows the failure, and
 * the unwrapped graphify runner surfaces the missing binary as a
 * populated `failure_capture` rather than a thrown exception.
 *
 * Validates Requirements 1.1 (Audit_Report at the canonical path), 1.4
 * (Run Metadata block carries an ISO 8601 `Generated` timestamp and a
 * 40-char hex Workspace SHA), 2.4 / 2.5 (each Plan_Document is annotated
 * in place — Superseded_Marker prepended or `## Audit Refresh` appended).
 *
 * Strategy
 * --------
 *   - Probe `git --version` first and skip the test (with `console.warn`)
 *     when git is unavailable. Pass 1 Discovery hard-aborts on a missing
 *     `git rev-parse HEAD`, so without git the smoke test cannot exercise
 *     the success path.
 *   - Build a fresh fixture workspace under `os.tmpdir()` per test via
 *     `fs.mkdtemp` so concurrent jest workers cannot cross-contaminate.
 *     Initialise it as a real git repo (`git init -b main` + a single
 *     commit) so `git rev-parse HEAD` returns a 40-char hex SHA.
 *   - Spawn the CLI with `node` + the resolved `ts-node` bin, cwd of the
 *     auditor package, and `shell: false` so argv is passed verbatim
 *     (matches the design's Windows-cmd-compatible spawning rule).
 *     `--workspace-root <fixtureRoot>` directs every pipeline write to
 *     the fixture and never to the real workspace.
 *   - On exit code 0, assert the fixture's
 *     `<fixtureRoot>/plans/PRODUCTION_READINESS_AUDIT.md` exists, is
 *     non-empty, contains a well-formed Run Metadata block, and at
 *     least one of the seven canonical Plan_Documents has been annotated
 *     with `## Audit Refresh` or the Superseded_Marker block.
 *   - Clean up via `fs.rm({ recursive: true, force: true })` regardless
 *     of test outcome.
 *
 * The point of this test is the end-to-end exit code + write-set check.
 * It is intentionally NOT a property-based test — fast-check is not
 * imported here. Per-section invariants live in the dedicated property
 * tests (Properties 1, 2, 3, 5, 7, 8, 12, 13).
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CANONICAL_PLAN_PATHS } from '../passes/synthesis/plans';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Absolute path to the auditor package directory. The CLI is spawned with
 * this as its `cwd` so `ts-node` resolves `tsconfig.json` and the
 * monorepo's `node_modules` correctly. `__dirname` is
 * `packages/auditor/src/cli` under ts-jest.
 */
const AUDITOR_PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Workspace-relative POSIX path to the CLI entrypoint. Spawned via
 * `node <tsNodeBin> <CLI_ENTRY_REL>` so the CLI runs through ts-node
 * and never depends on a prior `tsc` build.
 */
const CLI_ENTRY_REL = 'src/cli/index.ts';

/**
 * Generous test timeout. The CLI runs many subprocess probes (per-package
 * tsc, eslint, jest coverage, complexity, duplication, secret scan,
 * graphify) which mostly fail-fast with ENOENT against the fixture but
 * still incur per-spawn overhead. 120s gives the smoke test ample headroom
 * even on a slow CI machine.
 */
const SMOKE_TEST_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// CLI subprocess helpers
// ---------------------------------------------------------------------------

/**
 * Result of a single CLI invocation: the integer exit code plus the
 * combined stdout/stderr captured from the child process. We surface
 * stderr separately so a failed assertion can include it in the test
 * report without forcing the reader to dig through Jest's stdio capture.
 */
interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Probe whether `git --version` succeeds. Used to skip the smoke test on
 * machines that lack git — Pass 1 Discovery would otherwise hard-abort
 * before the smoke test can exercise the success path.
 */
async function gitIsAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn('git', ['--version'], {
      shell: false,
      windowsHide: true,
    });
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(ok);
    };
    child.on('error', () => settle(false));
    child.on('close', (code) => settle(code === 0));
  });
}

/**
 * Run `git <args>` with `cwd` set to `cwd`. Returns the integer exit code
 * (with `null` from a signal-terminated process coerced to `1`). Used to
 * initialise the fixture workspace as a real git repo so Pass 1's
 * `git rev-parse HEAD` precondition succeeds.
 */
function runGit(args: readonly string[], cwd: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn('git', [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      // Suppress git's stdout/stderr — we only need the exit code, and
      // leaking git output into the Jest console is noisy.
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let settled = false;
    const settle = (code: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(code);
    };
    child.on('error', () => settle(1));
    child.on('close', (code) => settle(typeof code === 'number' ? code : 1));
  });
}

/**
 * Spawn `auditor run --workspace-root <fixtureRoot>` as a subprocess.
 *
 * Uses `node` + the resolved `ts-node` bin so the CLI runs through
 * ts-node's loader and never depends on a prior `tsc` build (matches the
 * `audit:prod` script in `package.json`). `shell: false` keeps argv
 * verbatim — no POSIX expansion, no Windows-cmd parsing — which matches
 * the design's Windows-compatible spawning rule.
 *
 * Returns once the child closes. Stdout and stderr are buffered into
 * strings and surfaced alongside the exit code so a failing assertion
 * can include them in the diagnostic message. Environment is inherited
 * verbatim from the test process; we explicitly clear `NODE_OPTIONS` to
 * avoid picking up the Jest launcher's `--experimental-vm-modules` flag,
 * which is meaningful inside Jest but irrelevant (and noisy) for the
 * standalone CLI run.
 */
function spawnCli(fixtureRoot: string): Promise<CliResult> {
  return new Promise<CliResult>((resolve) => {
    // ts-node ships with a `dist/bin.js` entrypoint we can hand to `node`
    // verbatim. Resolving from the auditor package root ensures we pick
    // up the workspace's pnpm-installed ts-node.
    const tsNodeBin = require.resolve('ts-node/dist/bin.js', {
      paths: [AUDITOR_PACKAGE_ROOT],
    });

    // Surface the standalone CLI under a clean NODE_OPTIONS env so the
    // child process doesn't inherit Jest's `--experimental-vm-modules`
    // flag. Inheriting it is harmless but pollutes the child's stderr
    // with a warning we'd rather not see in test output.
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    delete childEnv['NODE_OPTIONS'];

    const child = spawn(
      process.execPath,
      [
        tsNodeBin,
        '--transpile-only',
        CLI_ENTRY_REL,
        'run',
        '--workspace-root',
        fixtureRoot,
      ],
      {
        cwd: AUDITOR_PACKAGE_ROOT,
        shell: false,
        windowsHide: true,
        env: childEnv,
      },
    );

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: string) => stderrChunks.push(chunk));

    let settled = false;
    const settle = (result: CliResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.on('error', (err) => {
      stderrChunks.push(`\nspawn error: ${err.message}\n`);
      settle({
        exitCode: -1,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    });
    child.on('close', (code, signal) => {
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
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

/**
 * Materialize the synthetic fixture workspace under a fresh `mkdtemp`
 * directory. The fixture contains:
 *
 *   - A real git repo (`git init -b main` + one empty-tree commit) so
 *     Pass 1's `git rev-parse HEAD` returns a 40-char hex SHA.
 *   - The seven canonical Plan_Documents under `<root>/plans/` populated
 *     with placeholder content. Each plan body is non-empty so
 *     `annotatePlan` has something to preserve as a contiguous substring.
 *   - Empty `apps/`, `packages/`, and `.kiro/specs/spec-a/requirements.md`
 *     directories. Pass 1's per-bucket inventory tolerates empty
 *     subtrees, so we don't need to plant any source files.
 *
 * Returns the absolute path to the fixture root. Caller is responsible
 * for cleanup via `fs.rm({ recursive: true, force: true })` in
 * `afterEach`.
 */
async function buildFixtureWorkspace(): Promise<string> {
  const fixtureRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'auditor-cli-smoke-'),
  );

  // ---- Git repo with a single commit -----------------------------------
  // `git init -b main` lands the initial branch as `main` directly so we
  // don't depend on the host's `init.defaultBranch` setting. We then
  // create a single empty commit so `git rev-parse HEAD` resolves —
  // bare `git init` leaves HEAD as an unborn ref that `rev-parse` rejects.
  const initCode = await runGit(['init', '-b', 'main'], fixtureRoot);
  if (initCode !== 0) {
    throw new Error(`fixture: git init failed with exit code ${initCode}`);
  }
  // Configure a local commit identity so `git commit` does not fail on a
  // host without a global `user.email`/`user.name`. The values are
  // arbitrary — the smoke test never reads them.
  await runGit(['config', 'user.email', 'smoke-test@veilpay.local'], fixtureRoot);
  await runGit(['config', 'user.name', 'Auditor Smoke Test'], fixtureRoot);
  // `--allow-empty` lets us land a commit without staging any files; the
  // commit's only purpose is to give HEAD a real 40-char hex SHA.
  const commitCode = await runGit(
    ['commit', '--allow-empty', '-m', 'fixture: initial commit'],
    fixtureRoot,
  );
  if (commitCode !== 0) {
    throw new Error(`fixture: git commit failed with exit code ${commitCode}`);
  }

  // ---- Canonical Plan_Documents under plans/ ---------------------------
  const plansDir = path.join(fixtureRoot, 'plans');
  await fs.mkdir(plansDir, { recursive: true });
  for (const planPath of CANONICAL_PLAN_PATHS) {
    // `planPath` is workspace-relative POSIX (e.g., `plans/ROADMAP.md`).
    // Split-and-join via `path.sep` so the test runs on both Windows
    // (backslashes) and POSIX (forward slashes) hosts.
    const abs = path.join(fixtureRoot, ...planPath.split('/'));
    const body = `# ${path.basename(planPath)}\n\nPlaceholder plan content for ${planPath}.\n`;
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
  }

  // ---- apps/, packages/, and a dummy spec directory --------------------
  // Pass 1 inventory tolerates empty subtrees; we plant the directories
  // (and a single requirements.md so `.kiro/specs/spec-a/` is a proper
  // spec dir per Requirement 8.2) so the audit still has something to
  // walk through.
  await fs.mkdir(path.join(fixtureRoot, 'apps'), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, 'packages'), { recursive: true });
  const specDir = path.join(fixtureRoot, '.kiro', 'specs', 'spec-a');
  await fs.mkdir(specDir, { recursive: true });
  await fs.writeFile(
    path.join(specDir, 'requirements.md'),
    '# Spec A\n\nPlaceholder requirements document for the smoke-test fixture.\n',
    'utf8',
  );

  return fixtureRoot;
}

// ---------------------------------------------------------------------------
// Run Metadata extraction
// ---------------------------------------------------------------------------

/**
 * Captured Run Metadata fields used in the assertions. `generated` and
 * `workspaceSha` are required to be present; missing values surface as
 * `null` so the assertions can produce a descriptive failure message
 * rather than a cryptic `undefined` from a missing key.
 */
interface RunMetadataExtract {
  readonly generated: string | null;
  readonly workspaceSha: string | null;
}

/**
 * Extract the `Generated` and `Workspace SHA` lines from the rendered
 * Run Metadata block. The renderer emits the block under a `## Run
 * Metadata` heading with the fixed bullet shape:
 *
 *     - Generated: <iso 8601>
 *     - Workspace SHA: <40-char hex>
 *     - Graphify Run: <iso 8601>
 *     - Auditor: <name>
 *
 * A linear line-scan is sufficient — we don't need a Markdown parser.
 */
function extractRunMetadata(markdown: string): RunMetadataExtract {
  const lines = markdown.split(/\r?\n/);
  let generated: string | null = null;
  let workspaceSha: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('- Generated:')) {
      generated = line.slice('- Generated:'.length).trim();
    } else if (line.startsWith('- Workspace SHA:')) {
      workspaceSha = line.slice('- Workspace SHA:'.length).trim();
    }
  }
  return { generated, workspaceSha };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auditor CLI smoke test (task 7.2)', () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    if (fixtureRoot !== null) {
      await fs.rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      fixtureRoot = null;
    }
  });

  it(
    'runs end-to-end against a fixture workspace, writes the consolidated report, and annotates at least one Plan_Document',
    async () => {
      // Pre-flight: Pass 1 Discovery hard-aborts on a missing
      // `git rev-parse HEAD`. If the host has no git, skip the test
      // rather than letting the smoke test fail spuriously.
      if (!(await gitIsAvailable())) {
        // eslint-disable-next-line no-console
        console.warn(
          '[cli.smoke.test] skipping: git is not available on this host',
        );
        return;
      }

      // ---- Build the fixture workspace --------------------------------
      fixtureRoot = await buildFixtureWorkspace();

      // ---- Spawn the CLI and capture its outcome ----------------------
      const result = await spawnCli(fixtureRoot);

      // ---- Exit code 0 (success path) ---------------------------------
      // Combine stdout and stderr into the failure message so a non-zero
      // exit surfaces enough context to diagnose without re-running.
      if (result.exitCode !== 0) {
        throw new Error(
          [
            `auditor CLI exited with code ${result.exitCode} (expected 0).`,
            '',
            '--- stdout ---',
            result.stdout,
            '--- stderr ---',
            result.stderr,
          ].join('\n'),
        );
      }

      // ---- PRODUCTION_READINESS_AUDIT.md exists and is non-empty ------
      const reportPath = path.join(
        fixtureRoot,
        'plans',
        'PRODUCTION_READINESS_AUDIT.md',
      );
      const reportStat = await fs.stat(reportPath);
      expect(reportStat.isFile()).toBe(true);
      expect(reportStat.size).toBeGreaterThan(0);
      const reportBody = await fs.readFile(reportPath, 'utf8');
      expect(reportBody.length).toBeGreaterThan(0);

      // ---- Run Metadata block is well-formed (Requirement 1.4) --------
      // `Generated:` must be an ISO 8601 timestamp (parseable by
      // `Date.parse`). `Workspace SHA:` must be a 40-char hex string —
      // anything else means Pass 1 either short-circuited the SHA
      // capture or the renderer emitted a placeholder.
      const metadata = extractRunMetadata(reportBody);
      expect(metadata.generated).not.toBeNull();
      expect(metadata.workspaceSha).not.toBeNull();
      const generatedMs = Date.parse(metadata.generated ?? '');
      expect(Number.isFinite(generatedMs)).toBe(true);
      expect(metadata.workspaceSha ?? '').toMatch(/^[0-9a-f]{40}$/i);

      // ---- At least one Plan_Document was annotated ------------------
      // Per Requirements 2.4 / 2.5, every canonical Plan_Document is
      // annotated with either a Superseded_Marker prefix or an
      // `## Audit Refresh` section. The smoke test asserts the weaker
      // "at least one" form so it can run without coupling to the
      // disposition heuristics in `buildPlanScores`. The dedicated
      // annotation property test (task 6.4) covers the per-disposition
      // shape contract.
      let annotatedCount = 0;
      for (const planPath of CANONICAL_PLAN_PATHS) {
        const abs = path.join(fixtureRoot, ...planPath.split('/'));
        const after = await fs.readFile(abs, 'utf8');
        const hasSupersededMarker = after.startsWith('> [!WARNING]');
        const hasAuditRefresh = /^##\s+Audit Refresh\b/m.test(after);
        if (hasSupersededMarker || hasAuditRefresh) {
          annotatedCount += 1;
        }
      }
      expect(annotatedCount).toBeGreaterThan(0);
    },
    SMOKE_TEST_TIMEOUT_MS,
  );
});
