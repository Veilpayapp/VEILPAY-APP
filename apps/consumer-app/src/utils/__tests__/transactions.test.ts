jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('../rpc', () => ({
  getRpcUrl: jest.fn(() => 'https://rpc.example'),
}));

jest.mock('../rpcPool', () => ({
  getPoolProvider: jest.fn(),
  poolCall: jest.fn(),
}));

jest.mock('../sentry', () => ({
  captureError: jest.fn(),
}));

jest.mock('viem', () => ({
  parseEther: jest.fn((value: string) => BigInt(Math.floor(Number(value) * 1e18))),
  formatEther: jest.fn((value: bigint) => (Number(value) / 1e18).toString()),
}));

const secureStore = require('expo-secure-store');
const {
  MNEMONIC_STORAGE_KEY,
  TransactionError,
  clearStoredMnemonic,
  getStoredMnemonic,
  storeMnemonic,
  isWalletInitialized,
  isValidAddress,
  waitForTransaction,
  getTransaction,
  getExplorerUrl,
  getFaucetUrl,
} = require('../transactions');
const { poolCall } = require('../rpcPool');

describe('transactions utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores and retrieves the mnemonic phrase via SecureStore', async () => {
    const mnemonic = [
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
    ];

    (secureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (secureStore.getItemAsync as jest.Mock).mockResolvedValue(mnemonic.join(' '));

    await storeMnemonic(mnemonic);
    const restoredMnemonic = await getStoredMnemonic();

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      MNEMONIC_STORAGE_KEY,
      mnemonic.join(' '),
      expect.objectContaining({ keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' })
    );
    expect(restoredMnemonic).toEqual(mnemonic);
  });

  it('clears the stored mnemonic from SecureStore', async () => {
    (secureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);

    await clearStoredMnemonic();

    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      MNEMONIC_STORAGE_KEY,
      expect.objectContaining({ keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' })
    );
  });

  it('exposes the TransactionError contract for caller-side handling', () => {
    const error = new TransactionError('boom', 'UNKNOWN');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TransactionError');
    expect(error.code).toBe('UNKNOWN');
  });

  describe('isWalletInitialized', () => {
    it('returns true when mnemonic exists', async () => {
      (secureStore.getItemAsync as jest.Mock).mockResolvedValue('word1 word2');
      const result = await isWalletInitialized();
      expect(result).toBe(true);
    });

    it('returns false when mnemonic is empty or not found', async () => {
      (secureStore.getItemAsync as jest.Mock).mockResolvedValue('');
      const result = await isWalletInitialized();
      expect(result).toBe(false);
    });
  });

  describe('isValidAddress', () => {
    it('returns true for valid ethereum addresses', () => {
      expect(isValidAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toBe(true);
      expect(isValidAddress('0x71c7656ec7ab88b098defb751b7401b5f6d8976f')).toBe(true);
    });

    it('returns false for invalid addresses', () => {
      expect(isValidAddress('0x123')).toBe(false);
      expect(isValidAddress('invalid')).toBe(false);
      expect(isValidAddress('0x' + 'Z'.repeat(40))).toBe(false);
    });
  });

  describe('waitForTransaction', () => {
    it('returns confirmed status on success', async () => {
      poolCall.mockResolvedValue({ status: 'success', blockNumber: 123n, gasUsed: 21000n });
      const result = await waitForTransaction('0xtxhash');
      expect(result.status).toBe('confirmed');
      expect(result.blockNumber).toBe(123);
      expect(result.gasUsed).toBe('21000');
    });

    it('returns failed status if not found', async () => {
      poolCall.mockResolvedValue(null);
      const result = await waitForTransaction('0xtxhash');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Transaction not found');
    });

    it('returns failed status on exception', async () => {
      poolCall.mockRejectedValue(new Error('Network error'));
      const result = await waitForTransaction('0xtxhash');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Network error');
    });
  });

  describe('getTransaction', () => {
    it('returns transaction data', async () => {
      poolCall.mockResolvedValue({ hash: '0xtxhash', from: '0xabc' });
      const result = await getTransaction('0xtxhash');
      expect(result).toEqual({ hash: '0xtxhash', from: '0xabc' });
    });

    it('returns null on exception', async () => {
      poolCall.mockRejectedValue(new Error('Failed to fetch'));
      const result = await getTransaction('0xtxhash');
      expect(result).toBeNull();
    });
  });

  describe('getExplorerUrl', () => {
    it('returns correct url for sepolia', () => {
      expect(getExplorerUrl('0xtxhash', 'sepolia')).toBe('https://sepolia.etherscan.io/tx/0xtxhash');
    });

    it('returns empty string for unknown network', () => {
      expect(getExplorerUrl('0xtxhash', 'unknown')).toBe('');
    });
  });

  describe('getFaucetUrl', () => {
    it('returns correct url for sepolia', () => {
      expect(getFaucetUrl('sepolia')).toBe('https://sepoliafaucet.com/');
    });

    it('returns empty string for unknown network', () => {
      expect(getFaucetUrl('unknown')).toBe('');
    });
  });
});
