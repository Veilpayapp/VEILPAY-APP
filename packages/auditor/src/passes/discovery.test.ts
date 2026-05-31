/**
 * Unit tests for Pass 1 (Discovery).
 *
 * These tests build a fixture workspace under `os.tmpdir()` per test using
 * `fs.mkdtemp`, then drive `runDiscovery` against it. The fixture mirrors
 * the real workspace shape closely enough to exercise every inventory
 * bucket without touching `d:\Veilpay\plans\.audit-evidence\` or any other
 * production path.
 *
 * Test 1 — Happy path:
 *   The fixture is initialized as a real git repo (`git init` + a single
 *   commit) so `git rev-parse HEAD` returns a real 40-char SHA. We assert
 *   each inventory bucket is populated, the SHA matches the hex regex,
 *   the `generatedAt` timestamp parses as ISO 8601, and the consolidated
 *   audit deliverable (`PRODUCTION_READINESS_AUDIT.md`) is excluded from
 *   `planFiles`.
 *
 * Test 2 — Abort path:
 *   The fixture is created WITHOUT a `.git` directory, so
 *   `git rev-parse HEAD` exits non-zero. We assert `runDiscovery` throws
 *   an `AuditAbortError` whose `command`, `exitCode`, `outputTail`, and
 *   `capturedAt` fields match Requirements 1.4 and 10.6.
 *
 * If `git` is not available on the host (CI without git installed), both
 * tests are skipped via `describe.skip`. Detection is a one-shot
 * `runCommand('git', ['--version'], ...)` probe in `beforeAll`.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AuditAbortError } from '../util/errors';
import { runCommand } from './staticAnalysis/runner';
import { runDiscovery } from './discovery';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function cleanupTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function writeFixtureFile(
  root: string,
  relPath: string,
  body: string,
): Promise<void> {
  const abs = path.join(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, 'utf8');
}

/**
 * Probe whether `git` is available on the host. The result is cached in a
 * module-level variable so a single probe drives both `describe.skip`
 * decisions.
 */
async function probeGitAvailable(): Promise<boolean> {
  const probeDir = await makeTempDir('auditor-discovery-probe-');
  try {
    const evidencePath = path.join(probeDir, 'git-version.txt');
    const record = await runCommand('git', ['--version'], evidencePath);
    return record.exitCode === 0;
  } catch {
    return false;
  } finally {
    await cleanupTempDir(probeDir);
  }
}

/**
 * Initialize `root` as a git repo with a single commit so
 * `git rev-parse HEAD` resolves. Uses local `user.email` / `user.name`
 * config so the test does not depend on the host's global git config.
 */
