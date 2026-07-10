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

async function asResult(
  value: SppNativeOpResult | Promise<SppNativeOpResult> | undefined,
  fallbackOp: string
): Promise<SppNativeOpResult> {
  if (!value) return notReady(fallbackOp);
  return Promise.resolve(value);
}

export async function sppNativeDeposit(amount: string): Promise<SppNativeOpResult> {
  return asResult(backend.deposit?.(amount), 'deposit');
}

export async function sppNativeTransfer(
  amount: string,
  recipient: string
): Promise<SppNativeOpResult> {
  return asResult(backend.transfer?.(amount, recipient), 'transfer');
}

export async function sppNativeWithdraw(
  amount: string,
  to?: string
): Promise<SppNativeOpResult> {
  return asResult(backend.withdraw?.(amount, to), 'withdraw');
}

export async function sppNativeEnsureAsp(): Promise<SppNativeOpResult> {
  return asResult(backend.ensureAsp?.(), 'ensure_asp');
}

export async function sppNativeDeriveKeys(
  sigHex: string,
  network: string
): Promise<SppNativeOpResult> {
  return asResult(backend.deriveKeys?.(sigHex, network), 'derive_keys');
}

export async function sppNativePoolReadiness(): Promise<SppNativeOpResult> {
  return asResult(backend.poolReadiness?.(), 'pool_readiness');
}
