jest.mock('../../utils/secureStateStorage', () => ({
  secureStateStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../../utils/transactionHistory', () => ({
  fetchTransactionHistoryPage: jest.fn(async () => ({
    transactions: [],
    nextCursor: null,
    hasMore: false,
  })),
}));

const {
  SUPPORTED_CHAINS,
  normalizeAddress,
  useWalletStore,
  validateAddress,
} = require('../walletStore');
const { fetchTransactionHistoryPage } = require('../../utils/transactionHistory');

describe('walletStore', () => {
  beforeEach(() => {
    (fetchTransactionHistoryPage as jest.Mock).mockReset();
    (fetchTransactionHistoryPage as jest.Mock).mockResolvedValue({
      transactions: [],
      nextCursor: null,
      hasMore: false,
    });

    useWalletStore.getState().disconnect();
    useWalletStore.getState().setPrivacyLevel('standard');
  });

  it('validates supported wallet address formats', () => {
    expect(validateAddress('0x1111111111111111111111111111111111111111', 'evm')).toBe(true);
    expect(validateAddress('0xINVALID', 'evm')).toBe(false);

    expect(validateAddress('11111111111111111111111111111111', 'svm')).toBe(true);
    expect(validateAddress('0x11111111111111111111111111111111', 'svm')).toBe(false);

    expect(validateAddress('0xabcdef', 'mvm')).toBe(true);
    expect(validateAddress('abcdef', 'mvm')).toBe(false);
  });

  it('normalizes EVM and MVM addresses to lowercase', () => {
    const evmAddress = '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD';
    const mvmAddress = '0xABCDEF';

    expect(normalizeAddress(evmAddress, 'evm')).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    expect(normalizeAddress(mvmAddress, 'mvm')).toBe('0xabcdef');
  });

  it('connects and disconnects wallet state correctly', async () => {
    const address = '0x1111111111111111111111111111111111111111';

    await useWalletStore.getState().connect(address, 'evm');

    const connectedState = useWalletStore.getState();
    expect(connectedState.isConnected).toBe(true);
    expect(connectedState.address).toBe(address);
    expect(connectedState.chainType).toBe('evm');

    connectedState.disconnect();

    const disconnectedState = useWalletStore.getState();
    expect(disconnectedState.isConnected).toBe(false);
    expect(disconnectedState.address).toBeNull();
    expect(disconnectedState.chainType).toBeNull();
  });

  it('updates active chain and privacy level', () => {
    const polygonChain = SUPPORTED_CHAINS.find((chain: { key: string }) => chain.key === 'polygon');
    if (!polygonChain) {
      throw new Error('polygon chain config missing');
    }

    useWalletStore.getState().setActiveChain(polygonChain);
    useWalletStore.getState().setPrivacyLevel('max');

    const state = useWalletStore.getState();
    expect(state.activeChain?.key).toBe('polygon');
    expect(state.defaultPrivacyLevel).toBe('max');
  });

  it('includes built-in testnet chain configs', () => {
    const sepoliaChain = SUPPORTED_CHAINS.find((chain: { key: string }) => chain.key === 'sepolia');
    const solanaDevnetChain = SUPPORTED_CHAINS.find((chain: { key: string }) => chain.key === 'solana-devnet');

    expect(sepoliaChain?.id).toBe(11155111);
    expect(sepoliaChain?.rpcUrl).toContain('sepolia');
    expect(sepoliaChain?.explorerUrl).toContain('sepolia.etherscan.io');

    expect(solanaDevnetChain?.id).toBe('solana-devnet');
    expect(solanaDevnetChain?.rpcUrl).toContain('devnet');
    expect(solanaDevnetChain?.explorerUrl).toContain('cluster=devnet');
  });

  it('refreshes transactions and stores pagination metadata', async () => {
    const address = '0x1111111111111111111111111111111111111111';

    (fetchTransactionHistoryPage as jest.Mock).mockResolvedValueOnce({
      transactions: [
        {
          id: 'tx-old',
          type: 'received',
          amount: '1.0',
          token: 'Ether',
          tokenSymbol: 'ETH',
          from: '0x2222222222222222222222222222222222222222',
          to: address,
          timestamp: 100,
          status: 'completed',
          hash: '0xhash-old',
        },
        {
          id: 'tx-new',
          type: 'sent',
          amount: '0.25',
          token: 'Ether',
          tokenSymbol: 'ETH',
          from: address,
          to: '0x3333333333333333333333333333333333333333',
          timestamp: 200,
          status: 'pending',
          hash: '0xhash-new',
        },
      ],
      nextCursor: 'cursor-1',
      hasMore: true,
    });

    await useWalletStore.getState().connect(address, 'evm');
    await useWalletStore.getState().refreshTransactions();

    expect(fetchTransactionHistoryPage).toHaveBeenCalledWith({
      address,
      chainKey: 'ethereum',
      cursor: undefined,
      limit: 20,
    });

    const state = useWalletStore.getState();
    expect(state.transactions.map((transaction: { id: string }) => transaction.id)).toEqual([
      'tx-new',
      'tx-old',
    ]);
    expect(state.transactionsCursor).toBe('cursor-1');
    expect(state.hasMoreTransactions).toBe(true);
    expect(state.transactionsError).toBeNull();
  });

  it('loads more transactions and deduplicates by id', async () => {
    const address = '0x1111111111111111111111111111111111111111';

    (fetchTransactionHistoryPage as jest.Mock)
      .mockResolvedValueOnce({
        transactions: [
          {
            id: 'tx-2',
            type: 'received',
            amount: '0.8',
            token: 'Ether',
            tokenSymbol: 'ETH',
            from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            to: address,
            timestamp: 200,
            status: 'completed',
            hash: '0xhash-2',
          },
          {
            id: 'tx-1',
            type: 'sent',
            amount: '0.2',
            token: 'Ether',
            tokenSymbol: 'ETH',
            from: address,
            to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            timestamp: 100,
            status: 'completed',
            hash: '0xhash-1',
          },
        ],
        nextCursor: 'cursor-2',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        transactions: [
          {
            id: 'tx-2',
            type: 'received',
            amount: '0.8',
            token: 'Ether',
            tokenSymbol: 'ETH',
            from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            to: address,
            timestamp: 200,
            status: 'completed',
            hash: '0xhash-2',
          },
          {
            id: 'tx-3',
            type: 'received',
            amount: '1.2',
            token: 'Ether',
            tokenSymbol: 'ETH',
            from: '0xcccccccccccccccccccccccccccccccccccccccc',
            to: address,
            timestamp: 300,
            status: 'completed',
            hash: '0xhash-3',
          },
        ],
        nextCursor: null,
        hasMore: false,
      });

    await useWalletStore.getState().connect(address, 'evm');
    await useWalletStore.getState().refreshTransactions();
    await useWalletStore.getState().loadMoreTransactions();

    const state = useWalletStore.getState();
    expect(state.transactions.map((transaction: { id: string }) => transaction.id)).toEqual([
      'tx-3',
      'tx-2',
      'tx-1',
    ]);
    expect(state.transactionsCursor).toBeNull();
    expect(state.hasMoreTransactions).toBe(false);
  });

  it('stores transaction fetch errors without throwing', async () => {
    const address = '0x1111111111111111111111111111111111111111';

    (fetchTransactionHistoryPage as jest.Mock).mockRejectedValueOnce(new Error('Indexer unavailable'));

    await useWalletStore.getState().connect(address, 'evm');
    await useWalletStore.getState().refreshTransactions();

    const state = useWalletStore.getState();
    expect(state.transactionsError).toBe('Indexer unavailable');
    expect(state.isLoadingTransactions).toBe(false);
  });

  it('stores and clears the latest Transak order outcome', async () => {
    const address = '0x1111111111111111111111111111111111111111';

    await useWalletStore.getState().connect(address, 'evm');
    useWalletStore.getState().setLatestTransakOrder({
      walletAddress: address,
      flow: 'buy',
      status: 'success',
      orderId: 'order-123',
      fiatAmount: '100',
      fiatCurrency: 'USD',
      cryptoAmount: '0.25',
      cryptoCurrency: 'ETH',
      network: 'ethereum',
      updatedAt: 123,
    });

    let state = useWalletStore.getState();
    expect(state.latestTransakOrder).toMatchObject({
      walletAddress: address,
      flow: 'buy',
      status: 'success',
      orderId: 'order-123',
      cryptoCurrency: 'ETH',
    });

    state.clearLatestTransakOrder();
    state = useWalletStore.getState();
    expect(state.latestTransakOrder).toBeNull();
  });
});
