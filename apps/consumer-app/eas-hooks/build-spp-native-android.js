/**
 * Cross-platform entry for spp-native Android NDK build.
 *
 * Wired as `eas-build-post-install` so jniLibs exist before Expo prebuild/Gradle.
 * Delegates to build-spp-native-android.sh on EAS Linux (bash + NDK present).
 *
 * Local Windows without NDK: no-op (use packages/spp-native/scripts/build-android-ndk.ps1).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const skip = process.env.SPP_NATIVE_SKIP === '1';
if (skip) {
  console.log('[spp-native-ndk] SPP_NATIVE_SKIP=1 — skipping');
  process.exit(0);
}

const platform = process.env.EAS_BUILD_PLATFORM || '';
// On EAS iOS, skip. When unset (local npm), the shell script no-ops unless NDK is set.
if (platform && platform !== 'android') {
  console.log(`[spp-native-ndk] platform=${platform} — skip Android NDK`);
  process.exit(0);
}

const hookPath = path.join(__dirname, 'build-spp-native-android.sh');
if (!fs.existsSync(hookPath)) {
  console.error('[spp-native-ndk] missing', hookPath);
  process.exit(1);
}

function resolveBash() {
  if (process.platform !== 'win32') return 'bash';
  const candidates = [
    process.env.BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'bash',
  ].filter(Boolean);
  for (const bin of candidates) {
    const probe = spawnSync(bin, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return bin;
  }
  return null;
}

const bash = resolveBash();
if (!bash) {
  if (process.env.EAS_BUILD === 'true') {
    console.error('[spp-native-ndk] bash required on EAS');
    process.exit(1);
  }
  console.log(
    '[spp-native-ndk] bash unavailable — skip. For local .so: packages/spp-native/scripts/build-android-ndk.ps1',
  );
  process.exit(0);
}

const result = spawnSync(bash, [hookPath], {
  stdio: 'inherit',
  env: process.env,
  cwd: path.join(__dirname, '..'),
});

if (result.error) {
  if (process.env.EAS_BUILD === 'true') {
    console.error('[spp-native-ndk] failed to spawn bash:', result.error.message);
    process.exit(1);
  }
  console.log('[spp-native-ndk] bash spawn failed — skip');
  process.exit(0);
}

process.exit(result.status === null ? 1 : result.status);
