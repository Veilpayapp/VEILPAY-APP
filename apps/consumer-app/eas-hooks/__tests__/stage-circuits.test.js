/**
 * Smoke tests for the EAS circuit-staging post-install entry.
 * No real staging runs here (see scripts/stage-circuit-assets.js for the
 * staging behavior itself); these guard wiring + fail-closed skip behavior.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const hookJs = path.join(__dirname, '..', 'stage-circuits.js');
const pkgPath = path.join(__dirname, '..', '..', 'package.json');
const easJsonPath = path.join(__dirname, '..', '..', 'eas.json');
const workflowPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'android-build.yml'
);

describe('eas-hooks/stage-circuits', () => {
  it('ships the hook', () => {
    expect(fs.existsSync(hookJs)).toBe(true);
  });

  it('CIRCUIT_STAGE_SKIP=1 exits 0', () => {
    const r = spawnSync(process.execPath, [hookJs], {
      env: { ...process.env, CIRCUIT_STAGE_SKIP: '1' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/skip/i);
  });

  it('package.json wires stage-circuits into eas-build-post-install', () => {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.scripts['eas-build-post-install']).toContain('build-spp-native-android');
    expect(pkg.scripts['eas-build-post-install']).toContain('stage-circuits');
  });

  it('android-build.yml stages circuits before the eas build step', () => {
    const yml = fs.readFileSync(workflowPath, 'utf8');
    const stageIdx = yml.indexOf('name: Stage circuit assets');
    const buildIdx = yml.indexOf('Build Android APK (EAS local)');
    expect(stageIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    // The staging step must run BEFORE the EAS local build consumes the archive.
    expect(stageIdx).toBeLessThan(buildIdx);
    expect(yml).toContain('node scripts/stage-circuit-assets.js');
  });

  it('eas.json no longer claims the (live) EAS build config is deprecated', () => {
    const easJson = JSON.parse(fs.readFileSync(easJsonPath, 'utf8'));
    const comment = easJson['$comment'] || '';
    // The exact stale marker that wrongly retired the live EAS-local pipeline.
    expect(comment).not.toMatch(/DEPRECATED:\s*EAS\/OTA is discontinued/i);
    expect(comment).not.toMatch(/must not be used for new builds/i);
    // The live Android pipeline is EAS-local builds from CI; OTA was retired.
    expect(comment).toMatch(/android-build\.yml/);
    expect(comment).toMatch(/stage-circuits/);
  });
});
