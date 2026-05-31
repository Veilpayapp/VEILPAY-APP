import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveStrictCoverage } from './strictMode';

describe('strictMode resolver', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-strict-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('handles empty targets gracefully', async () => {
    const res = await resolveStrictCoverage({ workspaceRoot: tmpDir, targets: [] });
    expect(res).toEqual({});
  });

  it('reports 100 coverage when there are no source files', async () => {
    const targetDir = path.join(tmpDir, 'empty');
    await fs.mkdir(targetDir, { recursive: true });
    
    const res = await resolveStrictCoverage({
      workspaceRoot: tmpDir,
      targets: [{ name: 'empty', path: 'empty' }],
    });
    
    expect(res).toEqual({ empty: 100 });
  });

  it('reports 0 coverage when there is a file but no tsconfig', async () => {
    const targetDir = path.join(tmpDir, 'no-tsconfig');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'index.ts'), 'console.log("hello");', 'utf8');

    const res = await resolveStrictCoverage({
      workspaceRoot: tmpDir,
      targets: [{ name: 'no-tsconfig', path: 'no-tsconfig' }],
    });
    
    expect(res).toEqual({ 'no-tsconfig': 0 });
  });

  it('resolves strict true correctly from tsconfig', async () => {
    const targetDir = path.join(tmpDir, 'strict-app');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'index.ts'), 'console.log("hello");', 'utf8');
    await fs.writeFile(path.join(targetDir, 'tsconfig.json'), '{\n  "compilerOptions": {\n    "strict": true\n  }\n}', 'utf8');

    const res = await resolveStrictCoverage({
      workspaceRoot: tmpDir,
      targets: [{ name: 'strict-app', path: 'strict-app' }],
    });
    
    expect(res).toEqual({ 'strict-app': 100 });
  });

  it('resolves strict false correctly from tsconfig', async () => {
    const targetDir = path.join(tmpDir, 'loose-app');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'index.ts'), 'console.log("hello");', 'utf8');
    await fs.writeFile(path.join(targetDir, 'tsconfig.json'), '{\n  "compilerOptions": {\n    "strict": false\n  }\n}', 'utf8');

    const res = await resolveStrictCoverage({
      workspaceRoot: tmpDir,
      targets: [{ name: 'loose-app', path: 'loose-app' }],
    });
    
    expect(res).toEqual({ 'loose-app': 0 });
  });

  it('resolves strictness from extends chain', async () => {
    const targetDir = path.join(tmpDir, 'extends-app');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'base.json'), '{\n  "compilerOptions": {\n    "strict": true\n  }\n}', 'utf8');
    await fs.writeFile(path.join(targetDir, 'index.ts'), 'console.log("hello");', 'utf8');
    // Using comments and trailing commas to test JSONC parsing
    await fs.writeFile(path.join(targetDir, 'tsconfig.json'), '{\n  "extends": "../base.json",\n  // A comment\n  "compilerOptions": {\n    "noImplicitAny": true,\n  }\n}', 'utf8');

    const res = await resolveStrictCoverage({
      workspaceRoot: tmpDir,
      targets: [{ name: 'extends-app', path: 'extends-app' }],
    });
    
    expect(res).toEqual({ 'extends-app': 100 });
  });

  it('resolves strictness when subflags are all true', async () => {
    const targetDir = path.join(tmpDir, 'subflags-app');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'index.ts'), 'console.log("hello");', 'utf8');
    
    const tsconfig = {
      compilerOptions: {
        strictNullChecks: true,
        noImplicitAny: true,
        strictFunctionTypes: true,
        strictBindCallApply: true,
        strictPropertyInitialization: true,
        alwaysStrict: true,
        useUnknownInCatchVariables: true,
      }
    };
    await fs.writeFile(path.join(targetDir, 'tsconfig.json'), JSON.stringify(tsconfig), 'utf8');

    const res = await resolveStrictCoverage({
      workspaceRoot: tmpDir,
      targets: [{ name: 'subflags-app', path: 'subflags-app' }],
    });
    
    expect(res).toEqual({ 'subflags-app': 100 });
  });

  it('ignores skip dirs and exclude dirs', async () => {
    const targetDir = path.join(tmpDir, 'skip-app');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'tsconfig.json'), JSON.stringify({ exclude: ["ignored"] }), 'utf8');

    await fs.mkdir(path.join(targetDir, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(targetDir, 'node_modules', 'pkg', 'index.ts'), 'bad', 'utf8');

    await fs.mkdir(path.join(targetDir, 'ignored'), { recursive: true });
    await fs.writeFile(path.join(targetDir, 'ignored', 'index.ts'), 'bad', 'utf8');

    await fs.writeFile(path.join(targetDir, 'index.ts'), 'good', 'utf8');

    const res = await resolveStrictCoverage({
      workspaceRoot: tmpDir,
      targets: [{ name: 'skip-app', path: 'skip-app' }],
    });
    
    expect(res).toEqual({ 'skip-app': 0 }); // index.ts is 0 because strict isn't explicitly true
  });
});