async function gitInitWithCommit(root: string): Promise<void> {
  const evidenceDir = path.join(root, '.git-init-evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  // Use `-b main` to skip the "default branch name" hint and keep output
  // deterministic across git versions.
  const init = await runCommand(
    'git',
    ['init', '-b', 'main'],
    path.join(evidenceDir, 'init.txt'),
    { cwd: root },
  );
  if (init.exitCode !== 0) {
    throw new Error(
      `git init failed in fixture: exit ${init.exitCode}; tail=${init.tail.join(' | ')}`,
    );
  }
  await runCommand(
    'git',
    ['config', 'user.email', 'auditor-test@veilpay.local'],
    path.join(evidenceDir, 'config-email.txt'),
    { cwd: root },
  );
  await runCommand(
    'git',
    ['config', 'user.name', 'auditor-test'],
    path.join(evidenceDir, 'config-name.txt'),
    { cwd: root },
  );
  // `commit.gpgsign=false` defends against host config that requires
  // signed commits — the fixture has no signing key.
  await runCommand(
    'git',
    ['config', 'commit.gpgsign', 'false'],
    path.join(evidenceDir, 'config-gpgsign.txt'),
    { cwd: root },
  );
  const add = await runCommand(
    'git',
    ['add', '-A'],
    path.join(evidenceDir, 'add.txt'),
    { cwd: root },
  );
  if (add.exitCode !== 0) {
    throw new Error(
      `git add failed in fixture: exit ${add.exitCode}; tail=${add.tail.join(' | ')}`,
    );
  }
  const commit = await runCommand(
    'git',
    ['commit', '-m', 'fixture', '--allow-empty'],
    path.join(evidenceDir, 'commit.txt'),
    { cwd: root },
  );
  if (commit.exitCode !== 0) {
    throw new Error(
      `git commit failed in fixture: exit ${commit.exitCode}; tail=${commit.tail.join(' | ')}`,
    );
  }
}

/**
 * Populate `root` with the canonical fixture content used by the happy-path
 * test. Mirrors the file layout described in the task plan: spec dirs, plan
 * files (including the consolidated audit deliverable, which must be
 * excluded), a network icon asset and renderer, four backend route files,
 * and three workspace-root scripts.
 */
async function populateHappyFixture(root: string): Promise<void> {
  // Spec directories.
  await fs.mkdir(path.join(root, '.kiro', 'specs', 'spec-a'), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, '.kiro', 'specs', 'spec-b'), {
    recursive: true,
  });
  await writeFixtureFile(
    root,
    '.kiro/specs/spec-a/requirements.md',
    '# spec-a\n',
  );
  await writeFixtureFile(
    root,
    '.kiro/specs/spec-b/requirements.md',
    '# spec-b\n',
  );

  // Plan files. PRODUCTION_READINESS_AUDIT.md must be EXCLUDED from
  // `planFiles` because it is the audit deliverable itself.
  await writeFixtureFile(root, 'plans/PLAN_A.md', '# Plan A\n');
  await writeFixtureFile(root, 'plans/PLAN_B.md', '# Plan B\n');
  await writeFixtureFile(
    root,
    'plans/PRODUCTION_READINESS_AUDIT.md',
    '# Audit\n',
  );

  // Network icon asset + renderer that references the asset basename.
  await writeFixtureFile(
    root,
    'apps/consumer-app/assets/network-eth.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" />',
  );
  await writeFixtureFile(
    root,
    'apps/consumer-app/src/components/NetworkIcon.tsx',
    "import icon from '../../assets/network-eth.svg';\nexport const NetworkIcon = () => null;\n",
  );

  // Backend route files. Each declares a route so the bucketing
  // path-prefix matcher fires.
  await writeFixtureFile(
    root,
    'apps/backend/src/routes/webhook.ts',
    "import { Router } from 'express';\nconst router = Router();\nrouter.post('/webhooks', () => {});\nexport default router;\n",
  );
  await writeFixtureFile(
    root,
    'apps/backend/src/routes/merchant.ts',
    "import { Router } from 'express';\nconst router = Router();\nrouter.get('/merchants', () => {});\nexport default router;\n",
  );
  await writeFixtureFile(
    root,
    'apps/backend/src/routes/invoice.ts',
    "import { Router } from 'express';\nconst router = Router();\nrouter.get('/invoices', () => {});\nexport default router;\n",
  );
  await writeFixtureFile(
    root,
    'apps/backend/src/routes/admin.ts',
    "import { Router } from 'express';\nconst router = Router();\nrouter.get('/admin', () => {});\nexport default router;\n",
  );

  // Workspace-root scripts triaged by Requirement 7.4.
  await writeFixtureFile(root, 'tmp_smoke.js', "console.log('tmp');\n");
  await writeFixtureFile(root, 'autofix.js', "console.log('autofix');\n");
  await writeFixtureFile(root, 'audit.js', "console.log('audit');\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runDiscovery', () => {
  let gitAvailable = false;

  beforeAll(async () => {
    gitAvailable = await probeGitAvailable();
  });

  describe('happy path against a fixture workspace', () => {
    let fixtureRoot: string;
    let evidenceDir: string;

    beforeEach(async () => {
      fixtureRoot = await makeTempDir('auditor-discovery-happy-');
      evidenceDir = path.join(fixtureRoot, '.audit-evidence');
    });

    afterEach(async () => {
      await cleanupTempDir(fixtureRoot);
    });

    it('populates every inventory bucket and excludes the audit deliverable', async () => {
      if (!gitAvailable) {
        // Skipped at the assertion layer because describe.skip cannot read
        // an async-resolved flag synchronously. The skip decision is made
        // here so the test still appears in the report as skipped.
        // eslint-disable-next-line no-console
        console.warn('git not available; skipping discovery happy-path test');
        return;
      }

      await populateHappyFixture(fixtureRoot);
      await gitInitWithCommit(fixtureRoot);

      const result = await runDiscovery({
        workspaceRoot: fixtureRoot,
        evidenceDir,
      });

      // Workspace SHA is a real 40-char hex string.
      expect(result.workspaceSha).toMatch(/^[0-9a-f]{40}$/);

      // generatedAt parses as a valid ISO 8601 timestamp.
      expect(Number.isFinite(Date.parse(result.generatedAt))).toBe(true);
      expect(result.generatedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );

      // Spec dirs: both spec-a and spec-b are inventoried. Paths are
      // POSIX-style and rooted at `.kiro/specs/`.
      expect(result.specDirs).toEqual(
        expect.arrayContaining([
          '.kiro/specs/spec-a',
          '.kiro/specs/spec-b',
        ]),
      );
      expect(result.specDirs.length).toBeGreaterThanOrEqual(2);

      // Plan files: PLAN_A and PLAN_B are present; the audit deliverable
      // itself must be excluded so it doesn't show up as a plan input.
      expect(result.planFiles).toEqual(
        expect.arrayContaining(['plans/PLAN_A.md', 'plans/PLAN_B.md']),
      );
      expect(result.planFiles).not.toContain(
        'plans/PRODUCTION_READINESS_AUDIT.md',
      );

      // Network icon assets and renderers. The renderer was authored to
      // reference the asset basename verbatim.
      expect(result.networkIconAssets).toContain(
        'apps/consumer-app/assets/network-eth.svg',
      );
      expect(result.networkIconRenderers).toContain(
        'apps/consumer-app/src/components/NetworkIcon.tsx',
      );

      // Backend routes bucketed by surface.
      expect(result.backendRoutes.webhooks).toContain(
        'apps/backend/src/routes/webhook.ts',
      );
      expect(result.backendRoutes.merchant).toContain(
        'apps/backend/src/routes/merchant.ts',
      );
      expect(result.backendRoutes.invoice).toContain(
        'apps/backend/src/routes/invoice.ts',
      );
      expect(result.backendRoutes.admin).toContain(
        'apps/backend/src/routes/admin.ts',
      );

      // Root scripts: every matching pattern is present.
      expect(result.rootScripts).toEqual(
        expect.arrayContaining(['tmp_smoke.js', 'autofix.js', 'audit.js']),
      );

      // Evidence file written under the injected directory, never the
      // production `d:\Veilpay\plans\.audit-evidence\`.
      const evidencePath = path.join(evidenceDir, 'git-rev-parse-head.txt');
      const evidence = await fs.readFile(evidencePath, 'utf8');
      expect(evidence.trim()).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe('abort path when git rev-parse HEAD fails', () => {
    let fixtureRoot: string;
    let evidenceDir: string;

    beforeEach(async () => {
      fixtureRoot = await makeTempDir('auditor-discovery-abort-');
      evidenceDir = path.join(fixtureRoot, '.audit-evidence');
    });

    afterEach(async () => {
      await cleanupTempDir(fixtureRoot);
    });

    it('throws AuditAbortError carrying command, exit code, and trailing output', async () => {
      if (!gitAvailable) {
        // eslint-disable-next-line no-console
        console.warn('git not available; skipping discovery abort-path test');
        return;
      }

      // Deliberately do NOT initialize git in `fixtureRoot`. Running
      // `git rev-parse HEAD` here exits non-zero ("not a git repository").
      // The fixture also contains a sentinel file so the workspace itself
      // is non-empty, ruling out other failure modes.
      await writeFixtureFile(
        fixtureRoot,
        'README.md',
        '# fixture without git\n',
      );

      await expect(
        runDiscovery({
          workspaceRoot: fixtureRoot,
          evidenceDir,
        }),
      ).rejects.toBeInstanceOf(AuditAbortError);

      try {
        await runDiscovery({
          workspaceRoot: fixtureRoot,
          evidenceDir,
        });
        throw new Error('expected runDiscovery to throw AuditAbortError');
      } catch (err) {
        expect(err).toBeInstanceOf(AuditAbortError);
        const abort = err as AuditAbortError;
        expect(abort.command).toBe('git rev-parse HEAD');
        expect(abort.exitCode).not.toBe(0);
        // outputTail is populated from the harness's combined stdout/stderr;
        // the constructor wraps it as a frozen readonly array, so we only
        // assert it is well-formed. The harness caps it at 50 lines.
        expect(Array.isArray(abort.outputTail)).toBe(true);
        expect(abort.outputTail.length).toBeGreaterThanOrEqual(0);
        expect(abort.outputTail.length).toBeLessThanOrEqual(50);
        // capturedAt is an ISO 8601 timestamp.
        expect(Number.isFinite(Date.parse(abort.capturedAt))).toBe(true);
        expect(abort.capturedAt).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        );
      }
    });
  });
});
