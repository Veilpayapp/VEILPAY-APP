import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { main } from './index';
import { CANONICAL_PLAN_PATHS } from '../passes/synthesis/plans';

// Same fixture setup as smoke.test.ts
function runGit(args: readonly string[], cwd: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn('git', [...args], { cwd, shell: false, windowsHide: true, stdio: 'ignore' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(typeof code === 'number' ? code : 1));
  });
}

async function buildFixtureWorkspace(): Promise<string> {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-in-process-'));
  await runGit(['init', '-b', 'main'], fixtureRoot);
  await runGit(['config', 'user.email', 'test@test.com'], fixtureRoot);
  await runGit(['config', 'user.name', 'test'], fixtureRoot);
  await runGit(['commit', '--allow-empty', '-m', 'init'], fixtureRoot);

  const plansDir = path.join(fixtureRoot, 'plans');
  await fs.mkdir(plansDir, { recursive: true });
  for (const planPath of CANONICAL_PLAN_PATHS) {
    const abs = path.join(fixtureRoot, ...planPath.split('/'));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, `# ${path.basename(planPath)}\n\nContent.\n`, 'utf8');
  }

  await fs.mkdir(path.join(fixtureRoot, 'apps'), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, 'packages'), { recursive: true });
  const specDir = path.join(fixtureRoot, '.kiro', 'specs', 'spec-a');
  await fs.mkdir(specDir, { recursive: true });
  await fs.writeFile(path.join(specDir, 'requirements.md'), '# Spec A\nContent.\n', 'utf8');

  return fixtureRoot;
}

describe('cli in-process run for coverage', () => {
  let fixtureRoot: string | null = null;
  beforeEach(async () => {
    jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (fixtureRoot) {
      await fs.rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('runs orchestrator in process successfully', async () => {
    fixtureRoot = await buildFixtureWorkspace();
    process.argv = ['node', 'index.ts', 'run', '--workspace-root', fixtureRoot!];
    
    await expect(main()).rejects.toThrow('process.exit(0)');

    // Verify it generated something
    const reportPath = path.join(fixtureRoot!, 'plans', 'PRODUCTION_READINESS_AUDIT.md');
    const reportStat = await fs.stat(reportPath);
    expect(reportStat.isFile()).toBe(true);
  }, 300000);
});
