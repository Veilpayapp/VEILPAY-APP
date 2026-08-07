#!/usr/bin/env node
/**
 * Cross-platform entry point for Doppler secret injection and workspace setup.
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
 *   - If DOPPLER_TOKEN is unset (local dev) → installs full workspace with
 *     pnpm to resolve all dependencies.
 *
 * Why a Node wrapper instead of calling bash directly:
 *   EAS build hooks may run via the system shell. Node is guaranteed to exist
 *   wherever the build runs, so this wrapper keeps the hook cross-platform
 *   while delegating the actual Doppler work to the bash hook (which only ever
 *   runs on EAS's Linux build servers).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const token = process.env.DOPPLER_TOKEN;

if (!token || token.trim() === '') {
  console.log('[doppler-hook] DOPPLER_TOKEN not set — local build detected.');
  console.log('[pnpm-hook] Installing workspace dependencies with pnpm...');
  
  // For local builds, install the full workspace with pnpm
  // The build runs in a temp directory with the project archived
  const buildDir = path.join(__dirname, '../../..');
  const pnpmWorkspaceYaml = path.join(buildDir, 'pnpm-workspace.yaml');
  const appDir = path.join(__dirname, '..');
  
  if (fs.existsSync(pnpmWorkspaceYaml)) {
    console.log('[pnpm-hook] Found pnpm-workspace.yaml, installing workspace...');
    const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
      stdio: 'inherit',
      cwd: buildDir,
      env: process.env,
    });
    
    if (result.error) {
      console.error('[pnpm-hook] Failed to run pnpm install:', result.error.message);
      process.exit(1);
    }
    
    if (result.status !== 0) {
      console.error('[pnpm-hook] pnpm install failed with status:', result.status);
      process.exit(result.status);
    }
    
    // Create a marker file to tell EAS to skip npm ci
    // EAS checks for node_modules before running npm ci, so we symlink
    // the workspace node_modules to the app directory
    const workspaceNodeModules = path.join(buildDir, 'node_modules');
    const appNodeModules = path.join(appDir, 'node_modules');
    
    if (fs.existsSync(workspaceNodeModules) && !fs.existsSync(appNodeModules)) {
      try {
        // On Windows, use mkdirSync and copy-on-write. On Linux, symlink.
        if (process.platform === 'win32') {
          fs.cpSync(workspaceNodeModules, appNodeModules, { recursive: true });
          console.log('[pnpm-hook] Copied workspace node_modules to app directory.');
        } else {
          fs.symlinkSync(workspaceNodeModules, appNodeModules, 'dir');
          console.log('[pnpm-hook] Symlinked workspace node_modules to app directory.');
        }
      } catch (err) {
        console.warn('[pnpm-hook] Could not link node_modules:', err.message);
        console.log('[pnpm-hook] EAS may still try to run npm ci, but dependencies should be available.');
      }
    }
  } else {
    console.log('[pnpm-hook] pnpm-workspace.yaml not found, skipping workspace install.');
  }
  
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
