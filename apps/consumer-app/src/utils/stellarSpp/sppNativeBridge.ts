/**
 * Bridge to native SPP (Expo module → future Rust cdylib).
 *
 * UNIFIED BRIDGE: Native backend must be initialized before use.
 * JS stubs are for Jest/mock environments only.
 */

import type { SppNativeCapabilities } from './types';
import { recordSppDiagnostic } from './sppDiagnostics';


export type SppNativeOpResult = {
  ok: boolean;
  code?: string;
  op?: string;
  message?: string;
  txHash?: string;
  leafDecimal?: string | null;
  notePublicKeyHex?: string;
  encryptionPublicKeyHex?: string;
  membershipBlindingHex?: string;
  leafHex?: string;
  /** DATA-001: balance in stroops (decimal string) after pool_balance */
  balanceStroops?: string;
};

export type SppNativeModule = {
  version(): string;
  ping(input?: string): string;
  capabilities(): SppNativeCapabilities;
  deposit?(amount: string): Promise<SppNativeOpResult> | SppNativeOpResult;
  transfer?(
    amount: string,
    recipient: string
  ): Promise<SppNativeOpResult> | SppNativeOpResult;
  withdraw?(amount: string, to?: string): Promise<SppNativeOpResult> | SppNativeOpResult;
  ensureAsp?(): Promise<SppNativeOpResult> | SppNativeOpResult;
  deriveKeys?(
    sigHex: string,
    network: string
  ): Promise<SppNativeOpResult> | SppNativeOpResult;
  poolReadiness?(): Promise<SppNativeOpResult> | SppNativeOpResult;
  /** JSON session config → bind PrivatePool (pool-ops). */
  poolOpen?(configJson: string): Promise<SppNativeOpResult> | SppNativeOpResult;
  poolClose?(): Promise<SppNativeOpResult> | SppNativeOpResult;
  /** Absolute writable app data dir for SQLite + circuits (no file://). */
  appDataDir?(): string;
  /** Copy bundled circuit assets into app data when missing. */
  ensureCircuitAssets?(): Promise<SppNativeOpResult> | SppNativeOpResult;
  /** DATA-001: sync notes from chain. */
  poolSync?(): Promise<SppNativeOpResult> | SppNativeOpResult;
  /** DATA-001: private balance (stroops) after sync. */
  poolBalance?(): Promise<SppNativeOpResult> | SppNativeOpResult;
  /** BIP39 mnemonic → 64-byte seed via native PBKDF2-HMAC-SHA512 (background thread). */
  mnemonicToSeed?(mnemonicPhrase: string): Promise<string> | string;
};

const notReady = (op: string): SppNativeOpResult => ({
  ok: false,
  code: 'SPP_OPS_NOT_READY',
  op,
  message:
    'Native sdk/pool not linked yet. Phase 0 CLI deposit→transfer→withdraw works; NDK/UniFFI link is next.',
});

const JsStub: SppNativeModule = {
  version: () => '0.1.0-js-stub',
  ping: (input) => (input ? `pong:${input}` : 'pong'),
  capabilities: () => ({
    version: '0.1.0-js-stub',
    ping: true,
    poolOps: false,
    aspLeaf: false,
    backend: 'js-stub',
  }),
  deposit: () => notReady('deposit'),
  transfer: () => notReady('transfer'),
  withdraw: () => notReady('withdraw'),
  ensureAsp: () => ({
    ok: false,
    code: 'SPP_ASP_NOT_READY',
    op: 'ensure_asp',
    message: 'Native SPP bridge not initialized. Call ensureInitialized() first.',
  }),
  deriveKeys: () => ({
    ok: false,
    code: 'SPP_DERIVE_NOT_READY',
    op: 'derive_keys',
    message: 'Native SPP bridge not initialized. Call ensureInitialized() first.',
  }),
  poolReadiness: () => ({
    ok: false,
    op: 'pool_readiness',
    code: 'SPP_OPS_NOT_READY',
    message: 'Native SPP bridge not initialized. Call ensureInitialized() first.',
  }),
  poolOpen: () => notReady('pool_open'),
  poolClose: () => ({ ok: true, op: 'pool_close', message: 'js-stub no-op' }),
  poolSync: () => notReady('pool_sync'),
  poolBalance: () => notReady('pool_balance'),
  ensureCircuitAssets: () => notReady('ensure_circuit_assets'),
  mnemonicToSeed: () => {
    throw new Error('mnemonicToSeed not available in JS stub — use the native Expo module');
  },
};

