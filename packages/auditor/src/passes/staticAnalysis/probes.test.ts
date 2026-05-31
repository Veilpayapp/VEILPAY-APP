/**
 * Unit tests for Pass 2 static-analysis probe failure handling.
 *
 * For each probe in `probes.ts` (and the secret-scan probe in `security.ts`),
 * simulates a spawn-level failure (binary missing, surfaced as
 * `exitCode === -1` with a `'spawn error: ... ENOENT'` tail) or a generic
 * non-zero exit, and asserts the runner returns a structured `unmeasured`
 * result with an evidence pointer rather than crashing the pipeline.
 *
 * Strategy: `jest.mock('./runner')` replaces `runCommand` with a Jest mock so
 * no real child processes are spawned and no evidence files land on disk
 * outside per-test temp directories. Temp directories are created via
 * `os.tmpdir()` + `fs.mkdtemp` so production
 * `d:\Veilpay\plans\.audit-evidence\` is never touched.
 *
 * Validates: Requirements 3.6, 6.8, 7.2, 7.3, 7.5, 7.6, 7.7.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock the evidence-capture harness so the probes never spawn a real
// process. The actual exports (types, MAX_TAIL_LINES) are preserved so the
// rest of the module under test continues to compile and link.
jest.mock('./runner', () => {
  const actual = jest.requireActual<typeof import('./runner')>('./runner');
  return {
    ...actual,
    runCommand: jest.fn(),
  };
});

import { runCommand, type EvidenceRecord } from './runner';
import {
  runComplexity,
  runDuplication,
  runPnpmAudit,
  runWorkspaceEslint,
  runWorkspaceJestCoverage,
  runWorkspaceTsc,
} from './probes';
import { runSecretScan } from './security';
import { UNMEASURED } from '../../models';

const mockedRunCommand = runCommand as jest.MockedFunction<typeof runCommand>;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function cleanupTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Build an `EvidenceRecord` shaped like a spawn-level failure: `runner.ts`
 * surfaces ENOENT (and the Windows `cmd` "is not recognized" variant) as
 * `exitCode === -1` with the spawn error appended to the trailing tail.
 */
function spawnFailureRecord(
  cmd: string,
  args: readonly string[],
  evidencePath: string,
): EvidenceRecord {
  return {
    command: cmd,
    args,
    exitCode: -1,
    runAt: '2025-01-15T00:00:00.000Z',
    evidencePath,
    tail: ['', `spawn error: spawn ${cmd} ENOENT`, ''],
  };
}

/**
 * Build an `EvidenceRecord` shaped like a generic non-zero exit (tool ran
 * but failed). Used for probes (`runComplexity`, `runDuplication`) that
 * treat non-zero exit as a measurement failure rather than a successful
 * "tool reported findings" signal.
 */
