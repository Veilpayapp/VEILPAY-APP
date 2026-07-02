import { parseArgs, main } from './index';

describe('cli/index.ts', () => {
  beforeEach(() => {
    jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parseArgs works with help command', () => {
    const args = parseArgs(['--help']);
    expect(args.command).toBe('help');
  });

  it('parseArgs defaults auditor to automated', () => {
    const args = parseArgs(['run', '--workspace-root', 'foo']);
    expect(args.auditor).toBe('automated');
    expect(args.workspaceRoot).toMatch(/foo$/);
  });

  it('parseArgs validates workspace-root', () => {
    expect(() => parseArgs(['--workspace-root'])).toThrow(/requires a path argument/);
  });

  it('main handles help command', async () => {
    process.argv = ['node', 'index.ts', '--help'];
    await expect(main()).rejects.toThrow('process.exit(0)');
  });

  it('main handles missing args by exiting 1', async () => {
    process.argv = ['node', 'index.ts', 'invalid-arg']; // invalid arg
    await expect(main()).rejects.toThrow('process.exit(1)');
  });
});
