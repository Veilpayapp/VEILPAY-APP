/**
 * Tests for scripts/supply-circuit-assets.js — the pinned-source supply
 * path for the circuit prover binaries.
 *
 * NO NETWORK: URL-source tests inject a fake fetchImpl; local-dir tests
 * use real temp directories (filesystem only); CLI (subprocess) tests use
 * local directory sources only. The happy-path CLI test uses the real
 * staged bytes when present and self-skips on a fresh checkout.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const supply = require('../supply-circuit-assets.js');

const SCRIPT = path.join(__dirname, '..', 'supply-circuit-assets.js');
const PKG_PATH = path.join(__dirname, '..', '..', 'package.json');
const WORKFLOW_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'android-build.yml'
);
const SUPPLY_DOC = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'reference',
  'circuit-asset-supply.md'
);
const STAGED_DIR = path.join(__dirname, '..', '..', 'assets', 'circuits');

function sha256(b) {
  return crypto.createHash('sha256').update(b).digest('hex');
}

/** Deterministic fake artifacts + matching fake pins (in-process only). */
function fixtures() {
  const wasm = Buffer.alloc(1024, 0x11);
  const zkey = Buffer.alloc(2048, 0x22);
  const umd = Buffer.alloc(512, 0x33);
  return {
    wasm,
    zkey,
    umd,
    pins: {
      wasm: sha256(wasm),
      zkey: sha256(zkey),
      umd: sha256(umd),
      sri: 'sha384-AA',
    },
  };
}

/** fetch mock: map of url -> {bytes} (200) | {error} (throws) | undefined (404). */
function makeFakeFetch(map) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const hit = map[String(url)];
    if (!hit) {
      return { ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) };
    }
    if (hit.error) {
      throw new Error(hit.error);
    }
    return { ok: true, status: 200, arrayBuffer: async () => hit.bytes };
  };
  return { fetchImpl, calls };
}

/** spawnSync mock that records invocations and succeeds. */
function makeFakeSpawn() {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: 0, error: null };
  };
  return { spawnImpl, calls };
}

function tmpOut() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'supply-out-'));
}
function tmpSrc() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'supply-src-'));
}

/** Snapshot of a directory: name -> digest (proves "nothing staged"). */
function dirSnapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile()) {
      out[e.name] = sha256(fs.readFileSync(path.join(dir, e.name)));
    }
  }
  return out;
}

/** Real pinned artifacts present on this checkout (absent on fresh CI). */
function realStagedBytes() {
  try {
    return {
      wasm: fs.readFileSync(path.join(STAGED_DIR, 'withdraw.wasm')),
      zkey: fs.readFileSync(path.join(STAGED_DIR, 'withdraw_final.zkey')),
      umd: fs.readFileSync(path.join(STAGED_DIR, 'snarkjs.min.js')),
    };
  } catch (e) {
    return null;
  }
}

describe('supply-circuit-assets (parseSource)', () => {
  it('parses an https base URL and strips trailing slashes', () => {
    const spec = supply.parseSource('https://github.com/o/r/releases/download/circuits-v1/');
    expect(spec.kind).toBe('url');
    expect(spec.base).toBe('https://github.com/o/r/releases/download/circuits-v1');
  });

  it('parses a plain local directory path', () => {
    const spec = supply.parseSource('some/relative/dir');
    expect(spec.kind).toBe('local');
    expect(spec.dir).toBe(path.resolve('some/relative/dir'));
  });

  it('parses a file:// directory URL (windows drive and posix forms)', () => {
    expect(supply.parseSource('file:///D:/tmp/supply').dir).toBe(path.resolve('D:/tmp/supply'));
    expect(supply.parseSource('file:///tmp/supply').dir).toBe(path.resolve('/tmp/supply'));
    expect(supply.parseSource('file:///tmp/supply').kind).toBe('local');
  });

  it('returns null for empty/whitespace/unset values', () => {
    expect(supply.parseSource('')).toBeNull();
    expect(supply.parseSource('   ')).toBeNull();
    expect(supply.parseSource(undefined)).toBeNull();
    expect(supply.parseSource(null)).toBeNull();
  });
});

