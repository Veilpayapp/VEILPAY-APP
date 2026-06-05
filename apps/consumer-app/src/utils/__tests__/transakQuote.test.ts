const ORIGINAL_ENV = process.env;

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        transakApiKey: 'test-api-key',
        transakReferrerDomain: 'veilpay.app',
      },
    },
  },
}));

describe('transakQuote', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_TRANSAK_ENV: 'STAGING',
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = ORIGINAL_ENV;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('normalizes live quote payloads with string numbers and malformed fee rows', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          quoteId: 'quote_123',
          conversionPrice: '3200.5',
          marketConversionPrice: '3195.1',
          slippage: '0.025',
          fiatCurrency: 'usd',
          cryptoCurrency: 'eth',
          paymentMethod: 'credit_debit_card',
          fiatAmount: '100.25',
          cryptoAmount: '0.03125',
          isBuyOrSell: 'buy',
          network: 'ethereum',
          feeDecimal: '0.015',
          feeBreakdown: [
            { id: '', name: '', value: '1.5', ids: ['line_1', 2, 'line_2'] },
            { name: 'Network Fee', value: '2.75' },
            null,
            'not-an-object',
          ],
          nonce: '7',
          cryptoLiquidityProvider: 'transak',
          notes: ['fast', 1, 'verified'],
        },
      }),
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const { getTransakQuote, isLiveTransakQuote } = require('../transakQuote');

    const quote = await getTransakQuote({
      isBuyOrSell: 'BUY',
      fiatCurrency: 'USD',
      cryptoCurrency: 'ETH',
      network: 'ethereum',
      fiatAmount: 100.25,
      paymentMethod: 'credit_debit_card',
      quoteCountryCode: 'us',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isLiveTransakQuote(quote)).toBe(true);
    expect(quote).toMatchObject({
      source: 'live',
      quoteId: 'quote_123',
      conversionPrice: 3200.5,
      marketConversionPrice: 3195.1,
      slippage: 0.025,
      fiatCurrency: 'USD',
      cryptoCurrency: 'eth',
      paymentMethod: 'credit_debit_card',
      fiatAmount: 100.25,
      cryptoAmount: 0.03125,
      isBuyOrSell: 'BUY',
      network: 'ethereum',
      feeDecimal: 0.015,
      totalFee: 4.25,
      nonce: 7,
      cryptoLiquidityProvider: 'transak',
      notes: ['fast', 'verified'],
    });
    expect(quote.feeBreakdown).toEqual([
      {
        id: 'fee',
        name: 'Fee',
        value: 1.5,
        ids: ['line_1', 'line_2'],
      },
      {
        id: 'network_fee',
        name: 'Network Fee',
        value: 2.75,
      },
    ]);
  });

  it('falls back to calculated fees when the live response omits totalFee and breakdown data', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          quoteId: 'quote_456',
          conversionPrice: 3000,
          fiatCurrency: 'USD',
          cryptoCurrency: 'ETH',
          isBuyOrSell: 'BUY',
          network: 'ethereum',
          fiatAmount: 100,
          feeBreakdown: [],
        },
      }),
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;

    const { getTransakQuote } = require('../transakQuote');

    const quote = await getTransakQuote({
      isBuyOrSell: 'BUY',
      fiatCurrency: 'USD',
      cryptoCurrency: 'ETH',
      network: 'ethereum',
      fiatAmount: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(quote.totalFee).toBeCloseTo(4.0, 2);
    expect(quote.feeBreakdown).toEqual([
      { id: 'network_fee', name: 'Network Fee', value: 2.5 },
      { id: 'transak_fee', name: 'Transak Fee', value: 1.5 },
    ]);
    expect(Number.isNaN(quote.totalFee)).toBe(false);
  });
});
