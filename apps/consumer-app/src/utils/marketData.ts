import AsyncStorage from '@react-native-async-storage/async-storage';
import { sleep } from './timing';

export type MarketQuoteSource = 'binance' | 'cache' | 'fallback';

export interface MarketQuote {
  symbol: string;
  price: number;
  change24h: number | null;
  lastUpdated: number;
  source: MarketQuoteSource;
  isStale: boolean;
}

export type MarketQuoteMap = Record<string, MarketQuote>;

type MarketSnapshot = {
  usd?: number;
  usd_24h_change?: number;
};

const CACHE_KEY = '@veilpay_market_data_cache_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

const BINANCE_SYMBOLS: Record<string, string> = {
  ETH: 'ETHUSDT',
  MATIC: 'MATICUSDT',
  SOL: 'SOLUSDT',
  USDC: 'USDCUSDT',
  DAI: 'DAIUSDT',
  BNB: 'BNBUSDT',
  AVAX: 'AVAXUSDT',
  TRX: 'TRXUSDT',
  XLM: 'XLMUSDT',
};

const FALLBACK_QUOTES: Record<string, { price: number; change24h: number | null }> = {
  ETH: { price: 3200, change24h: null },
  MATIC: { price: 0.9, change24h: null },
  SOL: { price: 140, change24h: null },
  BNB: { price: 580, change24h: null },
  AVAX: { price: 35, change24h: null },
  TRX: { price: 0.12, change24h: null },
  XLM: { price: 0.11, change24h: null },
  USDT: { price: 1, change24h: 0 },
  USDC: { price: 1, change24h: 0 },
  DAI: { price: 1, change24h: 0 },
};

const memoryCache: MarketQuoteMap = {};
let hasLoadedCache = false;
const inFlightRequests = new Map<string, Promise<MarketQuoteMap>>();

/**
 * Privacy-pool display tickers (e.g. pXLM) have no separate spot market —
 * they track the underlying public asset (XLM). Without this mapping,
 * confirm / unshield screens request "PXLM", miss Binance, and forever show
 * a stale fallback quote labeled "(cached)".
 */
export function resolveMarketQuoteSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s === 'PXLM') return 'XLM';
  return s;
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  return Array.from(
    new Set(
      symbols.flatMap((symbol) => {
        const s = resolveMarketQuoteSymbol(symbol);
        return s.length > 0 ? [s] : [];
      })
    )
  ).sort();
}

function buildRequestKey(symbols: readonly string[]): string {
  return normalizeSymbols(symbols).join('|');
}

function isFresh(quote: MarketQuote): boolean {
  if (quote.source === 'fallback') {
    return false;
  }

  return Date.now() - quote.lastUpdated < CACHE_TTL_MS;
}

function createFallbackQuote(symbol: string): MarketQuote {
  const normalized = symbol.trim().toUpperCase();
  const fallback = FALLBACK_QUOTES[normalized] ?? { price: 0, change24h: null };

  return {
    symbol: normalized,
    price: fallback.price,
    change24h: fallback.change24h,
    lastUpdated: Date.now(),
    source: 'fallback',
    isStale: true,
  };
}

export function createFallbackQuoteMap(symbols: readonly string[]): MarketQuoteMap {
  const map: MarketQuoteMap = {};

  for (const symbol of normalizeSymbols(symbols)) {
    map[symbol] = createFallbackQuote(symbol);
  }

  return map;
}

async function loadCache(): Promise<void> {
  if (hasLoadedCache) {
    return;
  }

  hasLoadedCache = true;

  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) {
      return;
    }

    const parsed = JSON.parse(cached) as MarketQuoteMap;
    for (const [symbol, quote] of Object.entries(parsed)) {
      if (!quote || typeof quote.price !== 'number') {
        continue;
      }

      memoryCache[symbol] = {
        symbol,
        price: quote.price,
        change24h: typeof quote.change24h === 'number' ? quote.change24h : null,
        lastUpdated: typeof quote.lastUpdated === 'number' ? quote.lastUpdated : Date.now(),
        source: quote.source === 'fallback' ? 'fallback' : 'cache',
        isStale: quote.source === 'fallback' ? true : !isFresh(quote),
      };
    }
  } catch (error) {
    console.warn('Failed to load market data cache:', error);
  }
}

async function persistCache(): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memoryCache));
  } catch (error) {
    console.warn('Failed to persist market data cache:', error);
  }
}

function mergeQuote(symbol: string, nextQuote: MarketQuote): MarketQuote {
  const normalized = symbol.trim().toUpperCase();
  const merged: MarketQuote = {
    symbol: normalized,
    price: nextQuote.price,
    change24h: nextQuote.change24h,
    lastUpdated: nextQuote.lastUpdated,
    source: nextQuote.source,
    isStale: nextQuote.isStale,
  };

  memoryCache[normalized] = merged;
  return merged;
}

export function updateLiveQuote(symbol: string, price: number, change24h: number | null): void {
  const normalized = symbol.trim().toUpperCase();
  mergeQuote(normalized, {
    symbol: normalized,
    price,
    change24h,
    lastUpdated: Date.now(),
    source: 'binance',
    isStale: false,
  });
}