function tryLoadExpoNative(): SppNativeModule | null {
  try {
    // Local Expo module — unavailable in Expo Go / Jest (requireNativeModule throws).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@veilpay/expo-spp-native') as {
      getSppNativeExpoModule?: () => null | {
        version(): string;
        ping(input?: string | null): string;
        capabilities(): SppNativeCapabilities;
        deposit(amount: string): Promise<SppNativeOpResult> | SppNativeOpResult;
        transfer(amount: string, recipient: string): Promise<SppNativeOpResult> | SppNativeOpResult;
        withdraw(amount: string, to: string): Promise<SppNativeOpResult> | SppNativeOpResult;
        ensureAsp(): Promise<SppNativeOpResult> | SppNativeOpResult;
        deriveKeys?(sigHex: string, network: string): Promise<SppNativeOpResult> | SppNativeOpResult;
        poolReadiness?(): Promise<SppNativeOpResult> | SppNativeOpResult;
        poolOpen?(configJson: string): Promise<SppNativeOpResult> | SppNativeOpResult;
        poolClose?(): Promise<SppNativeOpResult> | SppNativeOpResult;
        poolSync?(): Promise<SppNativeOpResult> | SppNativeOpResult;
        poolBalance?(): Promise<SppNativeOpResult> | SppNativeOpResult;
        appDataDir?(): string;
        ensureCircuitAssets?(): Promise<SppNativeOpResult> | SppNativeOpResult;
        mnemonicToSeed?(mnemonicPhrase: string): Promise<string> | string;
      };
    };
    const native = mod.getSppNativeExpoModule?.();
    if (!native) return null;

    return {
      version: () => native.version(),
      ping: (input) => native.ping(input ?? undefined),
      capabilities: () => {
        const c = native.capabilities();
        return {
          version: c.version,
          ping: !!c.ping,
          poolOps: !!c.poolOps,
          aspLeaf: !!c.aspLeaf,
          backend: c.backend === 'native' ? 'native' : 'js-stub',
        };
      },
      deposit: (amount) => native.deposit(amount),
      transfer: (amount, recipient) => native.transfer(amount, recipient),
      withdraw: (amount, to) => native.withdraw(amount, to ?? ''),
      ensureAsp: () => native.ensureAsp(),
      deriveKeys: (sigHex, network) =>
        native.deriveKeys?.(sigHex, network) ?? {
          ok: false,
          code: 'SPP_DERIVE_NOT_READY',
          op: 'derive_keys',
          message: 'deriveKeys not exposed by native module',
        },
      poolReadiness: () =>
        native.poolReadiness?.() ?? {
          ok: false,
          op: 'pool_readiness',
          code: 'SPP_OPS_NOT_READY',
          message: 'poolReadiness not exposed by native module',
        },
      poolOpen: (configJson) =>
        native.poolOpen?.(configJson) ?? {
          ok: false,
          code: 'SPP_OPS_NOT_READY',
          op: 'pool_open',
          message: 'poolOpen not exposed by native module',
        },
      poolClose: () =>
        native.poolClose?.() ?? { ok: true, op: 'pool_close', message: 'no-op' },
      poolSync: () =>
        native.poolSync?.() ?? {
          ok: false,
          code: 'SPP_OPS_NOT_READY',
          op: 'pool_sync',
          message: 'poolSync not exposed by native module',
        },
      poolBalance: () =>
        native.poolBalance?.() ?? {
          ok: false,
          code: 'SPP_OPS_NOT_READY',
          op: 'pool_balance',
          message: 'poolBalance not exposed by native module',
        },
      ensureCircuitAssets: () =>
        native.ensureCircuitAssets?.() ?? {
          ok: false,
          code: 'SPP_CIRCUITS_NOT_BUNDLED',
          op: 'ensure_circuit_assets',
          message: 'ensureCircuitAssets not exposed by native module',
        },
      appDataDir: () => {
        const d = native.appDataDir?.();
        return typeof d === 'string' ? d : '';
      },
      mnemonicToSeed: (phrase) =>
        native.mnemonicToSeed?.(phrase) ?? Promise.reject(new Error('mnemonicToSeed not available')),
    };
  } catch {
    return null;
  }
}