function nonZeroExitRecord(
  cmd: string,
  args: readonly string[],
  evidencePath: string,
  exitCode = 1,
): EvidenceRecord {
  return {
    command: cmd,
    args,
    exitCode,
    runAt: '2025-01-15T00:00:00.000Z',
    evidencePath,
    tail: [`${cmd} exited with ${exitCode}`],
  };
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe('probe failure handling', () => {
  let workspaceRoot: string;
  let evidenceDir: string;

  beforeEach(async () => {
    workspaceRoot = await makeTempDir('auditor-probes-ws-');
    evidenceDir = await makeTempDir('auditor-probes-ev-');
    mockedRunCommand.mockReset();
  });

  afterEach(async () => {
    await cleanupTempDir(workspaceRoot);
    await cleanupTempDir(evidenceDir);
  });

  describe('runPnpmAudit', () => {
    it('returns advisories: "unmeasured" with the evidence pointer when the spawn fails (exitCode -1)', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) =>
        spawnFailureRecord(cmd, args, evidencePath),
      );

      const result = await runPnpmAudit({ workspaceRoot, evidenceDir });

      expect(result.advisories).toBe(UNMEASURED);
      expect(result.record).toBeDefined();
      expect(result.record.exitCode).toBe(-1);
      expect(result.record.evidencePath).toBe(
        path.join(evidenceDir, 'pnpm-audit.json'),
      );
      expect(mockedRunCommand).toHaveBeenCalledWith(
        'pnpm',
        ['audit', '--json'],
        path.join(evidenceDir, 'pnpm-audit.json'),
        expect.objectContaining({ cwd: workspaceRoot }),
      );
    });
  });

  describe('runWorkspaceTsc', () => {
    it('returns errorCount: "unmeasured" with the evidence pointer when the spawn fails', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) =>
        spawnFailureRecord(cmd, args, evidencePath),
      );

      const result = await runWorkspaceTsc({
        workspaceRoot,
        evidenceDir,
        packageName: '@veilpay/backend',
      });

      expect(result.errorCount).toBe(UNMEASURED);
      expect(result.record.exitCode).toBe(-1);
      expect(result.record.evidencePath).toBe(
        path.join(evidenceDir, 'tsc.veilpay__backend.txt'),
      );
      expect(mockedRunCommand).toHaveBeenCalledWith(
        'pnpm',
        ['--filter', '@veilpay/backend', 'exec', 'tsc', '--noEmit'],
        path.join(evidenceDir, 'tsc.veilpay__backend.txt'),
        expect.objectContaining({ cwd: workspaceRoot }),
      );
    });
  });

  describe('runWorkspaceEslint', () => {
    it('returns counts: { errors: "unmeasured", warnings: "unmeasured" } with the evidence pointer when the spawn fails', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) =>
        spawnFailureRecord(cmd, args, evidencePath),
      );

      const result = await runWorkspaceEslint({
        workspaceRoot,
        evidenceDir,
        packageName: '@veilpay/backend',
      });

      expect(result.counts.errors).toBe(UNMEASURED);
      expect(result.counts.warnings).toBe(UNMEASURED);
      expect(result.record.exitCode).toBe(-1);
      expect(result.record.evidencePath).toBe(
        path.join(evidenceDir, 'eslint.veilpay__backend.json'),
      );
    });
  });

  describe('runWorkspaceJestCoverage', () => {
    it('returns coverage with all four metrics "unmeasured" with the evidence pointer when the spawn fails', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) =>
        spawnFailureRecord(cmd, args, evidencePath),
      );

      const result = await runWorkspaceJestCoverage({
        workspaceRoot,
        evidenceDir,
        packageName: '@veilpay/backend',
      });

      expect(result.coverage).toEqual({
        statements: UNMEASURED,
        branches: UNMEASURED,
        functions: UNMEASURED,
        lines: UNMEASURED,
      });
      expect(result.record.exitCode).toBe(-1);
      expect(result.record.evidencePath).toBe(
        path.join(evidenceDir, 'jest.veilpay__backend.txt'),
      );
    });
  });

  describe('runComplexity', () => {
    it('returns hotspots: "unmeasured" with the evidence pointer when the tool exits non-zero', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) =>
        nonZeroExitRecord(cmd, args, evidencePath, 1),
      );

      const result = await runComplexity({ workspaceRoot, evidenceDir });

      expect(result.hotspots).toBe(UNMEASURED);
      expect(result.record.exitCode).toBe(1);
      expect(result.record.evidencePath).toBe(
        path.join(evidenceDir, 'complexity.json'),
      );
    });

    it('returns hotspots: "unmeasured" when the spawn itself fails (binary missing)', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) =>
        spawnFailureRecord(cmd, args, evidencePath),
      );

      const result = await runComplexity({ workspaceRoot, evidenceDir });

      expect(result.hotspots).toBe(UNMEASURED);
      expect(result.record.exitCode).toBe(-1);
      expect(result.record.evidencePath).toBe(
        path.join(evidenceDir, 'complexity.json'),
      );
    });
  });

  describe('runDuplication', () => {
    it('returns clusters: "unmeasured" with the evidence pointer when the tool exits non-zero', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) =>
        nonZeroExitRecord(cmd, args, evidencePath, 2),
      );

      const result = await runDuplication({ workspaceRoot, evidenceDir });

      expect(result.clusters).toBe(UNMEASURED);
      expect(result.record.exitCode).toBe(2);
      expect(result.record.evidencePath).toBe(
        path.join(evidenceDir, 'jscpd.txt'),
      );
    });

    it('returns clusters: "unmeasured" when the spawn itself fails (binary missing)', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) =>
        spawnFailureRecord(cmd, args, evidencePath),
      );

      const result = await runDuplication({ workspaceRoot, evidenceDir });

      expect(result.clusters).toBe(UNMEASURED);
      expect(result.record.exitCode).toBe(-1);
    });
  });

  describe('runSecretScan (security probe)', () => {
    it('returns matches: "unmeasured" when the gitleaks binary is missing (spawn ENOENT)', async () => {
      // Tail must include "spawn error: ... ENOENT" so the soft-failure
      // detector in security.ts recognises the missing-binary case rather
      // than treating it as a genuine non-zero exit from gitleaks.
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => ({
        command: cmd,
        args,
        exitCode: -1,
        runAt: '2025-01-15T00:00:00.000Z',
        evidencePath,
        tail: ['', `spawn error: spawn ${cmd} ENOENT`, ''],
      }));

      const result = await runSecretScan({ workspaceRoot, evidenceDir });

      expect(result.matches).toBe('unmeasured');
      expect(result.record.exitCode).toBe(-1);
      expect(result.record.evidencePath).toBe(
        path.join(evidenceDir, 'gitleaks.txt'),
      );
      expect(mockedRunCommand).toHaveBeenCalledWith(
        'gitleaks',
        expect.arrayContaining(['detect', '--no-git']),
        path.join(evidenceDir, 'gitleaks.txt'),
      );
    });
  });
});
