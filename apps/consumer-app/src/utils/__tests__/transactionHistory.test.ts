const ORIGINAL_ENV = process.env;

jest.mock('../../stores/walletStore', () => ({
  validateAddress: (address: string, chainType: string) => {
    if (chainType === 'evm') {
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    }

    if (chainType === 'svm') {
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    }

    if (chainType === 'mvm') {
      return /^0x[a-fA-F0-9]{1,64}$/.test(address) && address.length <= 66;
    }

    return false;
  },
}));

jest.mock('../rpcPool', () => ({
  poolCall: jest.fn(),
  getPoolProvider: jest.fn(),
}));

describe('fetchTransactionHistoryPage', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_INDEXER_BASE_URL: 'https://indexer.example',
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns empty without hitting network when address is invalid for chain', async () => {
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;

    const { fetchTransactionHistoryPage } = require('../transactionHistory');

    const result = await fetchTransactionHistoryPage({
      address: 'not-a-valid-evm-address',
      chainKey: 'ethereum',
    });

    expect(result).toEqual({
      transactions: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps, normalizes, and sorts transaction history results', async () => {
    const walletAddress = '0x1111111111111111111111111111111111111111';

    const payload = {
      data: {
        transactions: [
          {
            id: 'tx-older',
            type: 'received',
            amount: '1.0',
            tokenSymbol: 'ETH',
            token: 'Ether',
            from: '0x2222222222222222222222222222222222222222',
            to: walletAddress,
            timestamp: '1700000000',
            status: 'success',
            hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
          {
            id: 'tx-newer',
            direction: 'outgoing',
            value: '0.5',
            assetSymbol: 'ETH',
            assetName: 'Ether',
            sender: walletAddress,
            recipient: '0x3333333333333333333333333333333333333333',
            createdAt: '2025-01-02T00:00:00.000Z',
            status: 'processing',
            txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            chain: 'ethereum',
            privacyLevel: 'max',
            fee: '0.001',
          },
        ],
        nextCursor: 'cursor-2',
        hasMore: true,
      },
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    (global as any).fetch = fetchMock;

    const { fetchTransactionHistoryPage } = require('../transactionHistory');

    const result = await fetchTransactionHistoryPage({
      address: walletAddress,
      chainKey: 'ethereum',
      limit: 20,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('cursor-2');
    expect(result.transactions).toHaveLength(2);

    expect(result.transactions[0]).toMatchObject({
      id: 'tx-newer',
      type: 'sent',
      status: 'pending',
      network: 'ethereum',
      privacyLevel: 'max',
      fee: '0.001',
    });

    expect(result.transactions[1]).toMatchObject({
      id: 'tx-older',
      type: 'received',
      status: 'completed',
      tokenSymbol: 'ETH',
    });
  });

  it('falls back to blockchain when indexer returns a non-ok response', async () => {
    const walletAddress = '0x1111111111111111111111111111111111111111';

    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    (global as any).fetch = fetchMock;

    const { fetchTransactionHistoryPage } = require('../transactionHistory');

    const result = await fetchTransactionHistoryPage({
      address: walletAddress,
      chainKey: 'ethereum',
    });

    expect(result).toEqual({
      transactions: [],
      nextCursor: null,
      hasMore: false,
    });
  });
});
