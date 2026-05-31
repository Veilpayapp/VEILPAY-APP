/**
 * Andrej Karpathy first-principles style unit tests for priceFeed.ts
 * Thoroughly covers primary fetches, rate-limit retries, dual fallbacks, and caching mechanisms.
 */

const mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage[key] || null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStorage[key];
  }),
  clear: jest.fn(async () => {
    for (const key in mockStorage) {
      delete mockStorage[key];
    }
  }),
}));

jest.mock('../timing', () => ({
  ...jest.requireActual('../timing'),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { sleep } from '../timing';
import {
  getTokenPrice,
  getETHPrice,
  convertTokenToUsd,
  formatUsdValue,
  formatLastUpdated,
  FALLBACK_PRICES,
  FALLBACK_ETH_PRICE,
} from '../priceFeed';

describe('priceFeed utility tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset cache store
    for (const key in mockStorage) {
      delete mockStorage[key];
    }
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('getTokenPrice', () => {
    it('successfully fetches from Binance (primary source) and caches the result', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          lastPrice: '3500.50',
          priceChangePercent: '2.5',
        }),
      });

      const result = await getTokenPrice('ETH');

      expect(result).toEqual({
        price: 3500.50,
        lastUpdated: expect.any(Number),
        source: 'binance',
        isStale: false,
        change24h: 2.5,
      });

      // Verify cached in AsyncStorage
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('@veilpay_price_ETH_price', '3500.5');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('@veilpay_price_ETH_timestamp', expect.any(String));
    });

    it('retries on Binance 429 rate limit and succeeds on subsequent try', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            lastPrice: '3500.50',
            priceChangePercent: '2.5',
          }),
        });

      const result = await getTokenPrice('ETH');

      expect(result.price).toBe(3500.50);
      expect(result.source).toBe('binance');
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(1000); // 1000ms base retry delay
    });

    it('fails Binance after maximum retries and falls back to CoinCap', async () => {
      // Binance fails multiple times
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        })
        // CoinCap fallback succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              priceUsd: '3480.20',
              changePercent24Hr: '-1.2',
            },
          }),
        });

      const result = await getTokenPrice('ETH');

      expect(result).toEqual({
        price: 3480.20,
        lastUpdated: expect.any(Number),
        source: 'coincap',
        isStale: false,
        change24h: -1.2,
      });

      expect(sleep).toHaveBeenCalledTimes(2); // Retried twice for Binance before giving up
    });

    it('falls back to local AsyncStorage cache if both APIs fail', async () => {
      // Seed the cache
      mockStorage['@veilpay_price_ETH_price'] = '3400.00';
      mockStorage['@veilpay_price_ETH_timestamp'] = (Date.now() - 60000).toString(); // 1 min ago (not stale)

      // Both API calls fail
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const result = await getTokenPrice('ETH');

      expect(result).toEqual({
        price: 3400.00,
        lastUpdated: expect.any(Number),
        source: 'cache',
        isStale: false,
        change24h: null,
      });
    });

    it('identifies cache as stale if last updated timestamp exceeds CACHE_DURATION', async () => {
      // Seed a stale cache (6 minutes ago)
      mockStorage['@veilpay_price_ETH_price'] = '3300.00';
      mockStorage['@veilpay_price_ETH_timestamp'] = (Date.now() - 6 * 60 * 1000).toString();

      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const result = await getTokenPrice('ETH');

      expect(result.price).toBe(3300.00);
      expect(result.source).toBe('cache');
      expect(result.isStale).toBe(true);
    });

    it('uses hardcoded fallback values if APIs fail and cache is empty', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const result = await getTokenPrice('ETH');

      expect(result).toEqual({
        price: FALLBACK_PRICES.ETH, // 3200
        lastUpdated: expect.any(Number),
        source: 'fallback',
        isStale: true,
        change24h: null,
      });
    });

    it('uses a standard fallback of 1.0 if both APIs and cache fail, and the symbol is unknown', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const result = await getTokenPrice('UNKNOWN');

      expect(result.price).toBe(1.0);
      expect(result.source).toBe('fallback');
      expect(result.isStale).toBe(true);
    });
  });

  describe('getETHPrice legacy wrapper', () => {
    it('successfully wraps getTokenPrice for backwards compatibility', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          lastPrice: '3200.00',
          priceChangePercent: '0.0',
        }),
      });

      const result = await getETHPrice();
      expect(result.price).toBe(3200.00);
      expect(FALLBACK_ETH_PRICE).toBe(3200);
    });
  });

  describe('convertTokenToUsd', () => {
    it('correctly converts token amount to USD based on live price', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          lastPrice: '150.00',
          priceChangePercent: '1.5',
        }),
      });

      const result = await convertTokenToUsd(5, 'SOL');

      expect(result.usdValue).toBe(750.00);
      expect(result.price).toBe(150.00);
      expect(result.priceData.source).toBe('binance');
    });

    it('supports string amounts', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          lastPrice: '10.00',
          priceChangePercent: '0.5',
        }),
      });

      const result = await convertTokenToUsd('2.5', 'APT');

      expect(result.usdValue).toBe(25.00);
      expect(result.price).toBe(10.00);
    });
  });

  describe('formatUsdValue', () => {
    it('formats a decimal number into premium USD currency display format', () => {
      expect(formatUsdValue(1234.56)).toBe('$1,234.56');
      expect(formatUsdValue(0.5)).toBe('$0.50');
    });
  });

  describe('formatLastUpdated', () => {
    it('returns "just now" for changes under a minute', () => {
      const now = Date.now();
      expect(formatLastUpdated(now - 10000)).toBe('just now');
    });

    it('returns "Xm ago" for changes under an hour', () => {
      const now = Date.now();
      expect(formatLastUpdated(now - 3 * 60 * 1000)).toBe('3m ago');
    });

    it('returns "Xh ago" for changes older than an hour', () => {
      const now = Date.now();
      expect(formatLastUpdated(now - 2 * 60 * 60 * 1000)).toBe('2h ago');
    });
  });
});
