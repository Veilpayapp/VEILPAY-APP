import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createFallbackQuoteMap,
  getTokenMarketData,
  getCachedTokenMarketQuote,
  type MarketQuote,
  type MarketQuoteMap,
} from '../utils/marketData';

export interface UseMarketDataResult {
  quotes: MarketQuoteMap;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lastUpdated: number | null;
  getQuote: (symbol: string) => MarketQuote;
}

export function useMarketData(
  symbols: readonly string[],
  options: { autoRefresh?: boolean; refreshIntervalMs?: number } = {}
): UseMarketDataResult {
  const { autoRefresh = true, refreshIntervalMs = 60_000 } = options;
  const normalizedSymbols = useMemo(
    () => Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))).sort(),
    [symbols.join('|')]
  );

  const [quotes, setQuotes] = useState<MarketQuoteMap>(() => createFallbackQuoteMap(normalizedSymbols));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    setQuotes(createFallbackQuoteMap(normalizedSymbols));
    setLastUpdated(null);
  }, [normalizedSymbols.join('|')]);

  const refresh = useCallback(async () => {
    if (normalizedSymbols.length === 0) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const nextQuotes = await getTokenMarketData(normalizedSymbols);
      setQuotes(nextQuotes);

      const timestamps = Object.values(nextQuotes).map((quote) => quote.lastUpdated);
      const latestTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;
      setLastUpdated(latestTimestamp);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load market data');
    } finally {
      setIsLoading(false);
    }
  }, [normalizedSymbols]);

  useEffect(() => {
    if (normalizedSymbols.length === 0) {
      return;
    }

    void refresh();

    if (!autoRefresh) {
      return;
    }

    const intervalId = setInterval(() => {
      void refresh();
    }, refreshIntervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [autoRefresh, normalizedSymbols, refresh, refreshIntervalMs]);

  const getQuote = useCallback(
    (symbol: string) => {
      const normalized = symbol.trim().toUpperCase();
      return quotes[normalized] ?? getCachedTokenMarketQuote(normalized);
    },
    [quotes]
  );

  return {
    quotes,
    isLoading,
    error,
    refresh,
    lastUpdated,
    getQuote,
  };
}

export default useMarketData;
