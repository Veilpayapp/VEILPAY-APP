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

// RPC preflight in syncPoolWithRpcFailover uses global fetch to probe
// getLatestLedger. Default mock: primary RPC responds with a valid ledger.
beforeAll(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify({ jsonrpc: '2.0', result: { id: '12345' } }),
  })) as unknown as typeof fetch;
});

jest.mock('../../../constants/spp', () => ({
  getSppConfigForChain: jest.fn(() => ({
    poolId: 'CPOOL',
    aspMembershipId: 'CASP',
    network: 'testnet',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    chainKey: 'stellar-testnet',
    deployer: 'GDEPLOY',
    admin: 'GADMIN',
    verifierId: 'CVERIFIER',
    aspNonMembershipId: 'CNONMEMBER',
    registryId: 'CREGISTRY',
    nativeTokenContractId: 'CNATIVE',
    explorerBaseUrl: 'https://stellar.expert/explorer/testnet',
    deploymentLedger: 4125614,
    maxDepositStroops: '1000000000',
  })),
  assertSppEnabled: jest.fn(() => ({
    poolId: 'CPOOL',
    aspMembershipId: 'CASP',
    network: 'testnet',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    chainKey: 'stellar-testnet',
    deployer: 'GDEPLOY',
    admin: 'GADMIN',
    verifierId: 'CVERIFIER',
    aspNonMembershipId: 'CNONMEMBER',
    registryId: 'CREGISTRY',
    nativeTokenContractId: 'CNATIVE',
    explorerBaseUrl: 'https://stellar.expert/explorer/testnet',
    deploymentLedger: 4125614,
    maxDepositStroops: '1000000000',
  })),
  getSppFallbackRpcUrl: jest.fn(() => null),
  sppTxExplorerUrl: jest.fn(),
  isSppEnabledForChain: jest.fn(() => true),
}));

describe('recoverSppNotesFromChain (DATA-001)', () => {
  beforeEach(() => {
    // Recovery runs a real 1500ms gap between the two sync passes (C2).
    // jest.setup.ts enables fake timers globally, whose setTimeout never fires
    // on its own; run this describe with real timers so the gap actually
    // elapses. Restored to fake timers in afterEach.
    jest.useRealTimers();
    jest.clearAllMocks();
    (noteStore.listSppNotes as jest.Mock).mockResolvedValue([]);
    (bridge.sppNativeCapabilities as jest.Mock).mockReturnValue({
      poolOps: true,
      ping: true,
      aspLeaf: true,
    });
  });

  afterEach(() => {
    jest.useFakeTimers();
  });

  it('returns not recovered when poolOps is false', async () => {
    (bridge.sppNativeCapabilities as jest.Mock).mockReturnValue({ poolOps: false });
    const r = await recoverSppNotesFromChain('stellar-testnet', 'GTEST');
    expect(r.recovered).toBe(false);
    expect(r.message).toMatch(/poolOps/i);
  });

  it(
    'writes a recovery note when native balance exceeds local',
    async () => {
      // Recovery now runs a two-pass sync with a real 1500ms gap (see C2),
      // so allow well beyond the default 5s timeout.
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
    },
    45_000
  );
});
