/**
 * E2E (unit-level) shield → transfer → unshield with mock CAP_POOL_OPS backend.
 * Real device prove is gated on sdk/pool link; this locks the product pipeline.
 */

import {
  deposit,
  getLocalPrivateBalance,
  prepareSppOp,
  setSppNativeBackend,
  runShieldTransferUnshield,
  planLifecycleAmounts,
  SppClientError,
} from '../index';
import { createMockPoolBackend, resetMockPoolSeq } from '../testUtils/mockPoolBackend';

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock('../sppOnboard', () => {
  const actual = jest.requireActual('../sppOnboard') as typeof import('../sppOnboard');
  return {
    ...actual,
    ensureSppAccountReady: jest.fn(async () => ({
      keysSigned: true,
      aspInserted: true,
      notePublicKeyHex: 'aa',
      encryptionPublicKeyHex: 'bb',
    })),
    probeAspMembershipRoot: jest.fn(async () => ({
      ok: true,
      rootHint: 'mock',
    })),
  };
});

// Real pool_open needs mnemonic + circuits; unit E2E only tests note lifecycle.
jest.mock('../sppPoolSession', () => ({
  ensurePoolSession: jest.fn(async () => ({
    ok: true,
    op: 'pool_open',
    message: 'mock session',
  })),
  closePoolSession: jest.fn(async () => ({ ok: true, op: 'pool_close' })),
}));

jest.mock('../../../stores/sppAccountStore', () => ({
  getSppAccount: jest.fn(async () => ({
    chainKey: 'stellar-testnet',
    ownerAddress: 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME',
    derivationSigHashHex: 'ab'.repeat(32),
    aspLeafDecimal: '999',
    aspInserted: true,
  })),
}));

const OWNER = 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME';
const RECIPIENT = 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3';

describe('SPP lifecycle E2E (mock poolOps)', () => {
  beforeEach(() => {
    mockSecureStore.clear();
    resetMockPoolSeq();
    setSppNativeBackend(createMockPoolBackend({ poolOps: true, aspLeaf: true }));
  });

  it('planLifecycleAmounts splits residual correctly', () => {
    expect(planLifecycleAmounts('1', '0.4')).toEqual({
      shield: '1',
      transfer: '0.4',
      unshield: '0.6',
    });
  });

  it('planLifecycleAmounts rejects transfer > shield', () => {
    expect(() => planLifecycleAmounts('1', '2')).toThrow(SppClientError);
  });

  it('prepareSppOp is ready when keys + poolOps mock', async () => {
    const prep = await prepareSppOp('stellar-testnet', OWNER);
    expect(prep.poolOps).toBe(true);
    expect(prep.keysSigned).toBe(true);
    expect(prep.readyForProve).toBe(true);
  });

  it('deposit records a local note and increases private balance', async () => {
    const before = await getLocalPrivateBalance('stellar-testnet', OWNER);
    const start = Number(before.amount);
    const res = await deposit('stellar-testnet', OWNER, '1.25');
    expect(res.txHash).toMatch(/^mock-dep-/);
    expect(res.explorerUrl).toContain(res.txHash);
    const after = await getLocalPrivateBalance('stellar-testnet', OWNER);
    expect(Number(after.amount)).toBeCloseTo(start + 1.25, 5);
  });

  it('shield → transfer → unshield full cycle', async () => {
    const cycle = await runShieldTransferUnshield({
      chainKey: 'stellar-testnet',
      ownerAddress: OWNER,
      shieldAmount: '1.0',
      transferAmount: '0.4',
      recipient: { kind: 'address', stellarAddress: RECIPIENT },
    });

    expect(cycle.shield.txHash).toMatch(/^mock-dep-/);
    expect(cycle.transfer.txHash).toMatch(/^mock-xfer-/);
    expect(cycle.unshield.txHash).toMatch(/^mock-wd-/);
    // Residual 0.6 after transfer is unshielded → ~0 local private balance
    expect(Number(cycle.finalPrivateBalance)).toBeCloseTo(0, 5);
  });

  it('fails closed when mock poolOps is false', async () => {
    setSppNativeBackend(createMockPoolBackend({ poolOps: false }));
    await expect(deposit('stellar-testnet', OWNER, '1')).rejects.toMatchObject({
      code: 'SPP_OPS_NOT_READY',
    });
  });
});