let backend: SppNativeModule = tryLoadExpoNative() ?? JsStub;
// ─── Native Bridge Initialization ──────────────────────────────────────────

let isInitializing = false;
let initialized = false;
let initializationPromise: Promise<boolean> | null = null;

export async function ensureInitialized(): Promise<boolean> {
  if (initialized) return true;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      isInitializing = true;
      // 1. Verify library readiness
      const ready = await backend.poolReadiness?.();
      // 2. Verify circuit assets
      const assets = await backend.ensureCircuitAssets?.();

      initialized = ready?.ok === true && assets?.ok === true;
      return initialized;
    } catch (e) {
      console.error("[SPPBridge] Initialization failed", e);
      return false;
    } finally {
      isInitializing = false;
      initializationPromise = null; // Clear to allow retry on failure
    }
  })();

  return initializationPromise;
}

export function isSppInitialized(): boolean {
  return initialized;
}

/**
 * Inject a backend (tests or post-link). Production prefers Expo native module.
 */
export function setSppNativeBackend(module: SppNativeModule): void {
  backend = module;
}

/** Re-resolve Expo native (e.g. after hot reload). */
export function reloadSppNativeBackend(): SppNativeModule {
  backend = tryLoadExpoNative() ?? JsStub;
  return backend;
}

export function sppNativeVersion(): string {
  return backend.version();
}

export function sppNativePing(input?: string): string {
  return backend.ping(input);
}

export function sppNativeCapabilities(): SppNativeCapabilities {
  return backend.capabilities();
}

function normalizeResult(value: unknown, fallbackOp: string): SppNativeOpResult {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      code: 'SPP_NATIVE_BAD_RESULT',
      op: fallbackOp,
      message: 'Native returned a malformed result',
    };
  }

  const r = value as Record<string, unknown>;
  if (typeof r.ok !== 'boolean') {
    return {
      ok: false,
      code: 'SPP_NATIVE_BAD_RESULT',
      op: fallbackOp,
      message: 'Native result missing boolean ok',
    };
  }

  return {
    ok: r.ok,
    code: typeof r.code === 'string' ? r.code : undefined,
    op: typeof r.op === 'string' ? r.op : fallbackOp,
    message: typeof r.message === 'string' ? r.message : undefined,
    txHash: typeof r.txHash === 'string' ? r.txHash : undefined,
    leafDecimal:
      typeof r.leafDecimal === 'string' || r.leafDecimal === null
        ? r.leafDecimal
        : undefined,
    notePublicKeyHex:
      typeof r.notePublicKeyHex === 'string' ? r.notePublicKeyHex : undefined,
    encryptionPublicKeyHex:
      typeof r.encryptionPublicKeyHex === 'string'
        ? r.encryptionPublicKeyHex
        : undefined,
    membershipBlindingHex:
      typeof r.membershipBlindingHex === 'string'
        ? r.membershipBlindingHex
        : undefined,
    leafHex: typeof r.leafHex === 'string' ? r.leafHex : undefined,
    balanceStroops:
      typeof r.balanceStroops === 'string'
        ? r.balanceStroops
        : typeof r.balanceStroops === 'number'
          ? String(r.balanceStroops)
          : undefined,
  };
}

function exceptionResult(error: unknown, fallbackOp: string): SppNativeOpResult {
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Native SPP operation threw before returning a result';
  return {
    ok: false,
    code: 'SPP_NATIVE_EXCEPTION',
    op: fallbackOp,
    message,
  };
}

async function asResult(
  value: SppNativeOpResult | Promise<SppNativeOpResult> | undefined,
  fallbackOp: string
): Promise<SppNativeOpResult> {
  try {
    if (!value) return notReady(fallbackOp);
    return normalizeResult(await Promise.resolve(value), fallbackOp);
  } catch (e) {
    return exceptionResult(e, fallbackOp);
  }
}

