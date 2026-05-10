jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('../rpc', () => ({
  getRpcUrl: jest.fn((key: string) => {
    const urls: Record<string, string> = {
      solana: 'https://api.mainnet-beta.solana.com',
      'solana-devnet': 'https://api.devnet.solana.com',
      aptos: 'https://fullnode.mainnet.aptoslabs.com',
    };
    return urls[key] || 'https://rpc.example';
  }),
}));

jest.mock('../rpcPool', () => ({
  getPoolProvider: jest.fn(),
  poolCall: jest.fn(),
}));

jest.mock('../sentry', () => ({
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('../marketData', () => ({
  getTokenMarketQuote: jest.fn(),
}));

jest.mock('ethers', () => ({
  ethers: {
    parseEther: jest.fn((value: string) => BigInt(Math.floor(Number(value) * 1e18))),
    formatEther: jest.fn((value: bigint) => (Number(value) / 1e18).toString()),
    formatUnits: jest.fn((value: string, decimals: number) => {
      const num = Number(value) / Math.pow(10, decimals);
      return num.toString();
    }),
  },
  Contract: jest.fn(),
  JsonRpcProvider: jest.fn(),
}));

import { fetchNativeBalance } from '../balanceFetcher';
import { poolCall } from '../rpcPool';

const mockPoolCall = poolCall as jest.MockedFunction<typeof poolCall>;

describe('balanceFetcher — multi-chain support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchNativeBalance — EVM chains', () => {
    it('fetches EVM native balance via poolCall', async () => {
      mockPoolCall.mockResolvedValueOnce(BigInt('1000000000000000000'));

      const result = await fetchNativeBalance(
        '0x3333333333333333333333333333333333333333',
        'ethereum'
      );

      expect(result.balance).toBe('1000000000000000000');
      expect(result.symbol).toBe('ETH');
      expect(result.source).toBe('rpc');
      expect(mockPoolCall).toHaveBeenCalledWith('ethereum', expect.any(Function));
    });

    it('returns fallback on EVM fetch failure', async () => {
      mockPoolCall.mockRejectedValueOnce(new Error('RPC error'));

      const result = await fetchNativeBalance(
        '0x3333333333333333333333333333333333333333',
        'polygon'
      );

      expect(result.source).toBe('fallback');
      expect(result.error).toBe('RPC error');
    });
  });

  describe('fetchNativeBalance — Solana chains', () => {
    it('fetches Solana balance via JSON-RPC getBalance', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: { value: 1500000000 },
        }),
      });

      const result = await fetchNativeBalance(
        '7xKXtg2CW87d97TXJSDpbD5DifN6C6UJGiDW7fV8T2nF',
        'solana'
      );

      expect(result.symbol).toBe('SOL');
      expect(result.source).toBe('rpc');
      expect(result.balance).toBe('1500000000');

      global.fetch = originalFetch;
    });

    it('fetches Solana devnet balance', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: { value: 500000000 },
        }),
      });

      const result = await fetchNativeBalance(
        '7xKXtg2CW87d97TXJSDpbD5DifN6C6UJGiDW7fV8T2nF',
        'solana-devnet'
      );

      expect(result.symbol).toBe('SOL');
      expect(result.source).toBe('rpc');

      global.fetch = originalFetch;
    });

    it('returns fallback on Solana RPC error', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { message: 'Invalid params' },
        }),
      });

      const result = await fetchNativeBalance(
        '7xKXtg2CW87d97TXJSDpbD5DifN6C6UJGiDW7fV8T2nF',
        'solana'
      );

      expect(result.source).toBe('fallback');
      expect(result.error).toBeDefined();

      global.fetch = originalFetch;
    });
  });

  describe('fetchNativeBalance — Aptos chains', () => {
    it('fetches Aptos balance via REST API', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            coin: { value: '500000000' },
          },
        }),
      });

      const result = await fetchNativeBalance(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        'aptos'
      );

      expect(result.symbol).toBe('APT');
      expect(result.source).toBe('rpc');
      expect(result.balance).toBe('500000000');

      global.fetch = originalFetch;
    });

    it('returns zero balance for 404 (new account)', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await fetchNativeBalance(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        'aptos'
      );

      expect(result.balance).toBe('0');
      expect(result.source).toBe('rpc');

      global.fetch = originalFetch;
    });

    it('returns fallback on Aptos API failure', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await fetchNativeBalance(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        'aptos'
      );

      expect(result.source).toBe('fallback');
      expect(result.error).toBeDefined();

      global.fetch = originalFetch;
    });
  });

  describe('fetchNativeBalance — unknown chain', () => {
    it('returns fallback for unsupported chain', async () => {
      const result = await fetchNativeBalance(
        '0x3333333333333333333333333333333333333333',
        'unknown-chain'
      );

      expect(result.symbol).toBe('UNKNOWN');
      expect(result.source).toBe('fallback');
      expect(result.error).toContain('Unknown chain');
    });
  });
});