describe('supply-circuit-assets (in-process, mocked fetch — no network)', () => {
  const BASE = 'https://release.example/circuits';

  let savedEnv;
  beforeEach(() => {
    savedEnv = process.env[supply.ENV_VAR];
    delete process.env[supply.ENV_VAR];
  });
  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[supply.ENV_VAR];
    } else {
      process.env[supply.ENV_VAR] = savedEnv;
    }
  });

  function urlMap(fx, overrides = {}) {
    return {
      [`${BASE}/withdraw.wasm`]: { bytes: fx.wasm },
      [`${BASE}/withdraw_final.zkey`]: { bytes: fx.zkey },
      [`${BASE}/snarkjs.min.js`]: { bytes: fx.umd },
      ...overrides,
    };
  }

  it('happy path (URL source): verifies pins, stages the UMD, hands off to staging, cleans the temp dir', async () => {
    const fx = fixtures();
    const { fetchImpl, calls } = makeFakeFetch(urlMap(fx));
    const { spawnImpl, calls: spawns } = makeFakeSpawn();
    const outDir = tmpOut();

    const r = await supply.main({
      source: BASE,
      fetchImpl,
      spawnImpl,
      pins: fx.pins,
      outDir,
      stageScript: 'STAGE.js',
    });

    expect(r.ok).toBe(true);
    // all three artifacts fetched from the base URL
    expect(calls).toEqual(
      expect.arrayContaining([
        `${BASE}/withdraw.wasm`,
        `${BASE}/withdraw_final.zkey`,
        `${BASE}/snarkjs.min.js`,
      ])
    );
    // staging hand-off: stage script + --circuit-build-dir <supply dir> + --offline
    expect(spawns).toHaveLength(1);
    expect(spawns[0].args[0]).toBe('STAGE.js');
    expect(spawns[0].args).toContain('--offline');
    const supplyDir = spawns[0].args[spawns[0].args.indexOf('--circuit-build-dir') + 1];
    expect(supplyDir).toBeTruthy();
    // temp supply dir is cleaned up after the (synchronous) hand-off
    expect(fs.existsSync(supplyDir)).toBe(false);
    // the verified UMD is staged for the staging script to reuse
    expect(sha256(fs.readFileSync(path.join(outDir, 'snarkjs.min.js')))).toBe(fx.pins.umd);
  });

  it('tamper (URL source): a mismatched digest exits with an error, stages NOTHING, never hands off', async () => {
    const fx = fixtures();
    const tampered = Buffer.from(fx.zkey);
    tampered[0] ^= 0xff;
    const { fetchImpl } = makeFakeFetch(
      urlMap(fx, { [`${BASE}/withdraw_final.zkey`]: { bytes: tampered } })
    );
    const { spawnImpl, calls: spawns } = makeFakeSpawn();
    const outDir = tmpOut();

    await expect(
      supply.main({ source: BASE, fetchImpl, spawnImpl, pins: fx.pins, outDir, stageScript: 'STAGE.js' })
    ).rejects.toThrow(/withdraw_final\.zkey digest mismatch/);

    // fail-closed: nothing staged, no staging hand-off
    expect(fs.existsSync(path.join(outDir, 'snarkjs.min.js'))).toBe(false);
    expect(spawns).toHaveLength(0);
  });

  it('URL source 404 on every alias: error, nothing staged, no hand-off', async () => {
    const fx = fixtures();
    const { fetchImpl } = makeFakeFetch({}); // everything 404s
    const { spawnImpl, calls: spawns } = makeFakeSpawn();
    const outDir = tmpOut();

    await expect(
      supply.main({ source: BASE, fetchImpl, spawnImpl, pins: fx.pins, outDir, stageScript: 'STAGE.js' })
    ).rejects.toThrow(/HTTP 404/);
    expect(fs.existsSync(path.join(outDir, 'snarkjs.min.js'))).toBe(false);
    expect(spawns).toHaveLength(0);
  });

  it('accepts the snarkjs.min.umd alias when snarkjs.min.js is not served', async () => {
    const fx = fixtures();
    const { fetchImpl, calls } = makeFakeFetch({
      [`${BASE}/withdraw.wasm`]: { bytes: fx.wasm },
      [`${BASE}/withdraw_final.zkey`]: { bytes: fx.zkey },
      [`${BASE}/snarkjs.min.umd`]: { bytes: fx.umd }, // only the alias exists
    });
    const { spawnImpl, calls: spawns } = makeFakeSpawn();
    const outDir = tmpOut();

    const r = await supply.main({
      source: BASE,
      fetchImpl,
      spawnImpl,
      pins: fx.pins,
      outDir,
      stageScript: 'STAGE.js',
    });
    expect(r.ok).toBe(true);
    expect(calls).toContain(`${BASE}/snarkjs.min.js`); // primary name tried first
    expect(calls).toContain(`${BASE}/snarkjs.min.umd`); // alias accepted
  });

  it('fetch rejection (network error): error, nothing staged, no hand-off', async () => {
    const fx = fixtures();
    const { fetchImpl } = makeFakeFetch({
      [`${BASE}/withdraw.wasm`]: { error: 'ECONNREFUSED simulated' },
    });
    const { spawnImpl, calls: spawns } = makeFakeSpawn();
    const outDir = tmpOut();

    await expect(
      supply.main({ source: BASE, fetchImpl, spawnImpl, pins: fx.pins, outDir, stageScript: 'STAGE.js' })
    ).rejects.toThrow(/fetch failed .*ECONNREFUSED/);
    expect(fs.existsSync(path.join(outDir, 'snarkjs.min.js'))).toBe(false);
    expect(spawns).toHaveLength(0);
  });

  it('missing source (env unset, no --source): error, nothing staged', async () => {
    const fx = fixtures();
    const { fetchImpl } = makeFakeFetch(urlMap(fx));
    const { spawnImpl, calls: spawns } = makeFakeSpawn();
    const outDir = tmpOut();

    await expect(
      supply.main({ fetchImpl, spawnImpl, pins: fx.pins, outDir, stageScript: 'STAGE.js' })
    ).rejects.toThrow(new RegExp(supply.ENV_VAR));
    expect(spawns).toHaveLength(0);
    expect(fs.existsSync(path.join(outDir, 'snarkjs.min.js'))).toBe(false);
  });

  it('local-path source: verifies pins in place, hands off with --circuit-build-dir = source dir, uses NO fetch', async () => {
    const fx = fixtures();
    const dir = tmpSrc();
    fs.writeFileSync(path.join(dir, 'withdraw.wasm'), fx.wasm);
    fs.writeFileSync(path.join(dir, 'withdraw_final.zkey'), fx.zkey);
    fs.writeFileSync(path.join(dir, 'snarkjs.min.js'), fx.umd);
    const noNetworkFetch = async () => {
      throw new Error('NETWORK MUST NOT BE USED IN LOCAL SOURCE MODE');
    };
    const { spawnImpl, calls: spawns } = makeFakeSpawn();
    const outDir = tmpOut();

    const r = await supply.main({
      source: dir,
      fetchImpl: noNetworkFetch,
      spawnImpl,
      pins: fx.pins,
      outDir,
      stageScript: 'STAGE.js',
    });

    expect(r.ok).toBe(true);
    expect(spawns).toHaveLength(1);
    const supplyDir = spawns[0].args[spawns[0].args.indexOf('--circuit-build-dir') + 1];
    expect(supplyDir).toBe(path.resolve(dir));
    expect(sha256(fs.readFileSync(path.join(outDir, 'snarkjs.min.js')))).toBe(fx.pins.umd);
  });

  it('local-path source accepts snarkjs.min.umd as the UMD alias', async () => {
    const fx = fixtures();
    const dir = tmpSrc();
    fs.writeFileSync(path.join(dir, 'withdraw.wasm'), fx.wasm);
    fs.writeFileSync(path.join(dir, 'withdraw_final.zkey'), fx.zkey);
    fs.writeFileSync(path.join(dir, 'snarkjs.min.umd'), fx.umd); // alias only
    const { spawnImpl } = makeFakeSpawn();

    const r = await supply.main({
      source: dir,
      fetchImpl: async () => {
        throw new Error('NETWORK MUST NOT BE USED');
      },
      spawnImpl,
      pins: fx.pins,
      outDir: tmpOut(),
      stageScript: 'STAGE.js',
    });
    expect(r.ok).toBe(true);
  });

  it('local-path source missing an artifact: error, nothing staged, no hand-off', async () => {
    const fx = fixtures();
    const dir = tmpSrc();
    fs.writeFileSync(path.join(dir, 'withdraw.wasm'), fx.wasm);
    // withdraw_final.zkey intentionally absent
    fs.writeFileSync(path.join(dir, 'snarkjs.min.js'), fx.umd);
    const { spawnImpl, calls: spawns } = makeFakeSpawn();
    const outDir = tmpOut();

    await expect(
      supply.main({ source: dir, spawnImpl, pins: fx.pins, outDir, stageScript: 'STAGE.js' })
    ).rejects.toThrow(/missing withdraw_final\.zkey/);
    expect(fs.existsSync(path.join(outDir, 'snarkjs.min.js'))).toBe(false);
    expect(spawns).toHaveLength(0);
  });

  it('local-path source with tampered bytes: digest mismatch, nothing staged, no hand-off', async () => {
    const fx = fixtures();
    const dir = tmpSrc();
    const tampered = Buffer.from(fx.wasm);
    tampered[7] ^= 0x55;
    fs.writeFileSync(path.join(dir, 'withdraw.wasm'), tampered);
    fs.writeFileSync(path.join(dir, 'withdraw_final.zkey'), fx.zkey);
    fs.writeFileSync(path.join(dir, 'snarkjs.min.js'), fx.umd);
    const { spawnImpl, calls: spawns } = makeFakeSpawn();
    const outDir = tmpOut();

    await expect(
      supply.main({ source: dir, spawnImpl, pins: fx.pins, outDir, stageScript: 'STAGE.js' })
    ).rejects.toThrow(/withdraw\.wasm digest mismatch/);
    expect(fs.existsSync(path.join(outDir, 'snarkjs.min.js'))).toBe(false);
    expect(spawns).toHaveLength(0);
    // the source directory itself is left untouched (read-only source)
    expect(sha256(fs.readFileSync(path.join(dir, 'withdraw.wasm')))).toBe(sha256(tampered));
  });

  it('local-path source that is not a directory: error', async () => {
    const fx = fixtures();
    const notADir = path.join(tmpSrc(), 'file.txt');
    fs.writeFileSync(notADir, 'x');
    const { spawnImpl } = makeFakeSpawn();
    await expect(
      supply.main({ source: notADir, spawnImpl, pins: fx.pins, outDir: tmpOut(), stageScript: 'S.js' })
    ).rejects.toThrow(/not an existing directory/);
  });

  it('staging hand-off failure propagates (non-zero stage exit fails the supply)', async () => {
    const fx = fixtures();
    const dir = tmpSrc();
    fs.writeFileSync(path.join(dir, 'withdraw.wasm'), fx.wasm);
    fs.writeFileSync(path.join(dir, 'withdraw_final.zkey'), fx.zkey);
    fs.writeFileSync(path.join(dir, 'snarkjs.min.js'), fx.umd);
    const failingSpawn = () => ({ status: 1, error: null });
    await expect(
      supply.main({
        source: dir,
        spawnImpl: failingSpawn,
        pins: fx.pins,
        outDir: tmpOut(),
        stageScript: 'STAGE.js',
      })
    ).rejects.toThrow(/staging hand-off failed \(exit 1\)/);
  });
});

