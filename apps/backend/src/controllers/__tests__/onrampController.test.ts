import type { Request, Response, NextFunction } from 'express';
import { getOnrampQuotes, createOnrampUrl, getOnrampStatus } from '../onrampController';
import { createStatusToken } from '../../utils/onrampStatusToken';

// Mock prisma and provider services
jest.mock('../../lib/prisma', () => ({
  prisma: {
    fiatOrder: {
      create: jest.fn().mockResolvedValue({ id: 'test-order-id' }),
      findFirst: jest.fn(),
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

function mockRequestWithParams(params: Record<string, string>): Partial<Request> {
  return { params, query: {}, body: {} } as Partial<Request>;
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

  it('ranks the lowest-cost provider as BEST RATE for the sell flow', async () => {
    const { res, jsonFn } = mockResponse();
    await getOnrampQuotes(
      mockRequest({ fiatAmount: '5000', fiatCurrency: 'INR', cryptoToken: 'USDT', flow: 'sell' }) as Request,
      res as Response,
      noop,
    );
    const quotes = jsonFn.mock.calls[0][0].quotes;

    // onramp_money has the lowest spread + fee, so for a sell it is the
    // cheapest way to obtain the requested fiat and must rank first (BEST RATE).
    expect(quotes[0].provider).toBe('onramp_money');

    // The provider fee should be non-decreasing down the ranked list —
    // onramp_money (cheapest) first, moonpay (priciest) last.
    const fees = quotes.map((q: any) => parseFloat(q.providerFee));
    for (let i = 1; i < fees.length; i++) {
      expect(fees[i - 1]).toBeLessThanOrEqual(fees[i]);
    }
    // Sanity: every quote reports a finite positive crypto amount.
    for (const q of quotes) {
      expect(parseFloat(q.estimatedCryptoAmount)).toBeGreaterThan(0);
    }
  });

  it('makes a worse spread cost MORE crypto on sell (direction correct)', async () => {
    const { res, jsonFn } = mockResponse();
    await getOnrampQuotes(
      mockRequest({ fiatAmount: '5000', fiatCurrency: 'INR', cryptoToken: 'USDT', flow: 'sell' }) as Request,
      res as Response,
      noop,
    );
    const quotes = jsonFn.mock.calls[0][0].quotes;
    const byProvider = Object.fromEntries(
      quotes.map((q: any) => [q.provider, parseFloat(q.estimatedCryptoAmount)]),
    );
    // moonpay (2.5% spread) is worse than onramp_money (1% spread); on a sell a
    // worse spread means you must part with MORE crypto for the same fiat.
    expect(byProvider.moonpay).toBeGreaterThan(byProvider.onramp_money);
    expect(byProvider.transak).toBeGreaterThan(byProvider.onramp_money);
  });

  it('does not leak the internal ranking key in the response', async () => {
    const { res, jsonFn } = mockResponse();
    await getOnrampQuotes(
      mockRequest({ fiatAmount: '1000', fiatCurrency: 'USD', cryptoToken: 'ETH', flow: 'buy' }) as Request,
      res as Response,
      noop,
    );
    const quotes = jsonFn.mock.calls[0][0].quotes;
    for (const q of quotes) {
      expect(q).not.toHaveProperty('_netValue');
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

  it('SEC-005: returns a statusToken alongside url and orderId on success', async () => {
    const { res, jsonFn } = mockResponse();
    await createOnrampUrl(
      mockRequest(undefined, {
        userAddress: '0x1234567890abcdef1234567890abcdef12345678',
        fiatAmount: '100',
        fiatCurrency: 'USD',
        cryptoToken: 'ETH',
        chainKey: 'ethereum',
        flow: 'buy',
      }) as Request,
      res as Response,
      noop,
    );
    expect(jsonFn).toHaveBeenCalled();
    const body = jsonFn.mock.calls[0][0];
    expect(body.orderId).toBe('test-order-id');
    expect(typeof body.statusToken).toBe('string');
    expect(body.statusToken.length).toBeGreaterThan(0);
    // Token must contain the separator between orderId and signature.
    expect(body.statusToken).toContain('.');
  });
});

describe('getOnrampStatus (SEC-005: signed token + minimized response)', () => {
  const { prisma } = require('../../lib/prisma') as { prisma: any };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order-uuid-123',
      orderId: 'order-uuid-123',
      provider: 'onramp_money',
      status: 'processing',
      flow: 'buy',
      fiatAmount: '100',
      fiatCurrency: 'USD',
      cryptoToken: 'ETH',
      cryptoAmount: '0.04',
      chainKey: 'ethereum',
      txHash: null,
      userAddress: '0xsecretwalletaddress',
      ...overrides,
    };
  }

  it('rejects a request without a valid token signature (401)', async () => {
    const { res, statusFn, jsonFn } = mockResponse();
    // A raw order UUID without a signature — the old attack vector.
    await getOnrampStatus(
      mockRequestWithParams({ id: 'order-uuid-123' }) as Request,
      res as Response,
      noop,
    );
    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'Invalid or expired status token' });
    expect(prisma.fiatOrder.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature (401)', async () => {
    const { res, statusFn } = mockResponse();
    // Real token for one order, but we tamper the signature.
    const token = createStatusToken('order-uuid-123');
    const [orderId, sig] = token.split('.');
    const tampered = `${orderId}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;
    await getOnrampStatus(
      mockRequestWithParams({ id: tampered }) as Request,
      res as Response,
      noop,
    );
    expect(statusFn).toHaveBeenCalledWith(401);
    expect(prisma.fiatOrder.findFirst).not.toHaveBeenCalled();
  });

  it('returns a minimized status for a valid token (no userAddress)', async () => {
    const order = makeOrder();
    prisma.fiatOrder.findFirst.mockResolvedValue(order);

    const { res, jsonFn } = mockResponse();
    const token = createStatusToken('order-uuid-123');

    await getOnrampStatus(
      mockRequestWithParams({ id: token }) as Request,
      res as Response,
      noop,
    );

    expect(prisma.fiatOrder.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: 'order-uuid-123' }, { orderId: 'order-uuid-123' }] },
    });
    const body = jsonFn.mock.calls[0][0];
    // Fields the consumer-app needs:
    expect(body.id).toBe('order-uuid-123');
    expect(body.orderId).toBe('order-uuid-123');
    expect(body.status).toBe('processing');
    expect(body.flow).toBe('buy');
    expect(body.fiatAmount).toBe('100');
    expect(body.fiatCurrency).toBe('USD');
    expect(body.cryptoToken).toBe('ETH');
    expect(body.cryptoAmount).toBe('0.04');
    expect(body.chainKey).toBe('ethereum');
    // SEC-005: userAddress MUST NOT be in the response.
    expect(body).not.toHaveProperty('userAddress');
    expect(body).not.toHaveProperty('walletAddress');
  });

  it('returns 404 when the order does not exist', async () => {
    prisma.fiatOrder.findFirst.mockResolvedValue(null);
    const { res, statusFn, jsonFn } = mockResponse();
    const token = createStatusToken('nonexistent-order');

    await getOnrampStatus(
      mockRequestWithParams({ id: token }) as Request,
      res as Response,
      noop,
    );

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'Order not found' });
  });
});
