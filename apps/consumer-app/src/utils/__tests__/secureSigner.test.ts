jest.mock('ethers', () => {
  const mockSendTransaction = jest.fn();
  const mockConnectedWallet = { sendTransaction: mockSendTransaction };
  const mockWallet = {
    address: '0x3333333333333333333333333333333333333333',
    connect: jest.fn(() => mockConnectedWallet),
  };

  return {
    ethers: {
      parseEther: jest.fn((value: string) => {
        if (value === '1') return 1_000_000_000_000_000_000n;
        return BigInt(Math.floor(Number(value) * 1e18));
      }),
      formatEther: jest.fn((value: bigint) => (Number(value) / 1e18).toString()),
    },
    Mnemonic: {
      fromPhrase: jest.fn(() => ({ phrase: 'mock mnemonic phrase' })),
    },
    HDNodeWallet: {
      fromMnemonic: jest.fn(() => mockWallet),
    },
    Wallet: {},
    TransactionResponse: {},
    __mockWallet: mockWallet,
    __mockConnectedWallet: mockConnectedWallet,
    __mockSendTransaction: mockSendTransaction,
  };
});

jest.mock('../rpcPool', () => ({
  poolCall: jest.fn(),
}));

jest.mock('../transactions', () => ({
  getStoredMnemonic: jest.fn(),
  TransactionError: class TransactionError extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.name = 'TransactionError';
      this.code = code;
    }
  },
  NETWORKS: {
    ethereum: { chainId: 1 },
    sepolia: { chainId: 11155111 },
  },
}));

jest.mock('../gasEstimator', () => ({
  estimateTransactionGas: jest.fn(),
}));

jest.mock('../sentry', () => ({
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const { HDNodeWallet, Mnemonic, __mockSendTransaction, __mockWallet } = require('ethers');
const { poolCall } = require('../rpcPool');
const { getStoredMnemonic, TransactionError } = require('../transactions');
const { estimateTransactionGas } = require('../gasEstimator');
const {
  signAndSendTransaction,
  deriveAddressFromStoredMnemonic,
} = require('../secureSigner');

describe('secureSigner', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (getStoredMnemonic as jest.Mock).mockResolvedValue([
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
    ]);

    (poolCall as jest.Mock).mockImplementation(async (_chainKey: string, fn: (provider: unknown) => Promise<unknown>) => {
      const provider = {
        getBalance: jest.fn().mockResolvedValue(2_000_000_000_000_000_000n),
      };
      return fn(provider as never);
    });

    (estimateTransactionGas as jest.Mock).mockResolvedValue({
      gasLimit: 21_000n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      gasPrice: 2n,
      estimatedCostWei: 42n,
      estimatedCostEth: '0.000000000000000042',
      estimatedCostUsd: '0.00',
      isStale: false,
      fetchedAt: Date.now(),
    });

    __mockSendTransaction.mockResolvedValue({ hash: '0xabc123' });
  });

  it('derives the stored wallet address without exposing mnemonic material', async () => {
    const address = await deriveAddressFromStoredMnemonic();

    expect(address).toBe('0x3333333333333333333333333333333333333333');
    expect(Mnemonic.fromPhrase).toHaveBeenCalledTimes(1);
    expect(HDNodeWallet.fromMnemonic).toHaveBeenCalledTimes(1);
  });

  it('signs and broadcasts a transaction using a scope-local mnemonic', async () => {
    const result = await signAndSendTransaction(
      {
        to: '0x1111111111111111111111111111111111111111',
        value: '1',
      },
      'ethereum',
      3200
    );

    expect(result.hash).toBe('0xabc123');
    expect(result.chainId).toBe(1);
    expect(result.gasEstimate.estimatedCostUsd).toBe('0.00');
    expect(getStoredMnemonic).toHaveBeenCalledTimes(1);
    expect(estimateTransactionGas).toHaveBeenCalledTimes(1);
    expect(__mockWallet.connect).toHaveBeenCalledTimes(1);
    expect(__mockSendTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid recipient addresses before touching mnemonic storage', async () => {
    await expect(
      signAndSendTransaction(
        {
          to: 'not-an-address',
          value: '1',
        },
        'ethereum'
      )
    ).rejects.toMatchObject({
      name: 'TransactionError',
      code: 'INVALID_ADDRESS',
    });

    expect(getStoredMnemonic).not.toHaveBeenCalled();
    expect(poolCall).not.toHaveBeenCalled();
  });
});