/**
 * Race a promise against a timeout. If the timeout fires first, the returned
 * promise rejects with a descriptive TimeoutError. The original promise is
 * abandoned (its eventual result is ignored) but never leaks to the caller.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err: Error & { code?: string } = new Error(
        `Native ${label} timed out after ${ms}ms`
      );
      err.code = 'SPP_NATIVE_TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timed]).finally(() => clearTimeout(timer));
}

async function callNative(
  op: string,
  invoke: () => SppNativeOpResult | Promise<SppNativeOpResult> | undefined,
  timeoutMs?: number
): Promise<SppNativeOpResult> {
  void recordSppDiagnostic({
    status: 'start',
    step: `native:${op}`,
    operation: op,
  });
  try {
    const promise = asResult(invoke(), op);
    const result = await (timeoutMs ? withTimeout(promise, timeoutMs, op) : promise);
    void recordSppDiagnostic({
      status: result.ok ? 'success' : 'error',
      step: `native:${op}`,
      operation: op,
      code: result.code,
      message: result.message,
      rawError: result.ok ? undefined : result.message,
      txHash: result.txHash,
    });
    return result;
  } catch (e) {
    const result = exceptionResult(e, op);
    void recordSppDiagnostic({
      status: 'error',
      step: `native:${op}`,
      operation: op,
      code: result.code,
      message: result.message,
      rawError: e,
    });
    return result;
  }
}

export async function sppNativeDeposit(amount: string): Promise<SppNativeOpResult> {
  return callNative('deposit', () => backend.deposit?.(amount));
}

export async function sppNativeTransfer(
  amount: string,
  recipient: string
): Promise<SppNativeOpResult> {
  return callNative('transfer', () => backend.transfer?.(amount, recipient));
}

export async function sppNativeWithdraw(
  amount: string,
  to?: string
): Promise<SppNativeOpResult> {
  return callNative('withdraw', () => backend.withdraw?.(amount, to));
}

export async function sppNativeEnsureAsp(): Promise<SppNativeOpResult> {
  return callNative('ensure_asp', () => backend.ensureAsp?.());
}

export async function sppNativeDeriveKeys(
  sigHex: string,
  network: string
): Promise<SppNativeOpResult> {
  return callNative('derive_keys', () => backend.deriveKeys?.(sigHex, network));
}

export async function sppNativePoolReadiness(): Promise<SppNativeOpResult> {
  return callNative('pool_readiness', () => backend.poolReadiness?.(), 15_000);
}

export async function sppNativePoolOpen(configJson: string): Promise<SppNativeOpResult> {
  // 30s timeout: pool_open connects to the RPC + opens SQLite + initialises
  // the prover. A slow or unreachable RPC should not hang the JS thread.
  return callNative('pool_open', () => backend.poolOpen?.(configJson), 30_000);
}

export async function sppNativePoolClose(): Promise<SppNativeOpResult> {
  return callNative('pool_close', () => backend.poolClose?.());
}

export async function sppNativePoolSync(): Promise<SppNativeOpResult> {
  // The current Android SDK bounds sync internally at 30s (testnet) / 90s
  // (mainnet). Keep an app-side ceiling for older shipped .so files too, so a
  // stale native binary cannot leave the user staring at a spinner for minutes.
  return callNative('pool_sync', () => backend.poolSync?.(), 120_000);
}

export async function sppNativePoolBalance(): Promise<SppNativeOpResult> {
  return callNative('pool_balance', () => backend.poolBalance?.(), 15_000);
}

export async function sppNativeEnsureCircuitAssets(): Promise<SppNativeOpResult> {
  return callNative('ensure_circuit_assets', () => backend.ensureCircuitAssets?.());
}

/** Absolute writable app data dir for native SQLite/circuits, or empty if unknown. */
export function sppNativeAppDataDir(): string {
  try {
    const d = backend.appDataDir?.();
    return typeof d === 'string' ? d.trim() : '';
  } catch {
    return '';
  }
}

/**
 * BIP39 mnemonic → 64-byte seed via native PBKDF2-HMAC-SHA512.
 * Returns a hex string, or null if native module is unavailable (caller falls
 * back to the JS implementation). Runs on a background thread — does not
 * block the JS thread.
 */
export async function sppNativeMnemonicToSeed(
  mnemonicPhrase: string
): Promise<string | null> {
  try {
    const result = await backend.mnemonicToSeed?.(mnemonicPhrase);
    if (typeof result === 'string' && result.length === 128) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}
