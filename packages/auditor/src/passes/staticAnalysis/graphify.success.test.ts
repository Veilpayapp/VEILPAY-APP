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
import { runGraphify, OBSERVATION_NOT_PRESENT } from './graphify';

const mockedRunCommand = runCommand as jest.MockedFunction<typeof runCommand>;

describe('graphify success', () => {
  let workspaceRoot: string;
  let evidenceDir: string;
  let graphifyOutDir: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-graphify-ws-'));
    evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-graphify-ev-'));
    graphifyOutDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-graphify-out-'));
    mockedRunCommand.mockReset();
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await fs.rm(evidenceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await fs.rm(graphifyOutDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('runs successfully, verifies artifacts, and parses observations', async () => {
    mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
      // Simulate creating the required artifacts
      await fs.writeFile(path.join(graphifyOutDir, 'GRAPH_REPORT.md'), `
# Graph Report
## Observations
- Ob1
- Ob2
- Ob3
      `.trim());
      await fs.writeFile(path.join(graphifyOutDir, 'graph.json'), '{}');
      await fs.writeFile(path.join(graphifyOutDir, 'manifest.json'), '{}');
      
      const wikiDir = path.join(graphifyOutDir, 'wiki');
      await fs.mkdir(wikiDir, { recursive: true });
      await fs.writeFile(path.join(wikiDir, 'index.md'), '# Wiki');

      return {
        command: cmd, args, exitCode: 0, runAt: '2025-01-15T00:00:00.000Z', evidencePath, tail: []
      };
    });

    const summary = await runGraphify({ workspaceRoot, graphifyOutDir, evidenceDir });
    expect(summary.failure_capture).toBeNull();
    expect(summary.top_observations).toEqual(['Ob1', 'Ob2', 'Ob3']);
  });

  it('falls back to --update if wiki is stale or missing', async () => {
    // Write stale wiki before the run
    const wikiDir = path.join(graphifyOutDir, 'wiki');
    await fs.mkdir(wikiDir, { recursive: true });
    await fs.writeFile(path.join(wikiDir, 'index.md'), '# Old Wiki');
    // Set old mtime
    const oldTime = new Date('2020-01-01');
    await fs.utimes(path.join(wikiDir, 'index.md'), oldTime, oldTime);

    mockedRunCommand.mockImplementation(async (cmd, args, evidencePath) => {
      await fs.writeFile(path.join(graphifyOutDir, 'GRAPH_REPORT.md'), `
# Graph Report
Some text
      `.trim());
      await fs.writeFile(path.join(graphifyOutDir, 'graph.json'), '{}');
      await fs.writeFile(path.join(graphifyOutDir, 'manifest.json'), '{}');
      
      // Only update wiki if it's the update command!
      if (args[0] === '--update') {
        await fs.utimes(path.join(wikiDir, 'index.md'), new Date(), new Date());
      }

      return {
        command: cmd, args, exitCode: 0, runAt: '2025-01-15T00:00:00.000Z', evidencePath, tail: []
      };
    });

    const summary = await runGraphify({ workspaceRoot, graphifyOutDir, evidenceDir });
    expect(summary.failure_capture).toBeNull();
    expect(summary.top_observations[0]).toBe('Some text');
    expect(summary.top_observations[1]).toBe(OBSERVATION_NOT_PRESENT);
    // Should have called --update
    expect(mockedRunCommand).toHaveBeenCalledWith(
      'graphify',
      ['--update'],
      expect.any(String),
      expect.any(Object)
    );
  });
});
