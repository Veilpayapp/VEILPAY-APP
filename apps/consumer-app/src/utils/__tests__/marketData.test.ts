/**
 * Andrej Karpathy first-principles style unit tests for marketData.ts
 * Thoroughly covers token price fetch flows, rate limiting backoff, request deduplication, and caching strategies.
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

describe('marketData utility tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key in mockStorage) {
      delete mockStorage[key];
    }
    jest.resetModules();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('createFallbackQuoteMap', () => {
    it('returns a correct fallback quote map with normalized symbols', () => {
      const { createFallbackQuoteMap } = require('../marketData');
      const map = createFallbackQuoteMap(['eth', '  sol  ', 'unknown_token']);

      expect(map.ETH).toBeDefined();
      expect(map.ETH.price).toBe(3200);
      expect(map.ETH.source).toBe('fallback');
      expect(map.ETH.isStale).toBe(true);

      expect(map.SOL).toBeDefined();
      expect(map.SOL.price).toBe(140);
      expect(map.SOL.source).toBe('fallback');
      expect(map.SOL.isStale).toBe(true);

      expect(map.UNKNOWN_TOKEN).toBeDefined();
      expect(map.UNKNOWN_TOKEN.price).toBe(0);
      expect(map.UNKNOWN_TOKEN.source).toBe('fallback');
      expect(map.UNKNOWN_TOKEN.isStale).toBe(true);
    });
  });

  describe('getTokenMarketQuote', () => {
    it('successfully resolves a single token quote from Binance', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { symbol: 'ETHUSDT', lastPrice: '3150.00', priceChangePercent: '-1.5' }
        ],
      });

      const { getTokenMarketQuote } = require('../marketData');
      const quote = await getTokenMarketQuote('ETH');

      expect(quote).toEqual({
        symbol: 'ETH',
        price: 3150.00,
        change24h: -1.5,
        lastUpdated: expect.any(Number),
        source: 'binance',
        isStale: false,
      });
    });

    it('falls back to default quote when single token fetch fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('API failure'));

      const { getTokenMarketQuote } = require('../marketData');
      const quote = await getTokenMarketQuote('ETH');

      expect(quote.price).toBe(3200);
      expect(quote.source).toBe('fallback');
      expect(quote.isStale).toBe(true);
    });
  });

  describe('getCachedTokenMarketQuote', () => {
    it('returns fallback quote initially when cache is completely empty', () => {
      const { getCachedTokenMarketQuote } = require('../marketData');
      const quote = getCachedTokenMarketQuote('ETH');

      expect(quote.price).toBe(3200);
      expect(quote.source).toBe('fallback');
      expect(quote.isStale).toBe(true);
    });

    it('returns cached quote after it has been populated in memory cache', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { symbol: 'ETHUSDT', lastPrice: '3450.00', priceChangePercent: '5.2' }
        ],
      });

      const { getTokenMarketData, getCachedTokenMarketQuote } = require('../marketData');
      await getTokenMarketData(['ETH']);

      const cachedQuote = getCachedTokenMarketQuote('ETH');
      expect(cachedQuote.price).toBe(3450.00);
      expect(cachedQuote.source).toBe('cache');
      expect(cachedQuote.isStale).toBe(false);
    });
  });

  describe('getTokenMarketData flows', () => {
    it('returns empty object if empty array of symbols is supplied', async () => {
      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData([]);
      expect(result).toEqual({});
    });

    it('loads fresh cached quotes from AsyncStorage without executing network fetch if preferCache is enabled', async () => {
      const now = Date.now();
      const cachedPayload = {
        ETH: {
          symbol: 'ETH',
          price: 3300.00,
          change24h: 2.0,
          lastUpdated: now - 60 * 1000, // 1 minute ago (fresh!)
          source: 'binance',
          isStale: false,
        }
      };
      mockStorage['@veilpay_market_data_cache_v1'] = JSON.stringify(cachedPayload);

      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData(['ETH'], { preferCache: true });

      expect(result.ETH.price).toBe(3300.00);
      expect(result.ETH.source).toBe('cache');
      expect(result.ETH.isStale).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('triggers network fetch if preferCache is true but cache items are stale', async () => {
      const now = Date.now();
      const cachedPayload = {
        ETH: {
          symbol: 'ETH',
          price: 3300.00,
          change24h: 2.0,
          lastUpdated: now - 10 * 60 * 1000, // 10 minutes ago (stale!)
          source: 'binance',
          isStale: false,
        }
      };
      mockStorage['@veilpay_market_data_cache_v1'] = JSON.stringify(cachedPayload);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { symbol: 'ETHUSDT', lastPrice: '3350.00', priceChangePercent: '1.5' }
        ],
      });

      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData(['ETH'], { preferCache: true });

      expect(result.ETH.price).toBe(3350.00);
      expect(result.ETH.source).toBe('binance');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('handles Binance API 429 status code with exponential delay retry and eventual success', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            { symbol: 'ETHUSDT', lastPrice: '3180.00', priceChangePercent: '-0.5' }
          ],
        });

      const { sleep } = require('../timing');
      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData(['ETH']);

      expect(result.ETH.price).toBe(3180.00);
      expect(result.ETH.source).toBe('binance');
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    });

    it('gives up fetching after maximum retries are exhausted and falls back to storage cache/fallback', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });

      const { sleep } = require('../timing');
      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData(['ETH']);

      expect(result.ETH.price).toBe(3200);
      expect(result.ETH.source).toBe('fallback');
      expect(sleep).toHaveBeenCalledTimes(2); // Retries 0 and 1 (max retry = 2)
    });

    it('throws error and falls back when non-429 error statuses are returned from Binance', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { sleep } = require('../timing');
      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData(['ETH']);

      expect(result.ETH.price).toBe(3200);
      expect(result.ETH.source).toBe('fallback');
      // Should retry even on non-429 statuses since any error is caught and retried until max retries
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent identical requests via inFlightRequests Map cache', async () => {
      let resolveRequest: any;
      const networkPromise = new Promise((resolve) => {
        resolveRequest = resolve;
      });

      global.fetch = jest.fn().mockImplementation(() => networkPromise);

      const { getTokenMarketData } = require('../marketData');

      const req1 = getTokenMarketData(['ETH', 'SOL']);
      const req2 = getTokenMarketData(['ETH', 'SOL']);

      resolveRequest({
        ok: true,
        status: 200,
        json: async () => [
          { symbol: 'ETHUSDT', lastPrice: '3250.00', priceChangePercent: '1.2' },
          { symbol: 'SOLUSDT', lastPrice: '142.00', priceChangePercent: '-0.8' }
        ],
      });

      const [res1, res2] = await Promise.all([req1, req2]);

      expect(res1.ETH.price).toBe(3250.00);
      expect(res2.ETH.price).toBe(3250.00);
      expect(res1.SOL.price).toBe(142.00);
      expect(res2.SOL.price).toBe(142.00);

      // Verify that fetch was only called once for both requests
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('safely resolves hardcoded stablecoin prices if they fail to be mapped or fetched', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { symbol: 'ETHUSDT', lastPrice: '3250.00', priceChangePercent: '1.2' }
          // USDC, USDT, and DAI tickers are completely missing
        ],
      });

      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData(['ETH', 'USDC', 'USDT', 'DAI']);

      expect(result.ETH.price).toBe(3250.00);
      expect(result.USDC.price).toBe(1);
      expect(result.USDC.change24h).toBe(0);
      expect(result.USDC.source).toBe('binance');

      expect(result.USDT.price).toBe(1);
      expect(result.USDT.source).toBe('binance'); // standard fallback sets binance as source

      expect(result.DAI.price).toBe(1);
      expect(result.DAI.change24h).toBe(0);
      expect(result.DAI.source).toBe('binance');
    });

    it('recovers gracefully from JSON corruption inside cached AsyncStorage payload', async () => {
      mockStorage['@veilpay_market_data_cache_v1'] = 'corrupted-payload{[';
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData(['ETH']);

      expect(result.ETH.price).toBe(3200);
      expect(result.ETH.source).toBe('fallback');
      expect(result.ETH.isStale).toBe(true);
    });

    it('ignores corrupted cached quotes with invalid structures during cache load', async () => {
      const badCachedPayload = {
        ETH: {
          symbol: 'ETH',
          // price is missing
          change24h: 'invalid-string',
        }
      };
      mockStorage['@veilpay_market_data_cache_v1'] = JSON.stringify(badCachedPayload);
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData(['ETH']);

      expect(result.ETH.price).toBe(3200); // Successfully fell back due to cache line filter ignoring it
    });

    it('falls back to cache quote even if cache quote is marked as fallback', async () => {
      const now = Date.now();
      const fallbackCachedPayload = {
        ETH: {
          symbol: 'ETH',
          price: 3200,
          change24h: null,
          lastUpdated: now,
          source: 'fallback',
          isStale: true,
        }
      };
      mockStorage['@veilpay_market_data_cache_v1'] = JSON.stringify(fallbackCachedPayload);
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const { getTokenMarketData } = require('../marketData');
      const result = await getTokenMarketData(['ETH']);

      expect(result.ETH.price).toBe(3200);
      expect(result.ETH.source).toBe('fallback');
      expect(result.ETH.isStale).toBe(true);
    });
  });
});
