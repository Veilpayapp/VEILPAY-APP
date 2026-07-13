import { recoverSppNotesFromChain } from '../sppClient';
import * as bridge from '../sppNativeBridge';
import * as noteStore from '../../../stores/sppNoteStore';

jest.mock('../sppNativeBridge', () => ({
  sppNativeCapabilities: jest.fn(),
  sppNativePoolSync: jest.fn(),
  sppNativePoolBalance: jest.fn(),
  sppNativeDeposit: jest.fn(),
  sppNativeTransfer: jest.fn(),
  sppNativeWithdraw: jest.fn(),
  sppNativeEnsureAsp: jest.fn(),
  sppNativeEnsureCircuitAssets: jest.fn(async () => ({ ok: true })),
  sppNativePing: jest.fn(),
  sppNativeVersion: jest.fn(() => 'test'),
}));

jest.mock('../../../stores/sppNoteStore', () => ({
  listSppNotes: jest.fn(),
  saveSppNote: jest.fn(),
  sumSppNoteAmounts: jest.fn((notes: { amount: string }[]) =>
    notes.reduce((a, n) => {
      // simple sum for tests
      return String(Number(a) + Number(n.amount));
    }, '0')
  ),
  markSppNoteSpent: jest.fn(),
}));

jest.mock('../sppPoolSession', () => ({
  ensurePoolSession: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../sppOnboard', () => ({
  ensureSppAccountReady: jest.fn(async () => ({ aspReady: true })),
  probeAspMembershipRoot: jest.fn(),
}));

jest.mock('../../../constants/spp', () => ({
  getSppConfigForChain: jest.fn(() => ({
    poolId: 'CPOOL',
    aspMembershipId: 'CASP',
    network: 'testnet',
  })),
  assertSppEnabled: jest.fn(),
  sppTxExplorerUrl: jest.fn(),
  isSppEnabledForChain: jest.fn(() => true),
}));

describe('recoverSppNotesFromChain (DATA-001)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (noteStore.listSppNotes as jest.Mock).mockResolvedValue([]);
    (bridge.sppNativeCapabilities as jest.Mock).mockReturnValue({
      poolOps: true,
      ping: true,
      aspLeaf: true,
    });
  });

  it('returns not recovered when poolOps is false', async () => {
    (bridge.sppNativeCapabilities as jest.Mock).mockReturnValue({ poolOps: false });
    const r = await recoverSppNotesFromChain('stellar-testnet', 'GTEST');
    expect(r.recovered).toBe(false);
    expect(r.message).toMatch(/poolOps/i);
  });

  it('writes a recovery note when native balance exceeds local', async () => {
    (bridge.sppNativePoolSync as jest.Mock).mockResolvedValue({ ok: true });
    (bridge.sppNativePoolBalance as jest.Mock).mockResolvedValue({
      ok: true,
      balanceStroops: '10000000', // 1 XLM
    });
    (noteStore.listSppNotes as jest.Mock)
      .mockResolvedValueOnce([]) // before
      .mockResolvedValueOnce([
        {
          id: 'recover-1',
          amount: '1',
          spent: false,
          ownerAddress: 'GTEST',
          poolId: 'CPOOL',
          chainKey: 'stellar-testnet',
          createdAt: Date.now(),
        },
      ]);

    const r = await recoverSppNotesFromChain('stellar-testnet', 'GTEST');
    expect(r.recovered).toBe(true);
    expect(noteStore.saveSppNote).toHaveBeenCalled();
    expect(r.nativeAmount).toBe('1');
  });
});
