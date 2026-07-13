/**
 * Veilpay Price Feed Utility
 * Fetches live token prices from public APIs with caching and error handling
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { sleep } from './timing';
import { formatFiat, type FiatCurrency } from './transak';

// Cache keys prefix
const CACHE_KEY_PREFIX = '@veilpay_price_';

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

// Fallback prices if API fails and no cache available
export const FALLBACK_PRICES: Record<string, number> = {
  ETH: 3200,
  XLM: 0.11,
  // pXLM is shielded XLM — same unit value for fiat estimates.
  PXLM: 0.11,
  SOL: 145,
  BNB: 580,
  MATIC: 0.72,
};

// Fallback fiat exchange rates (USD -> FIAT)
const FALLBACK_FIAT_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.5,
};

// API endpoints
const getBinanceUrl = (symbol: string) => `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol.toUpperCase()}USDT`;
const getCoinCapUrl = (id: string) => `https://api.coincap.io/v2/assets/${id.toLowerCase()}`;

// Map symbols to CoinCap IDs
const SYMBOL_TO_COINCAP_ID: Record<string, string> = {
  ETH: 'ethereum',
  XLM: 'stellar',
  SOL: 'solana',
  BNB: 'binance-coin',
  MATIC: 'polygon',
};

export interface PriceData {
  price: number;
  lastUpdated: number;
  source: 'binance' | 'coincap' | 'cache' | 'fallback';
  isStale: boolean;
  change24h?: number | null;
}

export interface PriceFeedResult {
  price: number;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  source: string;
  isStale: boolean;
}

/** Binance API retry config */
const BINANCE_MAX_RETRIES = 2;
const BINANCE_RETRY_BASE_DELAY_MS = 1000;

/**
 * Fetch price from Binance API
 */
async function fetchFromBinance(symbol: string): Promise<{ price: number; change24h: number | null; source: 'binance' }> {
  const url = getBinanceUrl(symbol);
  
  for (let attempt = 0; attempt <= BINANCE_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        if (!data?.lastPrice) throw new Error('Invalid Binance response format');

        return {
          price: parseFloat(data.lastPrice),
          change24h: typeof data.priceChangePercent === 'string' ? parseFloat(data.priceChangePercent) : null,
          source: 'binance',
        };
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
  throw new Error(`Binance API error: Data not received after retries`);
}

/**
 * Fetch price from CoinCap API
 */
async function fetchFromCoinCap(symbol: string): Promise<{ price: number; change24h: number | null; source: 'coincap' }> {
  const id = SYMBOL_TO_COINCAP_ID[symbol.toUpperCase()];
  if (!id) throw new Error(`No CoinCap ID for symbol ${symbol}`);
  
  const response = await fetch(getCoinCapUrl(id), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) throw new Error(`CoinCap API error: ${response.status}`);

  const data = await response.json();
  if (!data?.data?.priceUsd) throw new Error('Invalid CoinCap response format');

  return {
    price: parseFloat(data.data.priceUsd),
    change24h: typeof data.data.changePercent24Hr === 'string' ? parseFloat(data.data.changePercent24Hr) : null,
    source: 'coincap',
  };
}

/**
 * Cache management
 */
async function getCachedPrice(symbol: string): Promise<{ price: number; timestamp: number } | null> {
  try {
    const [price, timestamp] = await Promise.all([
      AsyncStorage.getItem(`${CACHE_KEY_PREFIX}${symbol}_price`),
      AsyncStorage.getItem(`${CACHE_KEY_PREFIX}${symbol}_timestamp`),
    ]);
    if (price && timestamp) return { price: parseFloat(price), timestamp: parseInt(timestamp, 10) };
  } catch (e) {}
  return null;
}

async function cachePrice(symbol: string, price: number): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(`${CACHE_KEY_PREFIX}${symbol}_price`, price.toString()),
      AsyncStorage.setItem(`${CACHE_KEY_PREFIX}${symbol}_timestamp`, Date.now().toString()),
    ]);
  } catch (e) {}
}

/**
 * Get price for a specific token symbol
 */
export async function getTokenPrice(symbol: string): Promise<PriceData> {
  const normalizedSymbol = symbol.toUpperCase();
  const cached = await getCachedPrice(normalizedSymbol);
  
  // Try Binance
  try {
    const result = await fetchFromBinance(normalizedSymbol);
    await cachePrice(normalizedSymbol, result.price);
    return {
      price: result.price,
      lastUpdated: Date.now(),
      source: 'binance',
      isStale: false,
      change24h: result.change24h,
    };
  } catch (e) {}

  // Try CoinCap
  try {
    const result = await fetchFromCoinCap(normalizedSymbol);
    await cachePrice(normalizedSymbol, result.price);
    return {
      price: result.price,
      lastUpdated: Date.now(),
      source: 'coincap',
      isStale: false,
      change24h: result.change24h,
    };
  } catch (e) {}

  // Use Cache
  if (cached) {
    return {
      price: cached.price,
      lastUpdated: cached.timestamp,
      source: 'cache',
      isStale: Date.now() - cached.timestamp > CACHE_DURATION,
      change24h: null,
    };
  }

  // Fallback
  return {
    price: FALLBACK_PRICES[normalizedSymbol] || 1.0,
    lastUpdated: Date.now(),
    source: 'fallback',
    isStale: true,
    change24h: null,
  };
}

/** Compatibility wrapper for legacy code */
export const getETHPrice = () => getTokenPrice('ETH');
export const FALLBACK_ETH_PRICE = FALLBACK_PRICES.ETH;

export async function getFiatExchangeRate(currency: string): Promise<number> {
  if (currency === 'USD') return 1.0;
  
  try {
    const cached = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}fiat_${currency}`);
    if (cached) {
      const { rate, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION * 12) {
        return rate;
      }
    }
  } catch (e) {}

  try {
    const coincapIdMap: Record<string, string> = {
      EUR: 'euro',
      GBP: 'british-pound-sterling',
      INR: 'indian-rupee'
    };
    
    const id = coincapIdMap[currency];
    if (id) {
      const response = await fetch(`https://api.coincap.io/v2/rates/${id}`);
      if (response.ok) {
        const data = await response.json();
        if (data?.data?.rateUsd) {
          const rate = 1 / parseFloat(data.data.rateUsd);
          await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}fiat_${currency}`, JSON.stringify({ rate, timestamp: Date.now() }));
          return rate;
        }
      }
    }
  } catch (e) {}

  return FALLBACK_FIAT_RATES[currency] || 1.0;
}

export async function convertTokenToUsd(amount: number | string, symbol: string): Promise<{
  usdValue: number;
  price: number;
  priceData: PriceData;
}> {
  const priceData = await getTokenPrice(symbol);
  const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
  return {
    usdValue: amountNum * priceData.price,
    price: priceData.price,
    priceData,
  };
}

export function formatUsdValue(usdValue: number): string {
  return `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatFiatValue(usdValue: number, currencyCode: string = 'USD'): string {
  if (currencyCode === 'USD') return formatUsdValue(usdValue);
  
  // Use transak's formatFiat to properly format other currencies
  try {
    return formatFiat(usdValue, currencyCode as FiatCurrency);
  } catch (e) {
    // Fallback if Intl fails
    return `${usdValue.toFixed(2)} ${currencyCode}`;
  }
}

export function formatLastUpdated(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export default {
  getTokenPrice,
  getETHPrice,
  getFiatExchangeRate,
  convertTokenToUsd,
  formatUsdValue,
  formatFiatValue,
  formatLastUpdated,
  FALLBACK_PRICES,
};
