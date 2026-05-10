import {
  calculateDepositFees,
  calculateWithdrawalFees,
  estimateCryptoAmount,
  estimateFiatPayout,
  getTransakApiKey,
  getTransakPricingBaseUrl,
  isTransakConfigured,
  type FiatCurrency,
  type FeeBreakdown,
} from './transak';

export type TransakQuoteDirection = 'BUY' | 'SELL';
export type TransakQuoteSource = 'live' | 'cache' | 'fallback';

export interface TransakQuoteBreakdownLine {
  id: string;
  name: string;
  value: number;
  ids?: string[];
}

export interface TransakQuoteRequest {
  isBuyOrSell: TransakQuoteDirection;
  fiatCurrency: FiatCurrency;
  cryptoCurrency: string;
  network: string;
  fiatAmount?: number;
  cryptoAmount?: number;
  paymentMethod?: string;
  quoteCountryCode?: string;
  referencePriceUsd?: number;
}

export interface TransakQuote {
  request: TransakQuoteRequest;
  requestKey: string;
  quoteId: string | null;
  conversionPrice: number;
  marketConversionPrice: number | null;
  slippage: number | null;
  fiatCurrency: FiatCurrency;
  cryptoCurrency: string;
  paymentMethod: string | null;
  fiatAmount: number | null;
  cryptoAmount: number | null;
  isBuyOrSell: TransakQuoteDirection;
  network: string;
  feeDecimal: number | null;
  totalFee: number;
  feeBreakdown: TransakQuoteBreakdownLine[];
  nonce: number | null;
  cryptoLiquidityProvider: string | null;
  notes: string[];
  source: TransakQuoteSource;
  isStale: boolean;
  lastUpdated: number;
  fallbackReason?: string;
}

type QuoteApiResponse = {
  quoteId?: unknown;
  conversionPrice?: unknown;
  marketConversionPrice?: unknown;
  slippage?: unknown;
  fiatCurrency?: unknown;
  cryptoCurrency?: unknown;
  paymentMethod?: unknown;
  fiatAmount?: unknown;
  cryptoAmount?: unknown;
  isBuyOrSell?: unknown;
  network?: unknown;
  feeDecimal?: unknown;
  totalFee?: unknown;
  feeBreakdown?: unknown;
  nonce?: unknown;
  cryptoLiquidityProvider?: unknown;
  notes?: unknown;
};

const CACHE_TTL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 12_000;

const cache = new Map<string, { quote: TransakQuote; expiresAt: number }>();
const inFlightRequests = new Map<string, Promise<TransakQuote>>();

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeRequest(request: TransakQuoteRequest): TransakQuoteRequest {
  return {
    ...request,
    fiatCurrency: request.fiatCurrency.toUpperCase() as FiatCurrency,
    cryptoCurrency: request.cryptoCurrency.trim().toUpperCase(),
    network: request.network.trim().toLowerCase(),
    paymentMethod: request.paymentMethod?.trim() || undefined,
    quoteCountryCode: request.quoteCountryCode?.trim().toUpperCase() || undefined,
    fiatAmount: typeof request.fiatAmount === 'number' && Number.isFinite(request.fiatAmount) ? request.fiatAmount : undefined,
    cryptoAmount: typeof request.cryptoAmount === 'number' && Number.isFinite(request.cryptoAmount) ? request.cryptoAmount : undefined,
    referencePriceUsd: typeof request.referencePriceUsd === 'number' && Number.isFinite(request.referencePriceUsd)
      ? request.referencePriceUsd
      : undefined,
  };
}

function buildRequestKey(request: TransakQuoteRequest): string {
  const normalized = normalizeRequest(request);

  return [
    normalized.isBuyOrSell,
    normalized.fiatCurrency,
    normalized.cryptoCurrency,
    normalized.network,
    normalized.fiatAmount ?? '',
    normalized.cryptoAmount ?? '',
    normalized.paymentMethod ?? '',
    normalized.quoteCountryCode ?? '',
  ].join('|');
}

function createZeroFees(): FeeBreakdown {
  return {
    networkFee: 0,
    transakFee: 0,
    transakFeePercent: 0,
    total: 0,
  };
}

