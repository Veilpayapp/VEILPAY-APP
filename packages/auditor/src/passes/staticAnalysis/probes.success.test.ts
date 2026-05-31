import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

const mockedRunCommand = runCommand as jest.MockedFunction<typeof runCommand>;

describe('probes success handling', () => {
  let workspaceRoot: string;
  let evidenceDir: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-probes-ws-'));
    evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-probes-ev-'));
    mockedRunCommand.mockReset();
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await fs.rm(evidenceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function successRecord(cmd: string, args: readonly string[], evidencePath: string): EvidenceRecord {
    return {
      command: cmd,
      args,
      exitCode: 0,
      runAt: '2025-01-15T00:00:00.000Z',
      evidencePath,
      tail: [],
    };
  }

  describe('runPnpmAudit', () => {
    it('extracts advisories properly', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
        await fs.writeFile(evidencePath, JSON.stringify({
          advisories: {
            "123": { severity: "high", module_name: "foo", url: "http://foo" }
          }
        }));
        return successRecord(cmd, args, evidencePath);
      });

      const result = await runPnpmAudit({ workspaceRoot, evidenceDir });
      expect(Array.isArray(result.advisories)).toBe(true);
      expect(result.advisories).toHaveLength(1);
      if (Array.isArray(result.advisories)) {
        expect(result.advisories[0].module).toBe('foo');
      }
    });
  });

  describe('runWorkspaceTsc', () => {
    it('counts errors correctly', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
        await fs.writeFile(evidencePath, 'error TS123: bad\nerror TS456: worse');
        return successRecord(cmd, args, evidencePath);
      });

      const result = await runWorkspaceTsc({ workspaceRoot, evidenceDir, packageName: '@veilpay/backend' });
      expect(result.errorCount).toBe(2);
    });
  });

  describe('runWorkspaceEslint', () => {
    it('counts errors and warnings correctly', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
        await fs.writeFile(evidencePath, JSON.stringify([
          { errorCount: 1, warningCount: 2 },
          { errorCount: 0, warningCount: 1 }
        ]));
        return successRecord(cmd, args, evidencePath);
      });

      const result = await runWorkspaceEslint({ workspaceRoot, evidenceDir, packageName: '@veilpay/backend' });
      expect(result.counts).toEqual({ errors: 1, warnings: 3 });
    });

    it('returns zero when no config found', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
        await fs.writeFile(evidencePath, 'No ESLint configuration found.');
        return { ...successRecord(cmd, args, evidencePath), exitCode: 1 };
      });

      const result = await runWorkspaceEslint({ workspaceRoot, evidenceDir, packageName: '@veilpay/backend' });
      expect(result.counts).toEqual({ errors: 0, warnings: 0 });
    });
  });

  describe('runWorkspaceJestCoverage', () => {
    it('extracts coverage summary correctly', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
        // Must create package structure for resolvePackageDir
        const pkgDir = path.join(workspaceRoot, 'apps', 'backend');
        await fs.mkdir(path.join(pkgDir, 'coverage'), { recursive: true });
        await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@veilpay/backend' }));
        await fs.writeFile(path.join(pkgDir, 'coverage', 'coverage-summary.json'), JSON.stringify({
          total: {
            statements: { pct: 85.5 },
            branches: { pct: 90 },
            functions: { pct: 80 },
            lines: { pct: 82 }
          }
        }));
        await fs.writeFile(evidencePath, 'jest output');
        return successRecord(cmd, args, evidencePath);
      });

      const result = await runWorkspaceJestCoverage({ workspaceRoot, evidenceDir, packageName: '@veilpay/backend' });
      expect(result.coverage).toEqual({
        statements: 86,
        branches: 90,
        functions: 80,
        lines: 82
      });
    });
  });

  describe('runComplexity', () => {
    it('extracts flat hotspots correctly', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
        await fs.writeFile(evidencePath, JSON.stringify([
          { path: 'a.ts', function: 'foo', score: 10 }
        ]));
        return successRecord(cmd, args, evidencePath);
      });

      const result = await runComplexity({ workspaceRoot, evidenceDir });
      expect(Array.isArray(result.hotspots)).toBe(true);
      expect(result.hotspots).toHaveLength(1);
    });
  });

  describe('runDuplication', () => {
    it('extracts duplicate clusters correctly', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
        await fs.mkdir(path.join(workspaceRoot, '.audit-evidence'), { recursive: true });
        await fs.writeFile(path.join(workspaceRoot, '.audit-evidence', 'jscpd-report.json'), JSON.stringify({
          duplicates: [
            { firstFile: { name: 'a.ts' }, secondFile: { name: 'b.ts' }, lines: 15 }
          ]
        }));
        return successRecord(cmd, args, evidencePath);
      });

      const result = await runDuplication({ workspaceRoot, evidenceDir });
      expect(Array.isArray(result.clusters)).toBe(true);
      if (Array.isArray(result.clusters)) {
        expect(result.clusters).toHaveLength(1);
        expect(result.clusters[0].sharedLines).toBe(15);
      }
    });
  });
});