describe('supply-circuit-assets (CLI, real subprocess, local sources only — no network)', () => {
  it('missing source (CIRCUIT_ARTIFACTS_URL unset): exit 1, names the env var', () => {
    const env = { ...process.env };
    delete env[supply.ENV_VAR];
    const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FATAL/);
    expect(r.stderr).toMatch(new RegExp(supply.ENV_VAR));
  });

  it('tampered local source vs the REAL baked pins: exit 1 and the staged directory is untouched', () => {
    const before = dirSnapshot(STAGED_DIR);
    const dir = tmpSrc();
    // bytes that cannot match the real pins
    fs.writeFileSync(path.join(dir, 'withdraw.wasm'), Buffer.alloc(64, 0x01));
    fs.writeFileSync(path.join(dir, 'withdraw_final.zkey'), Buffer.alloc(64, 0x02));
    fs.writeFileSync(path.join(dir, 'snarkjs.min.js'), Buffer.alloc(64, 0x03));

    const env = { ...process.env, [supply.ENV_VAR]: dir };
    const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/digest mismatch/);
    expect(r.stderr).toMatch(/Refusing to stage/);
    // fail-closed: nothing was staged (byte-identical staged directory)
    expect(dirSnapshot(STAGED_DIR)).toEqual(before);
  });

  it('happy path (local source with the real pinned bytes): exit 0, idempotent staging', () => {
    const real = realStagedBytes();
    if (!real) {
      // Fresh checkout (gitignored artifacts absent): the real happy path is
      // exercised by CI/android-build with the pinned remote source instead.
      console.log('SKIP: no locally staged pinned bytes on this checkout');
      return;
    }
    const before = dirSnapshot(STAGED_DIR);
    const dir = tmpSrc();
    fs.writeFileSync(path.join(dir, 'withdraw.wasm'), real.wasm);
    fs.writeFileSync(path.join(dir, 'withdraw_final.zkey'), real.zkey);
    fs.writeFileSync(path.join(dir, 'snarkjs.min.js'), real.umd);

    const env = { ...process.env, [supply.ENV_VAR]: dir };
    const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/digest-verified/);
    // idempotent: identical bytes rewritten, digests unchanged
    expect(dirSnapshot(STAGED_DIR)).toEqual(before);
  });
});

describe('supply-circuit-assets (repo wiring)', () => {
  it('package.json exposes circuits:supply', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    expect(pkg.scripts['circuits:supply']).toBe('node scripts/supply-circuit-assets.js');
  });

  it('android-build.yml: supply fallback is wired before the build, from vars.CIRCUIT_ARTIFACTS_URL', () => {
    const yml = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const stageIdx = yml.indexOf('Stage circuit assets');
    const buildIdx = yml.indexOf('Build Android APK (EAS local)');
    expect(stageIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(stageIdx).toBeLessThan(buildIdx); // stage/supply BEFORE build
    expect(yml).toContain('node scripts/stage-circuit-assets.js'); // local path first
    expect(yml).toContain('node scripts/supply-circuit-assets.js'); // supply fallback
    expect(yml).toContain('CIRCUIT_ARTIFACTS_URL: ${{ vars.CIRCUIT_ARTIFACTS_URL }}'); // documented variable
  });

  it('the supply doc exists and names the variable and the one-time upload', () => {
    const doc = fs.readFileSync(SUPPLY_DOC, 'utf8');
    expect(doc).toMatch(/CIRCUIT_ARTIFACTS_URL/);
    expect(doc).toMatch(/GitHub release/i);
  });
});
