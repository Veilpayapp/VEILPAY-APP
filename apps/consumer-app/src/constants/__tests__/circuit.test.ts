// Feature: veilpay-privacy-stack — circuit artifact configuration guards
// =====================================================================
// Covers `assertCircuitConfigured()` / `isCircuitConfigured()` from
// constants/circuit.ts. The constants are read from `process.env.*` at
// module import time, so each case re-requires the module with a fresh env.
//
// Security posture under test (REQUIRED-IF-CONFIGURED):
//   (a) URLs + SHA-256 pins present -> configured, integrity enforced.
//       `assertCircuitConfigured` must NOT throw when both URLs are set,
//       even with pins present.
//   (b) URLs present, SHA pins absent -> still allowed (no throw); a build
//       that configured only the artifact URLs must not regress. Integrity
//       pinning check is skipped/off in this case.
//   (c) URLs absent -> throws `CIRCUIT_NOT_CONFIGURED`.

describe('constants/circuit — assertCircuitConfigured (REQUIRED-IF-CONFIGURED)', () => {
  const RC = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  function loadModule(env: Record<string, string | undefined>) {
    // Drop any cached copy so the module re-reads `process.env`.
    jest.resetModules();
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      prev[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../circuit');
    for (const [k, v] of Object.entries(env)) {
      // Restore the prior value. Important: assigning `undefined` would
      // store the string "undefined", so we must `delete` when unset.
      void v;
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    return mod as {
      CIRCUIT_WASM_URL: string;
      CIRCUIT_ZKEY_URL: string;
      CIRCUIT_WASM_SHA256: string;
      CIRCUIT_ZKEY_SHA256: string;
      assertCircuitConfigured: () => void;
      isCircuitConfigured: () => boolean;
    };
  }

  it('(a) URLs + hashes present -> configured, integrity enforced (no throw)', () => {
    const mod = loadModule({
      EXPO_PUBLIC_CIRCUIT_WASM_URL: 'https://cdn.example/withdraw.wasm',
      EXPO_PUBLIC_CIRCUIT_ZKEY_URL: 'https://cdn.example/withdraw_final.zkey',
      EXPO_PUBLIC_CIRCUIT_WASM_SHA256: RC,
      EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256: RC,
    });
    expect(mod.CIRCUIT_WASM_URL).toBe('https://cdn.example/withdraw.wasm');
    expect(mod.CIRCUIT_ZKEY_URL).toBe('https://cdn.example/withdraw_final.zkey');
    expect(mod.CIRCUIT_WASM_SHA256).toBe(RC);
    expect(mod.CIRCUIT_ZKEY_SHA256).toBe(RC);
    // Pins present -> integrity is enforced; config guard must NOT throw.
    expect(() => mod.assertCircuitConfigured()).not.toThrow();
    expect(mod.isCircuitConfigured()).toBe(true);
  });

  it('(b) URLs present, hashes absent -> allowed (no throw, pin off)', () => {
    const mod = loadModule({
      EXPO_PUBLIC_CIRCUIT_WASM_URL: 'https://cdn.example/withdraw.wasm',
      EXPO_PUBLIC_CIRCUIT_ZKEY_URL: 'https://cdn.example/withdraw_final.zkey',
      EXPO_PUBLIC_CIRCUIT_WASM_SHA256: undefined,
      EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256: undefined,
    });
    expect(mod.CIRCUIT_WASM_SHA256).toBe('');
    expect(mod.CIRCUIT_ZKEY_SHA256).toBe('');
    // Hash pins absent -> integrity check skipped; URL-only build proceeds.
    expect(() => mod.assertCircuitConfigured()).not.toThrow();
    expect(mod.isCircuitConfigured()).toBe(true);
  });

  it('(b) URLs present, only ONE hash absent -> still allowed (no throw)', () => {
    const mod = loadModule({
      EXPO_PUBLIC_CIRCUIT_WASM_URL: 'https://cdn.example/withdraw.wasm',
      EXPO_PUBLIC_CIRCUIT_ZKEY_URL: 'https://cdn.example/withdraw_final.zkey',
      EXPO_PUBLIC_CIRCUIT_WASM_SHA256: RC,
      EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256: undefined,
    });
    expect(() => mod.assertCircuitConfigured()).not.toThrow();
    expect(mod.isCircuitConfigured()).toBe(true);
  });

  it('(c) URLs absent -> throws CIRCUIT_NOT_CONFIGURED regardless of pins', () => {
    for (const env of [
      {},
      { EXPO_PUBLIC_CIRCUIT_WASM_SHA256: RC, EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256: RC },
      { EXPO_PUBLIC_CIRCUIT_WASM_URL: 'https://cdn.example/withdraw.wasm' },
    ] as const) {
      const mod = loadModule(env);
      let thrown: (Error & { code?: string }) | undefined;
      try {
        mod.assertCircuitConfigured();
      } catch (e) {
        thrown = e as Error & { code?: string };
      }
      expect(thrown).toBeDefined();
      expect(thrown?.code).toBe('CIRCUIT_NOT_CONFIGURED');
      expect(mod.isCircuitConfigured()).toBe(false);
    }
  });
});
