/**
 * Unit tests for the evidence-capture harness (`runCommand`).
 *
 * These tests inject a per-test temp directory via `os.tmpdir()` so they
 * never touch `d:\Veilpay\plans\.audit-evidence\`. They exercise:
 *
 *   1. A trivial successful command writes evidence and returns exitCode 0
 *      with an empty tail.
 *   2. A failing command captures up to 50 lines of combined output in the
 *      `tail` field (Requirement 3.6 / Property 14) and exitCode !== 0.
 *   3. The persisted evidence file path equals the requested path.
 *   4. Non-existent commands resolve cleanly (no throw) and surface a
 *      non-zero exit so callers can branch on it.
 *
 * Tests use `node -e "..."` because Node ships with the toolchain and is
 * available on every environment that runs the auditor.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MAX_TAIL_LINES, runCommand } from './runner';

const NODE_BIN = process.execPath;

async function makeTempDir(): Promise<string> {
  const prefix = path.join(os.tmpdir(), 'auditor-runner-');
  return fs.mkdtemp(prefix);
}

async function cleanupTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe('runCommand', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('captures stdout and returns exitCode 0 for a trivial command', async () => {
    const evidencePath = path.join(tempDir, 'success.txt');
    const record = await runCommand(
      NODE_BIN,
      ['-e', "process.stdout.write('ok\\n')"],
      evidencePath,
    );

    expect(record.exitCode).toBe(0);
    expect(record.command).toBe(NODE_BIN);
    expect(record.args).toEqual(['-e', "process.stdout.write('ok\\n')"]);
    expect(record.evidencePath).toBe(evidencePath);
    expect(record.tail).toEqual([]);
    expect(record.runAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    const written = await fs.readFile(evidencePath, 'utf8');
    expect(written).toContain('ok');
  });

  it('writes evidence to the requested path (and creates parent dirs)', async () => {
    const evidencePath = path.join(tempDir, 'nested', 'deep', 'evidence.txt');
    const record = await runCommand(
      NODE_BIN,
      ['-e', "process.stdout.write('hello world')"],
      evidencePath,
    );

    expect(record.evidencePath).toBe(evidencePath);
    await expect(fs.access(evidencePath)).resolves.toBeUndefined();
    const written = await fs.readFile(evidencePath, 'utf8');
    expect(written).toBe('hello world');

    // The temp file used for atomic rename must not linger.
    await expect(fs.access(`${evidencePath}.tmp`)).rejects.toThrow();
  });

  it('captures up to 50 lines of combined output on non-zero exit', async () => {
    const evidencePath = path.join(tempDir, 'failure.txt');
    // Emit 120 stderr lines, then exit with code 1. The tail must be
    // exactly the trailing 50 lines and must not be padded.
    const script =
      "for (let i = 1; i <= 120; i++) console.error('line ' + i); process.exit(1);";

    const record = await runCommand(NODE_BIN, ['-e', script], evidencePath);

    expect(record.exitCode).toBe(1);
    expect(record.tail.length).toBe(MAX_TAIL_LINES);
    expect(record.tail.length).toBe(50);
    expect(record.tail[0]).toBe('line 71');
    expect(record.tail[record.tail.length - 1]).toBe('line 120');

    const written = await fs.readFile(evidencePath, 'utf8');
    expect(written).toContain('line 1');
    expect(written).toContain('line 120');
  });

  it('returns the full output as tail when fewer than 50 lines exist on failure', async () => {
    const evidencePath = path.join(tempDir, 'short-failure.txt');
    const script =
      "console.error('boom-1'); console.error('boom-2'); process.exit(2);";

    const record = await runCommand(NODE_BIN, ['-e', script], evidencePath);

    expect(record.exitCode).toBe(2);
    expect(record.tail).toEqual(['boom-1', 'boom-2']);
  });

  it('does not throw and reports a non-zero exit when the command is missing', async () => {
    const evidencePath = path.join(tempDir, 'missing.txt');
    const record = await runCommand(
      'definitely-not-a-real-binary-xyz',
      ['--version'],
      evidencePath,
    );

    expect(record.exitCode).not.toBe(0);
    // Evidence file is still written so the audit can reference it.
    const written = await fs.readFile(evidencePath, 'utf8');
    expect(written.length).toBeGreaterThan(0);
    expect(record.tail.length).toBeGreaterThan(0);
  });

  it('writes the evidence file atomically (no .tmp leftover on success)', async () => {
    const evidencePath = path.join(tempDir, 'atomic.txt');
    await runCommand(
      NODE_BIN,
      ['-e', "process.stdout.write('atomic')"],
      evidencePath,
    );

    await expect(fs.access(evidencePath)).resolves.toBeUndefined();
    await expect(fs.access(`${evidencePath}.tmp`)).rejects.toThrow();
  });
});
