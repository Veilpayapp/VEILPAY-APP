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

jest.mock('ethers', () => ({
  ethers: {
    parseEther: jest.fn((value: string) => BigInt(Math.floor(Number(value) * 1e18))),
    formatEther: jest.fn((value: bigint) => (Number(value) / 1e18).toString()),
  },
  JsonRpcProvider: jest.fn(),
  Wallet: jest.fn(),
  TransactionResponse: {},
  FeeData: {},
  TransactionRequest: {},
  HDNodeWallet: {
    fromMnemonic: jest.fn(() => ({
      address: '0x4444444444444444444444444444444444444444',
    })),
  },
  Mnemonic: {
    fromPhrase: jest.fn((phrase: string) => ({ phrase })),
  },
}));

const secureStore = require('expo-secure-store');
const { HDNodeWallet, Mnemonic } = require('ethers');
const {
  MNEMONIC_STORAGE_KEY,
  TransactionError,
  clearStoredMnemonic,
  deriveWalletFromMnemonic,
  getStoredMnemonic,
  storeMnemonic,
} = require('../transactions');

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

  it('derives a wallet from a mnemonic without exposing the mnemonic string', () => {
    const mnemonic = [
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
    ];

    const wallet = deriveWalletFromMnemonic(mnemonic);

    expect(Mnemonic.fromPhrase).toHaveBeenCalledTimes(1);
    expect(HDNodeWallet.fromMnemonic).toHaveBeenCalledTimes(1);
    expect(wallet.address).toBe('0x4444444444444444444444444444444444444444');
  });

  it('exposes the TransactionError contract for caller-side handling', () => {
    const error = new TransactionError('boom', 'UNKNOWN');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TransactionError');
    expect(error.code).toBe('UNKNOWN');
  });
});
