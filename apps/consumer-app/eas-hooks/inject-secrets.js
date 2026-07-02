#!/usr/bin/env node
/**
 * Cross-platform entry point for Doppler secret injection.
 *
 * Runs as the EAS `eas-build-pre-install` npm lifecycle hook — EAS invokes
 * this on its cloud build servers BEFORE dependencies are installed. It does
 * NOT run during ordinary `pnpm install` on CI, the backend deploy pipeline,
 * or developer machines, so it does not require re-enabling pnpm dependency
 * lifecycle scripts monorepo-wide.
 *
 * Behavior:
 *   - If DOPPLER_TOKEN env var is set (EAS cloud build) → spawns the bash
 *     hook `install-doppler.sh` which downloads secrets into .env.
 *   - If DOPPLER_TOKEN is unset (local dev) → logs and exits 0 so the build
 *     never fails on a developer's machine.
 *
 * Why a Node wrapper instead of calling bash directly:
 *   EAS build hooks may run via the system shell. Node is guaranteed to exist
 *   wherever the build runs, so this wrapper keeps the hook cross-platform
 *   while delegating the actual Doppler work to the bash hook (which only ever
 *   runs on EAS's Linux build servers).
 */
const { spawnSync } = require('child_process');
const path = require('path');

const token = process.env.DOPPLER_TOKEN;

if (!token || token.trim() === '') {
  console.log('[doppler-hook] DOPPLER_TOKEN not set — skipping secret injection (local dev).');
  process.exit(0);
}

const hookPath = path.join(__dirname, 'install-doppler.sh');
const result = spawnSync('bash', [hookPath], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  // bash not found (e.g. somehow on Windows with DOPPLER_TOKEN set).
  // This shouldn't happen on EAS, but fail loudly rather than silently.
  console.error('[doppler-hook] Failed to execute bash hook:', result.error.message);
  console.error('[doppler-hook] bash is required for secret injection.');
  process.exit(1);
}

process.exit(result.status || 0);
