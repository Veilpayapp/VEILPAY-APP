// Feature: veilpay-privacy-stack — release-mode circuit integrity pins
// =====================================================================
// Covers the "Prover off the CDN" hardening of constants/circuit.ts:
//
//   (R1) RELEASE with no pin env vars -> pins default to the digests BAKED
//        in code; `assertCircuitIntegrityPinned` / `assertCircuitConfigured`
//        must NOT throw, and the artifact source must be 'bundled-local'
//        (no remote-by-default fetch).
//   (R2) RELEASE with an EMPTY pin (env var set to "") -> FAILS CLOSED:
//        `assertCircuitIntegrityPinned` and `assertCircuitConfigured` throw
//        CIRCUIT_PINS_NOT_ENFORCED (per artifact pin: wasm, zkey, snarkjs
//        SRI).
//   (R3) RELEASE with a MISMATCHED pin (env override != baked digest) ->
//        same fail-closed throw.
//   (R4) RELEASE with pins explicitly equal to the baked digests -> passes.
//   (R5) RELEASE triggered via the __DEV__ global (Metro release bundle
//        inlines __DEV__ = false) even when NODE_ENV is not 'production'.
//   (D1) DEV with unset/empty pins -> relaxed: no throw from the pin assert
//        (REQUIRED-IF-CONFIGURED is preserved for dev).
//   (D2) DEV with URLs set + no pins -> `assertCircuitConfigured` does not
//        throw (legacy dev behavior unchanged).
//   (D3) DEV with URLs unset -> `assertCircuitConfigured` still throws
//        CIRCUIT_NOT_CONFIGURED (legacy dev behavior unchanged).
//   (P1) The baked digests match the STAGED artifact bytes on disk
//        (assets/circuits/*), re-deriving the snarkjs SRI as well — the
//        same check scripts/stage-circuit-assets.js performs at stage time.
//
// The constants are read from `process.env.*` / `__DEV__` at module import
// time, so every case re-requires the module with a fresh environment
// (jest.resetModules + env save/restore), following the pattern of
// circuit.test.ts.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

type CircuitModule = {
  IS_RELEASE_BUILD: boolean;
  CIRCUIT_ARTIFACT_SOURCE: 'bundled-local' | 'remote' | 'unconfigured';
  CIRCUIT_WASM_URL: string;
  CIRCUIT_ZKEY_URL: string;
  CIRCUIT_WASM_SHA256: string;
  CIRCUIT_ZKEY_SHA256: string;
  SNARKJS_SRI: string;
  BAKED_CIRCUIT_WASM_SHA256: string;
  BAKED_CIRCUIT_ZKEY_SHA256: string;
  BAKED_SNARKJS_SHA256: string;
  BAKED_SNARKJS_SRI: string;
  assertCircuitIntegrityPinned: () => void;
  assertCircuitConfigured: () => void;
  isCircuitConfigured: () => boolean;
};

type Mode = { nodeEnv?: string; devGlobal?: boolean };
type Env = Record<string, string | undefined>;

const PIN_ENV_KEYS = [
  'EXPO_PUBLIC_CIRCUIT_WASM_SHA256',
  'EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256',
  'EXPO_PUBLIC_SNARKJS_SRI',
] as const;

const OTHER_HEX_64 = 'f'.repeat(64);
const OTHER_SRI = 'sha384-' + 'A'.repeat(64);

/**
 * Re-require ../circuit with the given env vars and dev/release mode.
 * Restores process.env, NODE_ENV and the __DEV__ global afterwards.
 */
