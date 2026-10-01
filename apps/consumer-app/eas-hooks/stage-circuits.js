#!/usr/bin/env node
/**
 * EAS build hook: stage + digest-verify the withdraw-circuit prover assets
 * (withdraw.wasm, withdraw_final.zkey, snarkjs.min.js, snarkjs.min.umd).
 *
 * Wired as part of the `eas-build-post-install` npm lifecycle script (chained
 * after eas-hooks/build-spp-native-android.js). On Android builds EAS runs
 * that hook AFTER dependency install AND `npx expo prebuild`, immediately
 * before the Gradle/Metro bundle phase — the last moment to guarantee the
 * assets Metro statically requires are present and byte-correct.
 *
 * Why an npm lifecycle script and not an eas.json profile `hooks` key:
 * current EAS CLI (eas-cli@20, used by .github/workflows/android-build.yml)
 * has no `hooks` config in build profiles — the supported mechanism is these
 * `eas-build-*` npm scripts (this is also how inject-secrets.js and
 * build-spp-native-android.js are wired). Verified against eas-cli source:
 * packages/build-tools/src/builders/android.ts runs Hook.POST_INSTALL, and
 * `eas build --local` (local-build-plugin) delegates to the same
 * Builders.androidBuilder, so the hook runs in local builds too.
 *
 * Two modes, chosen by what the build archive actually contains:
 *
 *  1. Full checkout next to the app (packages/circuits/build/withdraw.wasm
 *     present — e.g. a dev machine, or a future archive that ships the
 *     circuits package): run the staging script in its default mode. Sources
 *     are digest-checked against the baked pins and a valid staged
 *     snarkjs.min.js is reused (the pinned CDN download only happens when the
 *     staged copy is missing or digest-invalid).
 *
 *  2. EAS build working directory (the normal case): the monorepo-root
 *     .easignore excludes packages/circuits/ from the build archive, but the
 *     app-level staging re-includes apps/consumer-app/assets/circuits/*. Re-run
 *     the staging script with --offline and --circuit-build-dir pointing at the
 *     staged directory: every archived byte is re-verified against the SHA-256
 *     pins baked in src/constants/circuit.ts (which ships in the archive), and
 *     identical bytes are rewritten (idempotent). Any tampered or missing
 *     asset fails the hook — and therefore the build. No network is used.
 *
 * The hook FAILS CLOSED: a non-zero exit from either mode fails the EAS build.
 * Set CIRCUIT_STAGE_SKIP=1 to skip (testing only).
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
const STAGE_SCRIPT = path.join(APP_ROOT, 'scripts', 'stage-circuit-assets.js');

const skip = process.env.CIRCUIT_STAGE_SKIP === '1';
if (skip) {
  console.log('[stage-circuits] CIRCUIT_STAGE_SKIP=1 — skipping');
  process.exit(0);
}

if (!fs.existsSync(STAGE_SCRIPT)) {
  console.error('[stage-circuits] missing staging script:', STAGE_SCRIPT);
  process.exit(1);
}

// Decide the mode from what the build actually sees (see header comment).
const circuitBuildWasm = path.join(APP_ROOT, '..', '..', 'packages', 'circuits', 'build', 'withdraw.wasm');
const stagedDir = path.join(APP_ROOT, 'assets', 'circuits');

const args = fs.existsSync(circuitBuildWasm)
  ? [] // full checkout: default staging mode (pin-checked copy + UMD reuse)
  : [
      // EAS archive: packages/circuits is excluded by the root .easignore;
      // re-verify the archived staged assets in place, offline.
      '--offline',
      '--circuit-build-dir',
      stagedDir,
    ];

console.log(
  fs.existsSync(circuitBuildWasm)
    ? '[stage-circuits] circuit build outputs present — staging from packages/circuits/build'
    : '[stage-circuits] packages/circuits not in build archive — re-verifying staged assets against baked pins (offline)'
);

const result = spawnSync(process.execPath, [STAGE_SCRIPT, ...args], {
  stdio: 'inherit',
  env: process.env,
  cwd: APP_ROOT,
});

if (result.error) {
  console.error('[stage-circuits] failed to spawn staging script:', result.error.message);
  process.exit(1);
}

const status = result.status === null ? 1 : result.status;
if (status !== 0) {
  console.error(
    '[stage-circuits] staging failed (exit ' +
      status +
      ') — failing the build. Metro requires withdraw.wasm / withdraw_final.zkey / snarkjs.min.umd and every byte must match the pins in src/constants/circuit.ts.'
  );
}
process.exit(status);