function createFallbackFeeBreakdown(
  request: TransakQuoteRequest,
  fees: FeeBreakdown
): TransakQuoteBreakdownLine[] {
  if (request.isBuyOrSell === 'SELL') {
    return [
      { id: 'transak_fee', name: 'Transak Fee', value: fees.transakFee },
      { id: 'network_fee', name: 'Network Fee', value: fees.networkFee },
    ];
  }

  return [
    { id: 'network_fee', name: 'Network Fee', value: fees.networkFee },
    { id: 'transak_fee', name: 'Transak Fee', value: fees.transakFee },
  ];
}

function createFallbackQuote(request: TransakQuoteRequest, reason: string): TransakQuote {
  const normalized = normalizeRequest(request);
  const referencePriceUsd = normalized.referencePriceUsd ?? null;

  let fees = createZeroFees();
  let fiatAmount: number | null = null;
  let cryptoAmount: number | null = null;

  if (normalized.isBuyOrSell === 'BUY') {
    const amount = normalized.fiatAmount ?? 0;
    fees = calculateDepositFees(amount);
    fiatAmount = normalized.fiatAmount ?? null;
    cryptoAmount = referencePriceUsd && referencePriceUsd > 0
      ? estimateCryptoAmount(amount, referencePriceUsd, fees)
      : null;
  } else if (normalized.cryptoAmount !== undefined) {
    const amount = normalized.cryptoAmount;
    fees = referencePriceUsd && referencePriceUsd > 0
      ? calculateWithdrawalFees(amount, referencePriceUsd)
      : createZeroFees();
    cryptoAmount = amount;
    fiatAmount = referencePriceUsd && referencePriceUsd > 0
      ? estimateFiatPayout(amount, referencePriceUsd, fees)
      : null;
  }

  const feeBreakdown = createFallbackFeeBreakdown(normalized, fees);

  return {
    request: normalized,
    requestKey: buildRequestKey(normalized),
    quoteId: null,
    conversionPrice: referencePriceUsd ?? 0,
    marketConversionPrice: referencePriceUsd,
    slippage: null,
    fiatCurrency: normalized.fiatCurrency,
    cryptoCurrency: normalized.cryptoCurrency,
    paymentMethod: normalized.paymentMethod ?? null,
    fiatAmount,
    cryptoAmount,
    isBuyOrSell: normalized.isBuyOrSell,
    network: normalized.network,
    feeDecimal: fees.transakFeePercent / 100,
    totalFee: fees.total,
    feeBreakdown,
    nonce: null,
    cryptoLiquidityProvider: null,
    notes: [],
    source: 'fallback',
    isStale: true,
    lastUpdated: Date.now(),
    fallbackReason: reason,
  };
}

function normalizeFeeBreakdown(value: unknown, fallback: FeeBreakdown): TransakQuoteBreakdownLine[] {
  if (!Array.isArray(value)) {
    return createFallbackFeeBreakdown({ isBuyOrSell: 'BUY', fiatCurrency: 'USD', cryptoCurrency: 'ETH', network: 'ethereum' }, fallback);
  }

  const lines = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const row = entry as Record<string, unknown>;
      const name = toStringValue(row.name) ?? 'Fee';
      const id = toStringValue(row.id) ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const amount = toNumber(row.value);

      if (amount === null) {
        return null;
      }

      const ids = toStringArray(row.ids);
      return {
        id,
        name,
        value: amount,
        ...(ids.length > 0 ? { ids } : {}),
      } satisfies TransakQuoteBreakdownLine;
    })
    .filter((entry): entry is TransakQuoteBreakdownLine => Boolean(entry));

  if (lines.length === 0) {
    return createFallbackFeeBreakdown({ isBuyOrSell: 'BUY', fiatCurrency: 'USD', cryptoCurrency: 'ETH', network: 'ethereum' }, fallback);
  }

  return lines;
}

