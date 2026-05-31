import { signAndSendTransaction, deriveAddressFromStoredMnemonic, replaceTransaction, generateBiometricToken, _biometricTokenCount } from '../secureSigner';
import { getStoredMnemonic, TransactionError } from '../transactions';
import { poolCall, getPoolProvider } from '../rpcPool';
import { estimateTransactionGas } from '../gasEstimator';
import { createWalletClient, parseEther, formatEther } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

jest.mock('viem', () => ({
  parseEther: jest.fn((val: string) => BigInt(Math.floor(Number(val) * 1e18))),
  formatEther: jest.fn((val: bigint) => (Number(val) / 1e18).toString()),
  createWalletClient: jest.fn(),
  custom: jest.fn(() => 'custom_transport'),
}));

jest.mock('viem/accounts', () => ({
  mnemonicToAccount: jest.fn(),
}));

jest.mock('../rpcPool', () => ({
  poolCall: jest.fn(),
  getPoolProvider: jest.fn(),
}));

jest.mock('../transactions', () => ({
  getStoredMnemonic: jest.fn(),
  TransactionError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'TransactionError';
      this.code = code;
    }
  },
  NETWORKS: {
    ethereum: { chainId: 1, name: 'Ethereum', symbol: 'ETH', rpcUrl: 'https://eth.rpc' },
  },
}));

jest.mock('../gasEstimator', () => ({
  estimateTransactionGas: jest.fn(),
}));