function loadCircuitModule(env: Env, mode: Mode = {}): CircuitModule {
  jest.resetModules();
  const keys = Object.keys(env);
  const prevEnv: Record<string, string | undefined> = {};
  for (const k of keys) {
    prevEnv[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  const prevNodeEnv = process.env.NODE_ENV;
  if (mode.nodeEnv !== undefined) process.env.NODE_ENV = mode.nodeEnv;
  const hadDevGlobal = Object.prototype.hasOwnProperty.call(globalThis, '__DEV__');
  const prevDevGlobal = (globalThis as { __DEV__?: boolean }).__DEV__;
  if (mode.devGlobal !== undefined) {
    (globalThis as { __DEV__?: boolean }).__DEV__ = mode.devGlobal;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../circuit') as CircuitModule;

  for (const k of keys) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  if (mode.nodeEnv !== undefined) {
    if (prevNodeEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    } else process.env.NODE_ENV = prevNodeEnv;
  }
  if (mode.devGlobal !== undefined) {
    if (!hadDevGlobal) delete (globalThis as { __DEV__?: boolean }).__DEV__;
    else (globalThis as { __DEV__?: boolean }).__DEV__ = prevDevGlobal;
  }
  return mod;
}

const RELEASE: Mode = { nodeEnv: 'production' };
const RELEASE_BY_DEV_FLAG: Mode = { nodeEnv: 'test', devGlobal: false };
const DEV: Mode = { nodeEnv: 'test', devGlobal: true };

function captureThrow(fn: () => void): (Error & { code?: string }) | undefined {
  try {
    fn();
  } catch (e) {
    return e as Error & { code?: string };
  }
  return undefined;
}

describe('constants/circuit — release-mode integrity pins (fail closed)', () => {
  it('(R1) release + no pin env vars -> baked defaults, no throw, bundled-local source', () => {
    const mod = loadCircuitModule({}, RELEASE);
    expect(mod.IS_RELEASE_BUILD).toBe(true);
    expect(mod.CIRCUIT_ARTIFACT_SOURCE).toBe('bundled-local');
    // Pins default to the digests baked in code — never empty in release.
    expect(mod.CIRCUIT_WASM_SHA256).toBe(mod.BAKED_CIRCUIT_WASM_SHA256);
    expect(mod.CIRCUIT_ZKEY_SHA256).toBe(mod.BAKED_CIRCUIT_ZKEY_SHA256);
    expect(mod.SNARKJS_SRI).toBe(mod.BAKED_SNARKJS_SRI);
    expect(() => mod.assertCircuitIntegrityPinned()).not.toThrow();
    expect(() => mod.assertCircuitConfigured()).not.toThrow();
    expect(mod.isCircuitConfigured()).toBe(true);
  });

  it('(R2) release + EMPTY pin -> assertCircuitIntegrityPinned throws CIRCUIT_PINS_NOT_ENFORCED', () => {
    // Each empty pin independently fails closed.
    for (const key of PIN_ENV_KEYS) {
      const mod = loadCircuitModule({ [key]: '' }, RELEASE);
      const thrown = captureThrow(() => mod.assertCircuitIntegrityPinned());
      expect(thrown).toBeDefined();
      expect(thrown?.code).toBe('CIRCUIT_PINS_NOT_ENFORCED');
      expect(thrown?.message).toMatch(key);
    }
  });

  it('(R2b) release + EMPTY pin -> assertCircuitConfigured fails closed the same way', () => {
    const mod = loadCircuitModule({ EXPO_PUBLIC_CIRCUIT_WASM_SHA256: '' }, RELEASE);
    const thrown = captureThrow(() => mod.assertCircuitConfigured());
    expect(thrown).toBeDefined();
    expect(thrown?.code).toBe('CIRCUIT_PINS_NOT_ENFORCED');
    expect(mod.isCircuitConfigured()).toBe(false);
  });

  it('(R3) release + MISMATCHED pin (env override != baked digest) -> throws', () => {
    const cases: Env[] = [
      { EXPO_PUBLIC_CIRCUIT_WASM_SHA256: OTHER_HEX_64 },
      { EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256: OTHER_HEX_64 },
      { EXPO_PUBLIC_SNARKJS_SRI: OTHER_SRI },
    ];
    for (const env of cases) {
      const mod = loadCircuitModule(env, RELEASE);
      const thrown = captureThrow(() => mod.assertCircuitIntegrityPinned());
      expect(thrown).toBeDefined();
      expect(thrown?.code).toBe('CIRCUIT_PINS_NOT_ENFORCED');
    }
  });

  it('(R4) release + pins equal to the baked digests -> passes', () => {
    const mod = loadCircuitModule({}, RELEASE);
    const env: Env = {
      EXPO_PUBLIC_CIRCUIT_WASM_SHA256: mod.BAKED_CIRCUIT_WASM_SHA256,
      EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256: mod.BAKED_CIRCUIT_ZKEY_SHA256,
      EXPO_PUBLIC_SNARKJS_SRI: mod.BAKED_SNARKJS_SRI,
    };
    const pinned = loadCircuitModule(env, RELEASE);
    expect(pinned.IS_RELEASE_BUILD).toBe(true);
    expect(() => pinned.assertCircuitIntegrityPinned()).not.toThrow();
    expect(() => pinned.assertCircuitConfigured()).not.toThrow();
    expect(pinned.isCircuitConfigured()).toBe(true);
  });

  it('(R5) __DEV__=false (Metro release) triggers release mode even with NODE_ENV=test', () => {
    const mod = loadCircuitModule({}, RELEASE_BY_DEV_FLAG);
    expect(mod.IS_RELEASE_BUILD).toBe(true);
    expect(mod.CIRCUIT_ARTIFACT_SOURCE).toBe('bundled-local');
    expect(() => mod.assertCircuitIntegrityPinned()).not.toThrow();
  });

  it('(D1) dev + unset pins -> relaxed: pin assert is a no-op (no throw)', () => {
    const mod = loadCircuitModule({}, DEV);
    expect(mod.IS_RELEASE_BUILD).toBe(false);
    expect(mod.CIRCUIT_WASM_SHA256).toBe('');
    expect(mod.CIRCUIT_ZKEY_SHA256).toBe('');
    expect(() => mod.assertCircuitIntegrityPinned()).not.toThrow();
  });

  it('(D2) dev + URLs set, pins absent -> assertCircuitConfigured does not throw (legacy)', () => {
    const mod = loadCircuitModule(
      {
        EXPO_PUBLIC_CIRCUIT_WASM_URL: 'https://cdn.example/withdraw.wasm',
        EXPO_PUBLIC_CIRCUIT_ZKEY_URL: 'https://cdn.example/withdraw_final.zkey',
      },
      DEV
    );
    expect(mod.CIRCUIT_ARTIFACT_SOURCE).toBe('remote');
    expect(() => mod.assertCircuitConfigured()).not.toThrow();
  });

  it('(D3) dev + URLs unset -> assertCircuitConfigured still throws CIRCUIT_NOT_CONFIGURED', () => {
    const mod = loadCircuitModule({}, DEV);
    const thrown = captureThrow(() => mod.assertCircuitConfigured());
    expect(thrown).toBeDefined();
    expect(thrown?.code).toBe('CIRCUIT_NOT_CONFIGURED');
    expect(mod.isCircuitConfigured()).toBe(false);
  });
});

describe('constants/circuit — baked pins match the staged artifact bytes', () => {
  const ASSETS_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'circuits');

  function requireStaged(name: string): Buffer {
    const p = path.join(ASSETS_DIR, name);
    if (!fs.existsSync(p)) {
      throw new Error(
        `Staged circuit asset missing: ${p}. Run: node apps/consumer-app/scripts/stage-circuit-assets.js (see apps/consumer-app/assets/circuits/README.md). Release builds load the prover from these files with no remote fallback.`
      );
    }
    return fs.readFileSync(p);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../circuit') as CircuitModule;

  it('BAKED_CIRCUIT_WASM_SHA256 equals sha256(assets/circuits/withdraw.wasm)', () => {
    const digest = crypto.createHash('sha256').update(requireStaged('withdraw.wasm')).digest('hex');
    expect(digest).toBe(mod.BAKED_CIRCUIT_WASM_SHA256);
  });

  it('BAKED_CIRCUIT_ZKEY_SHA256 equals sha256(assets/circuits/withdraw_final.zkey)', () => {
    const digest = crypto
      .createHash('sha256')
      .update(requireStaged('withdraw_final.zkey'))
      .digest('hex');
    expect(digest).toBe(mod.BAKED_CIRCUIT_ZKEY_SHA256);
  });

  it('BAKED_SNARKJS_SHA256 equals sha256(assets/circuits/snarkjs.min.js)', () => {
    const digest = crypto
      .createHash('sha256')
      .update(requireStaged('snarkjs.min.js'))
      .digest('hex');
    expect(digest).toBe(mod.BAKED_SNARKJS_SHA256);
  });

  it('snarkjs.min.umd is byte-identical to snarkjs.min.js (Metro asset copy)', () => {
    expect(requireStaged('snarkjs.min.umd').equals(requireStaged('snarkjs.min.js'))).toBe(
      true
    );
  });

  it('BAKED_SNARKJS_SRI equals sha384-base64(snarkjs.min.js)', () => {
    const sri =
      'sha384-' +
      crypto.createHash('sha384').update(requireStaged('snarkjs.min.js')).digest('base64');
    expect(sri).toBe(mod.BAKED_SNARKJS_SRI);
  });
});