/** Binance API retry config */
const BINANCE_MAX_RETRIES = 2;
const BINANCE_RETRY_BASE_DELAY_MS = 1000;

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

async function fetchFromBinance(symbols: readonly string[]): Promise<MarketQuoteMap> {
  const normalizedSymbols = normalizeSymbols(symbols);
  const binanceSymbols = normalizedSymbols
    .map((symbol) => BINANCE_SYMBOLS[symbol])
    .filter((s): s is string => Boolean(s));

  if (binanceSymbols.length === 0) {
    return createFallbackQuoteMap(normalizedSymbols);
  }

  // Binance API supports multiple symbols in one request via JSON array in query
  const symbolsJson = JSON.stringify(binanceSymbols);
  const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbolsJson)}`;

  let data: BinanceTicker[] | null = null;  for (let attempt = 0; attempt <= BINANCE_MAX_RETRIES; attempt++) {
    try {      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        data = (await response.json()) as BinanceTicker[];
        break;
      }

      if (response.status === 429 && attempt < BINANCE_MAX_RETRIES) {
        const delayMs = BINANCE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }

      throw new Error(`Binance API error: ${response.status}`);
    } catch (error) {
      if (attempt === BINANCE_MAX_RETRIES) throw error;
      const delayMs = BINANCE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await sleep(delayMs);
    }
  }

  if (!data) {
    throw new Error('Binance API error: Data not received after retries');
  }

  const now = Date.now();
  const quotes: MarketQuoteMap = {};
  const dataMap = new Map(data.map((item) => [item.symbol, item]));

  for (const symbol of normalizedSymbols) {
    const binanceSymbol = BINANCE_SYMBOLS[symbol];
    const ticker = binanceSymbol ? dataMap.get(binanceSymbol) : undefined;

    if (ticker && ticker.lastPrice) {
      const price = parseFloat(ticker.lastPrice);
      const change = parseFloat(ticker.priceChangePercent);

      quotes[symbol] = mergeQuote(symbol, {
        symbol,
        price,
        change24h: isNaN(change) ? null : change,
        lastUpdated: now,
        source: 'binance',
        isStale: false,
      });
      continue;    }

    // Special case for stablecoins if they failed or aren't mapped    if (['USDT', 'USDC', 'DAI'].includes(symbol)) {
       quotes[symbol] = mergeQuote(symbol, {
         symbol,
         price: 1,
         change24h: 0,
         lastUpdated: now,
         source: 'binance',
         isStale: false,
       });
       continue;
    }

    quotes[symbol] = memoryCache[symbol] ?? createFallbackQuote(symbol);
  }

  await persistCache();
  return quotes;
}

function getCachedQuotes(symbols: readonly string[]): MarketQuoteMap {
  const normalizedSymbols = normalizeSymbols(symbols);
  const quotes: MarketQuoteMap = {};

  for (const symbol of normalizedSymbols) {
    const cached = memoryCache[symbol];
    if (cached) {
      quotes[symbol] = {
        ...cached,
        source: cached.source === 'fallback' ? 'fallback' : 'cache',
        isStale: !isFresh(cached),
      };
      continue;
    }

    quotes[symbol] = createFallbackQuote(symbol);
  }

  return quotes;
}

export async function getTokenMarketData(
  symbols: readonly string[],
  options: { preferCache?: boolean } = {}
): Promise<MarketQuoteMap> {
  const normalizedSymbols = normalizeSymbols(symbols);

  if (normalizedSymbols.length === 0) {
    return {};
  }

  await loadCache();

  const cachedQuotes = getCachedQuotes(normalizedSymbols);
  const allFresh = normalizedSymbols.every((symbol) => {
    const cached = memoryCache[symbol];
    return Boolean(cached && isFresh(cached));
  });

  if (options.preferCache && allFresh) {
    return cachedQuotes;
  }

  const requestKey = buildRequestKey(normalizedSymbols);
  const inFlight = inFlightRequests.get(requestKey);

  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    try {
      const liveQuotes = await fetchFromBinance(normalizedSymbols);
      return liveQuotes;
    } catch (error) {
      console.warn('Failed to fetch live market data:', error);
      return cachedQuotes;
    } finally {
      inFlightRequests.delete(requestKey);
    }
  })();

  inFlightRequests.set(requestKey, request);
  return request;
}

export async function getTokenMarketQuote(
  symbol: string,
  options: { preferCache?: boolean } = {}
): Promise<MarketQuote> {
  const normalized = resolveMarketQuoteSymbol(symbol);
  const quotes = await getTokenMarketData([normalized], options);
  return quotes[normalized] ?? createFallbackQuote(normalized);
}

export function getCachedTokenMarketQuote(symbol: string): MarketQuote {
  const normalized = resolveMarketQuoteSymbol(symbol);
  const cached = memoryCache[normalized];

  if (cached) {
    return {
      ...cached,
      source: cached.source === 'fallback' ? 'fallback' : 'cache',
      isStale: !isFresh(cached),
    };
  }

  return createFallbackQuote(normalized);
}