jest.mock('../sentry', () => ({
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

describe('secureSigner', () => {
  const mockAccount = { address: '0x3333333333333333333333333333333333333333' };
  const mockWalletClient = {
    sendTransaction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (getStoredMnemonic as jest.Mock).mockResolvedValue([
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
    ]);

    (mnemonicToAccount as jest.Mock).mockReturnValue(mockAccount);
    (createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);

    (poolCall as jest.Mock).mockImplementation(async (chainKey: string, fn: any) => {
      const provider = {
        getBalance: jest.fn().mockResolvedValue(2000000000000000000n), // 2 ETH
      };
      return fn(provider);
    });

    (estimateTransactionGas as jest.Mock).mockResolvedValue({
      gasLimit: 21000n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      gasPrice: 2n,
      estimatedCostWei: 42000n,
      estimatedCostEth: '0.000042',
      estimatedCostUsd: '0.10',
      isStale: false,
      fetchedAt: Date.now(),
    });

    mockWalletClient.sendTransaction.mockResolvedValue('0xabc123');
  });

  describe('deriveAddressFromStoredMnemonic', () => {
    it('returns the derived address', async () => {
      const address = await deriveAddressFromStoredMnemonic();
      expect(address).toBe(mockAccount.address);
      expect(mnemonicToAccount).toHaveBeenCalledWith('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', { path: "m/44'/60'/0'/0/0" });
    });

    it('returns null if no mnemonic', async () => {
      (getStoredMnemonic as jest.Mock).mockResolvedValueOnce(null);
      const address = await deriveAddressFromStoredMnemonic();
      expect(address).toBeNull();
    });
  });

  describe('signAndSendTransaction', () => {
    it('signs and broadcasts a transaction', async () => {
      const result = await signAndSendTransaction(
        { to: '0x1111111111111111111111111111111111111111', value: '1' },
        'ethereum'
      );
      expect(result.hash).toBe('0xabc123');
      expect(result.chainId).toBe(1);
      expect(mockWalletClient.sendTransaction).toHaveBeenCalled();
    });

    it('rejects invalid recipient address', async () => {
      await expect(
        signAndSendTransaction({ to: 'not-an-address', value: '1' }, 'ethereum')
      ).rejects.toThrow('Invalid recipient address');
    });

    it('rejects unsupported network', async () => {
      await expect(
        signAndSendTransaction({ to: '0x1111111111111111111111111111111111111111', value: '1' }, 'unknown')
      ).rejects.toThrow('Unsupported network: unknown');
    });

    it('throws insufficient funds if balance is too low', async () => {
      (poolCall as jest.Mock).mockImplementation(async (chainKey: string, fn: any) => {
        const provider = {
          getBalance: jest.fn().mockResolvedValue(10n), // Very low balance
        };
        return fn(provider);
      });

      await expect(
        signAndSendTransaction({ to: '0x1111111111111111111111111111111111111111', value: '1' }, 'ethereum')
      ).rejects.toThrow(/Insufficient funds/);
    });

    it('throws if amount is zero or invalid', async () => {
      (parseEther as jest.Mock).mockReturnValueOnce(0n);
      await expect(
        signAndSendTransaction({ to: '0x1111111111111111111111111111111111111111', value: '0' }, 'ethereum')
      ).rejects.toThrow('Transaction value must be greater than zero');

      (parseEther as jest.Mock).mockImplementationOnce(() => { throw new Error('invalid'); });
      await expect(
        signAndSendTransaction({ to: '0x1111111111111111111111111111111111111111', value: 'invalid' }, 'ethereum')
      ).rejects.toThrow('Invalid ETH amount: invalid');
    });

    it('throws if no mnemonic found', async () => {
      (getStoredMnemonic as jest.Mock).mockResolvedValueOnce([]);
      await expect(
        signAndSendTransaction({ to: '0x1111111111111111111111111111111111111111', value: '1' }, 'ethereum')
      ).rejects.toThrow('No wallet found');
    });

    it('handles unexpected error in signing', async () => {
      (poolCall as jest.Mock).mockRejectedValueOnce(new Error('Unexpected poolCall error'));
      await expect(
        signAndSendTransaction({ to: '0x1111111111111111111111111111111111111111', value: '1' }, 'ethereum')
      ).rejects.toThrow('Unexpected poolCall error');
    });

    it('uses biometric token and checks count', async () => {
      const token = generateBiometricToken();
      expect(_biometricTokenCount()).toBe(1);
      const result = await signAndSendTransaction(
        { to: '0x1111111111111111111111111111111111111111', value: '1' },
        'ethereum',
        undefined,
        token
      );
      expect(result.hash).toBe('0xabc123');
      expect(_biometricTokenCount()).toBe(0);
    });
  });

  describe('replaceTransaction', () => {
    it('speeds up a transaction', async () => {
      (poolCall as jest.Mock).mockImplementation(async (chainKey: string, fn: any) => {
        const provider = {
          getTransaction: jest.fn().mockResolvedValue({
            hash: '0xold',
            blockNumber: null,
            nonce: 1,
            to: '0x1111111111111111111111111111111111111111',
            value: 1000n,
            gas: 21000n,
            maxFeePerGas: 100n,
            maxPriorityFeePerGas: 10n,
          }),
          estimateFeesPerGas: jest.fn().mockResolvedValue({
            maxFeePerGas: 150n,
            maxPriorityFeePerGas: 15n,
          }),
        };
        return fn(provider);
      });

      const result = await replaceTransaction({
        originalTxHash: '0xold',
        chainKey: 'ethereum',
        mode: 'speedup',
      });
      expect(result.hash).toBe('0xabc123');
      expect(mockWalletClient.sendTransaction).toHaveBeenCalled();
    });

    it('cancels a transaction', async () => {
      (poolCall as jest.Mock).mockImplementation(async (chainKey: string, fn: any) => {
        const provider = {
          getTransaction: jest.fn().mockResolvedValue({
            hash: '0xold',
            blockNumber: null,
            nonce: 1,
            to: '0x1111111111111111111111111111111111111111',
            value: 1000n,
            gas: 21000n,
          }),
          estimateFeesPerGas: jest.fn().mockResolvedValue({
            maxFeePerGas: 150n,
            maxPriorityFeePerGas: 15n,
          }),
        };
        return fn(provider);
      });

      const result = await replaceTransaction({
        originalTxHash: '0xold',
        chainKey: 'ethereum',
        mode: 'cancel',
      });
      expect(result.hash).toBe('0xabc123');
      const txArgs = mockWalletClient.sendTransaction.mock.calls[0][0];
      expect(txArgs.to).toBe(mockAccount.address);
      expect(txArgs.value).toBe(0n);
    });

    it('throws if transaction already confirmed', async () => {
      (poolCall as jest.Mock).mockImplementation(async (chainKey: string, fn: any) => {
        const provider = {
          getTransaction: jest.fn().mockResolvedValue({
            hash: '0xold',
            blockNumber: 1234,
          }),
        };
        return fn(provider);
      });

      await expect(
        replaceTransaction({
          originalTxHash: '0xold',
          chainKey: 'ethereum',
          mode: 'speedup',
        })
      ).rejects.toThrow('Original transaction already confirmed');
    });

    it('throws if original tx not found', async () => {
      (poolCall as jest.Mock).mockImplementation(async (chainKey: string, fn: any) => {
        const provider = { getTransaction: jest.fn().mockResolvedValue(null) };
        return fn(provider);
      });
      await expect(replaceTransaction({ originalTxHash: '0xold', chainKey: 'ethereum', mode: 'speedup' }))
        .rejects.toThrow('Original transaction not found');
    });

    it('throws if no wallet is stored', async () => {
      (getStoredMnemonic as jest.Mock).mockResolvedValueOnce([]);
      (poolCall as jest.Mock).mockImplementation(async (chainKey: string, fn: any) => {
        const provider = { getTransaction: jest.fn().mockResolvedValue({ hash: '0xold', blockNumber: null }) };
        return fn(provider);
      });
      await expect(replaceTransaction({ originalTxHash: '0xold', chainKey: 'ethereum', mode: 'speedup' }))
        .rejects.toThrow('No wallet found');
    });
  });
});
