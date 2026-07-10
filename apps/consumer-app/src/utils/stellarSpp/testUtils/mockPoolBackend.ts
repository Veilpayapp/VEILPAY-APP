/**
 * Injectable native backend with CAP_POOL_OPS simulated for unit/E2E tests.
 * Does not perform real proves — returns deterministic fake tx hashes.
 */

import type { SppNativeModule, SppNativeOpResult } from '../sppNativeBridge';

let seq = 0;
function nextHash(op: string): string {
  seq += 1;
  return `mock-${op}-${seq.toString(16).padStart(8, '0')}`;
}

export function createMockPoolBackend(options?: {
  poolOps?: boolean;
  aspLeaf?: boolean;
}): SppNativeModule {
  const poolOps = options?.poolOps ?? true;
  const aspLeaf = options?.aspLeaf ?? true;

  return {
    version: () => '0.1.0-mock-pool',
    ping: (input) => (input ? `pong:${input}` : 'pong'),
    capabilities: () => ({
      version: '0.1.0-mock-pool',
      ping: true,
      poolOps,
      aspLeaf,
      backend: 'native',
    }),
    deposit: async (amount: string): Promise<SppNativeOpResult> => {
      if (!poolOps) {
        return {
          ok: false,
          code: 'SPP_OPS_NOT_READY',
          op: 'deposit',
          message: 'mock poolOps false',
        };
      }
      if (!amount || Number(amount) <= 0) {
        return { ok: false, code: 'SPP_INVALID_AMOUNT', op: 'deposit', message: 'bad amount' };
      }
      return { ok: true, op: 'deposit', txHash: nextHash('dep') };
    },
    transfer: async (amount: string, recipient: string): Promise<SppNativeOpResult> => {
      if (!poolOps) {
        return {
          ok: false,
          code: 'SPP_OPS_NOT_READY',
          op: 'transfer',
          message: 'mock poolOps false',
        };
      }
      if (!amount || Number(amount) <= 0) {
        return { ok: false, code: 'SPP_INVALID_AMOUNT', op: 'transfer', message: 'bad amount' };
      }
      if (!recipient) {
        return {
          ok: false,
          code: 'SPP_INVALID_RECIPIENT',
          op: 'transfer',
          message: 'missing recipient',
        };
      }
      return { ok: true, op: 'transfer', txHash: nextHash('xfer') };
    },
    withdraw: async (amount: string, to?: string): Promise<SppNativeOpResult> => {
      if (!poolOps) {
        return {
          ok: false,
          code: 'SPP_OPS_NOT_READY',
          op: 'withdraw',
          message: 'mock poolOps false',
        };
      }
      if (!amount || Number(amount) <= 0) {
        return { ok: false, code: 'SPP_INVALID_AMOUNT', op: 'withdraw', message: 'bad amount' };
      }
      if (to && !/^G[A-Z2-7]{55}$/.test(to)) {
        return {
          ok: false,
          code: 'SPP_INVALID_RECIPIENT',
          op: 'withdraw',
          message: 'bad to',
        };
      }
      return { ok: true, op: 'withdraw', txHash: nextHash('wd') };
    },
    ensureAsp: async () =>
      aspLeaf
        ? { ok: true, op: 'ensure_asp', message: 'mock asp ok' }
        : { ok: false, code: 'SPP_ASP_NOT_READY', op: 'ensure_asp', message: 'mock asp missing' },
    deriveKeys: async () =>
      aspLeaf
        ? {
            ok: true,
            op: 'derive_keys',
            notePublicKeyHex: 'aa'.repeat(32),
            encryptionPublicKeyHex: 'bb'.repeat(32),
            membershipBlindingHex: 'cc'.repeat(32),
            leafDecimal: '12345',
            leafHex: 'dd'.repeat(32),
          }
        : {
            ok: false,
            code: 'SPP_DERIVE_NOT_READY',
            op: 'derive_keys',
            message: 'mock no derive',
          },
  };
}

export function resetMockPoolSeq(): void {
  seq = 0;
}
