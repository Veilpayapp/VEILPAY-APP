import { walkFiles } from './walk';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('walkFiles', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'walk-test-'));
    // Setup some files and directories
    await fs.writeFile(path.join(tmpRoot, 'file1.ts'), 'content');
    await fs.writeFile(path.join(tmpRoot, 'file2.js'), 'content');
    
    await fs.mkdir(path.join(tmpRoot, 'subdir1'));
    await fs.writeFile(path.join(tmpRoot, 'subdir1', 'file3.ts'), 'content');
    
    await fs.mkdir(path.join(tmpRoot, 'node_modules'));
    await fs.writeFile(path.join(tmpRoot, 'node_modules', 'ignored.ts'), 'content');
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('should find all files except ignored ones', async () => {
    const files = await walkFiles(tmpRoot);
    expect(files.length).toBe(3);
    const relativeFiles = files.map(f => path.relative(tmpRoot, f).replace(/\\/g, '/')).sort();
    expect(relativeFiles).toEqual(['file1.ts', 'file2.js', 'subdir1/file3.ts'].sort());
  });

  it('should filter by extension', async () => {
    const files = await walkFiles(tmpRoot, { extensions: ['.ts'] });
    expect(files.length).toBe(2);
    const relativeFiles = files.map(f => path.relative(tmpRoot, f).replace(/\\/g, '/')).sort();
    expect(relativeFiles).toEqual(['file1.ts', 'subdir1/file3.ts'].sort());
  });

  it('should respect maxDepth', async () => {
    const files = await walkFiles(tmpRoot, { maxDepth: 0 });
    expect(files.length).toBe(2);
    const relativeFiles = files.map(f => path.relative(tmpRoot, f).replace(/\\/g, '/')).sort();
    expect(relativeFiles).toEqual(['file1.ts', 'file2.js'].sort());
  });

  it('should respect custom skipDirs with replaceSkipDirs', async () => {
    const files = await walkFiles(tmpRoot, { skipDirs: ['subdir1'], replaceSkipDirs: true });
    // This ignores subdir1 but includes node_modules since DEFAULT_SKIP_DIRS are replaced
    const relativeFiles = files.map(f => path.relative(tmpRoot, f).replace(/\\/g, '/')).sort();
    expect(relativeFiles).toEqual(['file1.ts', 'file2.js', 'node_modules/ignored.ts'].sort());
  });

  it('should handle non-existent directory gracefully', async () => {
    const files = await walkFiles(path.join(tmpRoot, 'non-existent'));
    expect(files).toEqual([]);
  });
});