function toQuoteFromApi(request: TransakQuoteRequest, response: QuoteApiResponse): TransakQuote {
  const normalized = normalizeRequest(request);
  const fallbackFees = normalized.isBuyOrSell === 'SELL' && normalized.cryptoAmount !== undefined
    ? calculateWithdrawalFees(normalized.cryptoAmount, normalized.referencePriceUsd && normalized.referencePriceUsd > 0 ? normalized.referencePriceUsd : 0)
    : calculateDepositFees(normalized.fiatAmount ?? 0);

  return {
    request: normalized,
    requestKey: buildRequestKey(normalized),
    quoteId: toStringValue(response.quoteId),
    conversionPrice: toNumber(response.conversionPrice) ?? 0,
    marketConversionPrice: toNumber(response.marketConversionPrice),
    slippage: toNumber(response.slippage),
    fiatCurrency: (toStringValue(response.fiatCurrency)?.toUpperCase() as FiatCurrency) ?? normalized.fiatCurrency,
    cryptoCurrency: toStringValue(response.cryptoCurrency) ?? normalized.cryptoCurrency,
    paymentMethod: toStringValue(response.paymentMethod) ?? normalized.paymentMethod ?? null,
    fiatAmount: toNumber(response.fiatAmount),
    cryptoAmount: toNumber(response.cryptoAmount),
    isBuyOrSell: (toStringValue(response.isBuyOrSell)?.toUpperCase() as TransakQuoteDirection) ?? normalized.isBuyOrSell,
    network: toStringValue(response.network) ?? normalized.network,
    feeDecimal: toNumber(response.feeDecimal),
    totalFee: toNumber(response.totalFee) ?? normalizeFeeBreakdown(response.feeBreakdown, fallbackFees).reduce((sum, line) => sum + line.value, 0),
    feeBreakdown: normalizeFeeBreakdown(response.feeBreakdown, fallbackFees),
    nonce: toNumber(response.nonce),
    cryptoLiquidityProvider: toStringValue(response.cryptoLiquidityProvider),
    notes: toStringArray(response.notes),
    source: 'live',
    isStale: false,
    lastUpdated: Date.now(),
  };
}

async function readJsonWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Transak quote request failed with status ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildQuoteUrl(request: TransakQuoteRequest): URL {
  const normalized = normalizeRequest(request);
  const base = getTransakPricingBaseUrl();
  const url = new URL('/api/v1/pricing/public/quotes', base);

  url.searchParams.set('partnerApiKey', getTransakApiKey());
  url.searchParams.set('fiatCurrency', normalized.fiatCurrency);
  url.searchParams.set('cryptoCurrency', normalized.cryptoCurrency);
  url.searchParams.set('network', normalized.network);
  url.searchParams.set('isBuyOrSell', normalized.isBuyOrSell);

  if (typeof normalized.fiatAmount === 'number') {
    url.searchParams.set('fiatAmount', normalized.fiatAmount.toString());
  }

  if (typeof normalized.cryptoAmount === 'number') {
    url.searchParams.set('cryptoAmount', normalized.cryptoAmount.toString());
  }

  if (normalized.paymentMethod) {
    url.searchParams.set('paymentMethod', normalized.paymentMethod);
  }

  if (normalized.quoteCountryCode) {
    url.searchParams.set('quoteCountryCode', normalized.quoteCountryCode);
  }

  return url;
}

export async function getTransakQuote(
  request: TransakQuoteRequest,
  options: { preferCache?: boolean } = {}
): Promise<TransakQuote> {
  const normalized = normalizeRequest(request);
  const requestKey = buildRequestKey(normalized);
  const cached = cache.get(requestKey);

  if (options.preferCache !== false && cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.quote,
      source: cached.quote.source === 'fallback' ? 'fallback' : 'cache',
      isStale: cached.quote.source === 'fallback' ? true : false,
    };
  }

  const inFlight = inFlightRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const requestPromise = (async () => {
    if (!isTransakConfigured()) {
      return createFallbackQuote(normalized, 'Transak pricing is not configured');
    }

    if (normalized.isBuyOrSell === 'BUY') {
      if (typeof normalized.fiatAmount !== 'number' || normalized.fiatAmount <= 0) {
        return createFallbackQuote(normalized, 'Enter a valid fiat amount');
      }
    } else if (typeof normalized.cryptoAmount !== 'number' || normalized.cryptoAmount <= 0) {
      return createFallbackQuote(normalized, 'Enter a valid crypto amount');
    }

    try {
      const payload = (await readJsonWithTimeout(buildQuoteUrl(normalized).toString())) as { response?: QuoteApiResponse } & QuoteApiResponse;
      const response = payload.response ?? payload;
      const quote = toQuoteFromApi(normalized, response);

      cache.set(requestKey, {
        quote,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return quote;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Failed to load Transak quote';
      return createFallbackQuote(normalized, reason);
    }
  })();

  inFlightRequests.set(requestKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(requestKey);
  }
}

export function createFallbackTransakQuote(request: TransakQuoteRequest, reason = 'Using estimated fees'): TransakQuote {
  return createFallbackQuote(request, reason);
}

export function isLiveTransakQuote(quote: TransakQuote | null | undefined): boolean {
  return Boolean(quote && quote.source !== 'fallback');
}
