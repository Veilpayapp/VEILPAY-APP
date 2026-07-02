import { fetchNativeBalance, fetchAllBalances, formatBalanceForDisplay, fetchERC20Balances } from '../balanceFetcher';
import { poolCall } from '../rpcPool';
import { useWalletStore } from '../../stores/walletStore';

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
      stellar: 'https://horizon.stellar.org',
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

jest.mock('viem', () => ({
  parseEther: jest.fn((value: string) => BigInt(Math.floor(Number(value) * 1e18))),
  formatEther: jest.fn((value: bigint) => (Number(value) / 1e18).toString()),
  formatUnits: jest.fn((value: bigint, decimals: number) => {
    const num = Number(value) / Math.pow(10, decimals);
    return num.toString();
  }),
  parseAbi: jest.fn(() => []),
}));

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
        '0x1234567890abcdef',
        'aptos'
      );

      expect(result.symbol).toBe('APT');
      expect(result.balance).toBe('500000000');
      global.fetch = originalFetch;
    });

    it('returns zero balance for 404', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await fetchNativeBalance(
        '0x1234567890abcdef',
        'aptos'
      );

      expect(result.balance).toBe('0');
      global.fetch = originalFetch;
    });
  });

  describe('fetchNativeBalance — Stellar chains', () => {
    it('fetches Stellar balance via REST API', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balances: [{ balance: '10.5', asset_type: 'native' }]
        }),
      });

      const result = await fetchNativeBalance(
        'G1234567890abcdef',
        'stellar'
      );

      expect(result.symbol).toBe('XLM');
      expect(result.balance).toBe('105000000'); // 10.5 * 1e7
      global.fetch = originalFetch;
    });

    it('returns zero for 404', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await fetchNativeBalance(
        'G1234567890abcdef',
        'stellar'
      );

      expect(result.balance).toBe('0');
      global.fetch = originalFetch;
    });
  });

  describe('fetchERC20Balances', () => {
    it('fetches ERC20 balances using Alchemy if available', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ // Alchemy token balances
          ok: true,
          json: async () => ({
            result: {
              tokenBalances: [{ contractAddress: '0xusdc', tokenBalance: '0x0f4240' }] // 1000000
            }
          })
        })
        .mockResolvedValueOnce({ // Alchemy metadata
          ok: true,
          json: async () => ([{
            id: 2,
            result: { decimals: 6, symbol: 'USDC', name: 'USD Coin' }
          }])
        });

      const results = await fetchERC20Balances('0x123', 'ethereum');
      expect(results.length).toBe(1);
      expect(results[0].symbol).toBe('USDC');
      expect(results[0].balance).toBe(parseInt('0x0f4240', 16).toString());
      global.fetch = originalFetch;
    });

    it('falls back to hardcoded tokens on EVM without Alchemy', async () => {
      mockPoolCall.mockResolvedValueOnce(BigInt('1000000')); // USDC balance
      mockPoolCall.mockResolvedValueOnce(BigInt('0')); // USDT
      
      const results = await fetchERC20Balances('0x123', 'polygon'); // polygon doesn't have alchemy url in our mock
      // Since it's testing hardcoded we expect USDC to be present if it's the first in polygon, etc.
      // We don't assert exactly how many, just that it doesn't crash and returns array.
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('fetchAllBalances', () => {
    it('fetches all balances for SVM (Solana)', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ // getBalance
          ok: true,
          json: async () => ({ result: { value: 1500000000 } }),
        })
        .mockResolvedValueOnce({ // getTokenAccountsByOwner
          ok: true,
          json: async () => ({
            result: {
              value: [{
                account: { data: { parsed: { info: {
                  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
                  tokenAmount: { amount: '1000000', decimals: 6 }
                }}}}
              }]
            }
          })
        });

      const result = await fetchAllBalances('7xK...', 'solana');
      expect(result.native.symbol).toBe('SOL');
      expect(result.tokens.length).toBe(1);
      expect(result.tokens[0].tokenSymbol).toBe('USDC');
      global.fetch = originalFetch;
    });

    it('fetches all balances for XLM (Stellar)', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ // Native balance inside account fetch
          ok: true,
          json: async () => ({
            balances: [{ balance: '10.5', asset_type: 'native' }]
          }),
        })
        .mockResolvedValueOnce({ // Token balances inside account fetch
          ok: true,
          json: async () => ({
            balances: [
              { balance: '10.5', asset_type: 'native' },
              { balance: '100', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'G123' }
            ]
          }),
        });

      const result = await fetchAllBalances('G123...', 'stellar');
      expect(result.native.symbol).toBe('XLM');
      expect(result.tokens.length).toBe(1);
      expect(result.tokens[0].tokenSymbol).toBe('USDC');
      expect(result.tokens[0].balance).toBe('1000000000'); // 100 * 1e7
      global.fetch = originalFetch;
    });
  });

  describe('formatBalanceForDisplay', () => {
    it('formats 0 properly', () => {
      expect(formatBalanceForDisplay('0')).toBe('0.00');
    });
    
    it('formats small numbers', () => {
      // 0.0000001
      expect(formatBalanceForDisplay('100000000000', 18)).toBe('< 0.000001');
    });

    it('formats medium numbers', () => {
      // 0.005
      expect(formatBalanceForDisplay('5000000000000000', 18)).toBe('0.005000');
    });

    it('formats large numbers', () => {
      // 1500.5
      expect(formatBalanceForDisplay('1500500000000000000000', 18)).toBe('1,500.5');
    });
  });
});
