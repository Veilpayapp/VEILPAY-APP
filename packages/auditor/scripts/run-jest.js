#!/usr/bin/env node
/**
 * Jest launcher that ensures `--experimental-vm-modules` is enabled.
 *
 * The auditor's property test for `renderAuditReport` (`Property 1` and
 * `Property 2` in the production-readiness-audit spec) parses rendered
 * Markdown with `unified` + `remark-parse` + `unist-util-visit`. Those
 * three packages ship as pure ES modules, and Jest 29 only loads ESM
 * inside its VM when Node was started with
 * `--experimental-vm-modules`. Setting `NODE_OPTIONS` at script time is
 * too late — Node has already parsed it — so this launcher re-execs Node
 * (via `child_process.spawnSync`) with the flag prepended.
 *
 * Usage: invoked from the `test` script in `package.json`. Forwards any
 * argv past the launcher straight to Jest.
 *
 * Cross-platform: uses `path.resolve` and Node's `spawnSync` so it works
 * the same on Windows `cmd`/PowerShell and POSIX shells.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const jestBin = path.resolve(__dirname, '..', 'node_modules', 'jest', 'bin', 'jest.js');

const result = spawnSync(
  process.execPath,
  ['--experimental-vm-modules', jestBin, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

if (result.error) {
  // eslint-disable-next-line no-console
  console.error('[run-jest] failed to spawn jest:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
