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

import { runCommand } from './runner';
import { runSecretScan, runBackendLogScan, runRpcExposureScan } from './security';

const mockedRunCommand = runCommand as jest.MockedFunction<typeof runCommand>;

describe('security probes success', () => {
  let workspaceRoot: string;
  let evidenceDir: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-security-ws-'));
    evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-security-ev-'));
    mockedRunCommand.mockReset();
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await fs.rm(evidenceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  describe('runSecretScan', () => {
    it('finds secrets using regex and parses gitleaks json', async () => {
      mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
        const reportPath = path.join(evidenceDir, 'gitleaks.json');
        await fs.writeFile(reportPath, JSON.stringify([
          { File: "app.ts", StartLine: 1, Line: "secret" }
        ]));
        return {
          command: cmd, args, exitCode: 0, runAt: '2025-01-15T00:00:00.000Z', evidencePath, tail: []
        };
      });

      await fs.writeFile(path.join(workspaceRoot, 'secret.ts'), `
        const a = "BEGIN PRIVATE KEY";
        const b = "mnemonic"; // mnemonic
        const JWT_SECRET = "foo";
        const AWS = "AKIA1234567890123456";
        const aws_secret = "1234567890123456789012345678901234567890";
        const hex = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
      `);

      const result = await runSecretScan({ workspaceRoot, evidenceDir });
      expect(result.matches).not.toBe('unmeasured');
      const matches = result.matches as any[];
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.kind === 'gitleaks')).toBe(true);
      expect(matches.some(m => m.kind === 'private-key')).toBe(true);
      expect(matches.some(m => m.kind === 'jwt-secret')).toBe(true);
      expect(matches.some(m => m.kind === 'aws-key')).toBe(true);
      expect(matches.some(m => m.kind === 'hex64')).toBe(true);
    });
  });

  describe('runBackendLogScan', () => {
    it('flags logging statements', async () => {
      const srcDir = path.join(workspaceRoot, 'apps', 'backend', 'src');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(path.join(srcDir, 'logger.ts'), `
        console.log(token);
        logger.info(req.body);
        pino(Authorization);
      `);

      const matches = await runBackendLogScan({ workspaceRoot });
      expect(matches.some(m => m.reason === 'token-shaped')).toBe(true);
      expect(matches.some(m => m.reason === 'request-body')).toBe(true);
      expect(matches.some(m => m.reason === 'authorization')).toBe(true);
    });
  });

  describe('runRpcExposureScan', () => {
    it('flags RPC literals in consumer apps', async () => {
      const srcDir = path.join(workspaceRoot, 'apps', 'consumer-app', 'src');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(path.join(srcDir, 'client.ts'), `
        const url = process.env.RPC_URL;
        const url2 = INFURA;
      `);

      const matches = await runRpcExposureScan({ workspaceRoot });
      expect(matches.some(m => m.literal === 'RPC_URL')).toBe(true);
      expect(matches.some(m => m.literal === 'INFURA')).toBe(true);
    });
  });
});
