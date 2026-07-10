/**
 * Smoke tests for EAS NDK post-install entry (no real cargo-ndk).
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const hookJs = path.join(__dirname, '..', 'build-spp-native-android.js');
const hookSh = path.join(__dirname, '..', 'build-spp-native-android.sh');

describe('eas-hooks/build-spp-native-android', () => {
  it('ships both js and sh hooks', () => {
    expect(fs.existsSync(hookJs)).toBe(true);
    expect(fs.existsSync(hookSh)).toBe(true);
  });

  it('SPP_NATIVE_SKIP=1 exits 0', () => {
    const r = spawnSync(process.execPath, [hookJs], {
      env: { ...process.env, SPP_NATIVE_SKIP: '1' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/skip/i);
  });

  it('EAS_BUILD_PLATFORM=ios exits 0 without NDK', () => {
    const r = spawnSync(process.execPath, [hookJs], {
      env: { ...process.env, EAS_BUILD_PLATFORM: 'ios', SPP_NATIVE_SKIP: undefined },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });

  it('package.json wires eas-build-post-install', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
    );
    expect(pkg.scripts['eas-build-post-install']).toContain(
      'build-spp-native-android'
    );
  });
});
