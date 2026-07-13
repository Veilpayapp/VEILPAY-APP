/**
 * Bridge to native SPP (Expo module → future Rust cdylib).
 *
 * Resolution order:
 * 1. `@veilpay/expo-spp-native` when autolinked in a dev-client / release build
 * 2. Pure JS stub (Jest, Expo Go, web)
 *
 * Never log secrets.
 */

import type { SppNativeCapabilities } from './types';

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
    message:
      'ASP leaf compute needs native derive (libspp_native). Select pXLM under Privacy to sign setup; leaf lands with NDK .so.',
  }),
  deriveKeys: () => ({
    ok: false,
    code: 'SPP_DERIVE_NOT_READY',
    op: 'derive_keys',
    message:
      'JS stub has no Poseidon2. Use a native build with libspp_native.so (cargo-ndk).',
  }),
  poolReadiness: () => ({
    ok: false,
    op: 'pool_readiness',
    code: 'SPP_OPS_NOT_READY',
    message: 'JS stub: sdk/pool not linked; use native build + feature pool-ops',
  }),
  poolOpen: () => notReady('pool_open'),
  poolClose: () => ({ ok: true, op: 'pool_close', message: 'js-stub no-op' }),
  poolSync: () => notReady('pool_sync'),
  poolBalance: () => notReady('pool_balance'),
  ensureCircuitAssets: () => notReady('ensure_circuit_assets'),
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
        deposit(amount: string): SppNativeOpResult;
        transfer(amount: string, recipient: string): SppNativeOpResult;
        withdraw(amount: string, to: string): SppNativeOpResult;
        ensureAsp(): SppNativeOpResult;
        deriveKeys?(sigHex: string, network: string): SppNativeOpResult;
        poolReadiness?(): SppNativeOpResult;
        poolOpen?(configJson: string): SppNativeOpResult;
        poolClose?(): SppNativeOpResult;
        poolSync?(): SppNativeOpResult;
        poolBalance?(): SppNativeOpResult;
        appDataDir?(): string;
        ensureCircuitAssets?(): SppNativeOpResult;
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
    };
  } catch {
    return null;
  }
}

let backend: SppNativeModule = tryLoadExpoNative() ?? JsStub;

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

async function callNative(
  op: string,
  invoke: () => SppNativeOpResult | Promise<SppNativeOpResult> | undefined
): Promise<SppNativeOpResult> {
  try {
    return asResult(invoke(), op);
  } catch (e) {
    return exceptionResult(e, op);
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
  return callNative('pool_readiness', () => backend.poolReadiness?.());
}

export async function sppNativePoolOpen(configJson: string): Promise<SppNativeOpResult> {
  return callNative('pool_open', () => backend.poolOpen?.(configJson));
}

export async function sppNativePoolClose(): Promise<SppNativeOpResult> {
  return callNative('pool_close', () => backend.poolClose?.());
}

export async function sppNativePoolSync(): Promise<SppNativeOpResult> {
  return callNative('pool_sync', () => backend.poolSync?.());
}

export async function sppNativePoolBalance(): Promise<SppNativeOpResult> {
  return callNative('pool_balance', () => backend.poolBalance?.());
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
