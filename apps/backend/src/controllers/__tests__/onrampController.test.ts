import type { Request, Response, NextFunction } from 'express';
import { getOnrampQuotes, createOnrampUrl } from '../onrampController';

// Mock prisma and provider services
jest.mock('../../lib/prisma', () => ({
  prisma: {
    fiatOrder: {
      create: jest.fn().mockResolvedValue({ id: 'test-order-id' }),
    },
  },
}));

jest.mock('../../lib/onramp', () => ({
  OnrampService: {
    generateSignedUrl: jest.fn().mockReturnValue('https://onramp.money/buy?signed'),
    mapNetwork: jest.fn((key: string) => key),
  },
}));

jest.mock('../../lib/moonpay', () => ({
  MoonPayService: {
    generateSignedUrl: jest.fn().mockReturnValue('https://buy.moonpay.com?signed'),
  },
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the global fetch for Binance rate lookups
const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

function mockRequest(query?: Record<string, string>, body?: Record<string, unknown>): Partial<Request> {
  return { query: query ?? {}, body: body ?? {}, params: {} } as Partial<Request>;
}

function mockResponse(): { res: Partial<Response>; statusFn: jest.Mock; jsonFn: jest.Mock } {
  const jsonFn = jest.fn();
  const statusFn = jest.fn().mockReturnValue({ json: jsonFn });
  return {
    res: {
      json: jsonFn,
      status: statusFn,
    } as Partial<Response>,
    statusFn,
    jsonFn,
  };
}

const noop: NextFunction = () => {};

describe('getOnrampQuotes', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Default: Binance returns ETH = 2500 USDT
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ price: '2500.00' }),
    });
  });

  it('returns 400 when fiatAmount is missing', async () => {
    const { res, statusFn, jsonFn } = mockResponse();
    await getOnrampQuotes(
      mockRequest({ fiatCurrency: 'USD', cryptoToken: 'ETH' }) as Request,
      res as Response,
      noop,
    );
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'fiatAmount is required' });
  });

  it('returns 400 when fiatCurrency is missing', async () => {
    const { res, statusFn, jsonFn } = mockResponse();
    await getOnrampQuotes(
      mockRequest({ fiatAmount: '100', cryptoToken: 'ETH' }) as Request,
      res as Response,
      noop,
    );
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'fiatCurrency is required' });
  });

  it('does not include stripe in quotes', async () => {
    const { res, jsonFn } = mockResponse();
    await getOnrampQuotes(
      mockRequest({ fiatAmount: '1000', fiatCurrency: 'USD', cryptoToken: 'ETH' }) as Request,
      res as Response,
      noop,
    );
    expect(jsonFn).toHaveBeenCalledTimes(1);
    const quotes = jsonFn.mock.calls[0][0].quotes;
    const providers = quotes.map((q: any) => q.provider);
    expect(providers).not.toContain('stripe');
    expect(providers).toContain('onramp_money');
    expect(providers).toContain('moonpay');
    expect(providers).toContain('transak');
  });

  it('includes fiatCurrency in each quote', async () => {
    const { res, jsonFn } = mockResponse();
    await getOnrampQuotes(
      mockRequest({ fiatAmount: '500', fiatCurrency: 'EUR', cryptoToken: 'ETH' }) as Request,
      res as Response,
      noop,
    );
    const quotes = jsonFn.mock.calls[0][0].quotes;
    for (const q of quotes) {
      expect(q.fiatCurrency).toBe('EUR');
    }
  });

  it('sorts quotes by best crypto amount (buy flow)', async () => {
    const { res, jsonFn } = mockResponse();
    await getOnrampQuotes(
      mockRequest({ fiatAmount: '1000', fiatCurrency: 'USD', cryptoToken: 'ETH', flow: 'buy' }) as Request,
      res as Response,
      noop,
    );
    const quotes = jsonFn.mock.calls[0][0].quotes;
    const amounts = quotes.map((q: any) => parseFloat(q.estimatedCryptoAmount));
    // Should be sorted descending (best rate first)
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i - 1]).toBeGreaterThanOrEqual(amounts[i]);
    }
  });
});

describe('createOnrampUrl', () => {
  it('rejects request without fiatCurrency and surfaces validation details', async () => {
    const { res, statusFn, jsonFn } = mockResponse();
    await createOnrampUrl(
      mockRequest(undefined, {
        userAddress: '0x1234567890abcdef1234567890abcdef12345678',
        fiatAmount: '100',
        cryptoToken: 'ETH',
        chainKey: 'ethereum',
        flow: 'buy',
      }) as Request,
      res as Response,
      noop,
    );
    // Should fail Zod validation since fiatCurrency is required (no default)
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation failed',
        details: expect.arrayContaining([
          expect.stringContaining('fiatCurrency'),
        ]),
      }),
    );
  });
});
