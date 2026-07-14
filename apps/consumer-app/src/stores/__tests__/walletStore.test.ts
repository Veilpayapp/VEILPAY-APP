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

import { useWalletStore, validateAddress, normalizeAddress, SUPPORTED_CHAINS } from '../walletStore';
import { fetchTransactionHistoryPage } from '../../utils/transactionHistory';

describe('walletStore', () => {
  beforeEach(() => {
    (fetchTransactionHistoryPage as jest.Mock).mockReset();
    (fetchTransactionHistoryPage as jest.Mock).mockResolvedValue({
      transactions: [],
      nextCursor: null,
      hasMore: false,
    });

    useWalletStore.getState().disconnect();
  });

  it('validates supported wallet address formats', () => {
    expect(validateAddress('0x1111111111111111111111111111111111111111', 'evm')).toBe(true);
    expect(validateAddress('0xINVALID', 'evm')).toBe(false);

    expect(validateAddress('11111111111111111111111111111111', 'svm')).toBe(true);
    expect(validateAddress('0x11111111111111111111111111111111', 'svm')).toBe(false);

    expect(validateAddress('G' + 'A'.repeat(55), 'xlm')).toBe(true);
    expect(validateAddress('0xabcdef', 'xlm')).toBe(false);
  });

  it('normalizes EVM addresses to lowercase', () => {
    const evmAddress = '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD';
    expect(normalizeAddress(evmAddress, 'evm')).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
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

  it('connect with preDerivedAddresses skips re-derivation and stores multi-chain set', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const pre = {
      evm: address,
      svm: 'So11111111111111111111111111111111111111112',
      xlm: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    };

    await useWalletStore.getState().connect(address, 'evm', undefined, pre);

    const state = useWalletStore.getState();
    expect(state.isConnected).toBe(true);
    expect(state.address).toBe(address);
    expect(state.addresses.evm).toBe(address);
    expect(state.addresses.svm).toBe(pre.svm);
    expect(state.addresses.xlm).toBe(pre.xlm);
    expect(state.accounts[0]?.addresses?.svm).toBe(pre.svm);
  });

  it('updates active chain', () => {
    const polygonChain = SUPPORTED_CHAINS.find((chain: { key: string }) => chain.key === 'polygon');
    if (!polygonChain) {
      throw new Error('polygon chain config missing');
    }

    useWalletStore.getState().setActiveChain(polygonChain);

    const state = useWalletStore.getState();
    expect(state.activeChain?.key).toBe('polygon');
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

});
