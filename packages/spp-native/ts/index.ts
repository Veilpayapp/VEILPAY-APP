/**
 * RN-facing surface for packages/spp-native.
 *
 * Phase 0/1a: pure JS stub so TypeScript compiles and unit tests can call the API.
 * Phase 1b: replace `NativeSpp` with a TurboModule / Nitro / UniFFI binding that
 * loads the Rust cdylib (same ops as the spp CLI: onboard, deposit, transfer, withdraw).
 */

export type SppNativeCapabilities = {
  version: string;
  ping: boolean;
  poolOps: boolean;
  aspLeaf: boolean;
  backend: 'js-stub' | 'native';
};

export type SppNativeOpResult = {
  ok: boolean;
  code?: string;
  op?: string;
  message?: string;
  txHash?: string;
};

export type SppNativeModule = {
  version(): string;
  ping(input?: string): string;
  capabilities(): SppNativeCapabilities;
  deposit?(amount: string): SppNativeOpResult;
  transfer?(amount: string, recipient: string): SppNativeOpResult;
  withdraw?(amount: string, to?: string): SppNativeOpResult;
  ensureAsp?(): SppNativeOpResult;
};

const notReady = (op: string): SppNativeOpResult => ({
  ok: false,
  code: 'SPP_OPS_NOT_READY',
  op,
  message: 'Native sdk/pool not linked yet',
});

/** Pure JS fallback used until the native library is linked. */
export const SppNativeJs: SppNativeModule = {
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
    message: 'ASP leaf helper not linked',
  }),
};

/**
 * Active backend. Assign the native module here after Nitro/UniFFI install;
 * keep the JS stub for tests and builds without the cdylib.
 */
export let SppNative: SppNativeModule = SppNativeJs;

export function setSppNativeBackend(backend: SppNativeModule): void {
  SppNative = backend;
}

export function version(): string {
  return SppNative.version();
}

export function ping(input?: string): string {
  return SppNative.ping(input);
}

export function capabilities(): SppNativeCapabilities {
  return SppNative.capabilities();
}
