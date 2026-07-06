import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createFallbackQuoteMap,
  getTokenMarketData,
  getCachedTokenMarketQuote,
  type MarketQuote,
  type MarketQuoteMap,
} from '../utils/marketData';
import { marketStreamer } from '../utils/marketStreamer';

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
  options: { throttleMs?: number } = {}
): UseMarketDataResult {
  const { throttleMs = 1000 } = options;
  const symbolsKey = symbols.join('|');
  const normalizedSymbols = useMemo(
    () => Array.from(new Set(symbols.flatMap((symbol) => {
      const s = symbol.trim().toUpperCase();
      return s ? [s] : [];
    }))).sort(),
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- `symbols` is a fresh array each render; symbolsKey captures its contents, which is the real dependency.
    [symbolsKey]
  );

  const [quotes, setQuotes] = useState<MarketQuoteMap>(() => createFallbackQuoteMap(normalizedSymbols));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // When the requested symbols change, reset to fallback quotes during render
  // (createFallbackQuoteMap is pure) instead of syncing through an effect.
  const normalizedKey = normalizedSymbols.join('|');
  const [prevSymbolsKey, setPrevSymbolsKey] = useState(normalizedKey);
  if (normalizedKey !== prevSymbolsKey) {
    setPrevSymbolsKey(normalizedKey);
    setQuotes(createFallbackQuoteMap(normalizedSymbols));
    setLastUpdated(null);
  }

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

    // Bootstrap initial REST fetch
    void refresh();

    // Subscribe to WebSocket streams
    marketStreamer.subscribe(normalizedSymbols);

    // Throttle UI updates to prevent 60fps drops
    const lastUpdateTimes: Record<string, number> = {};

    const handleUpdate = (symbol: string, price: number, change24h: number | null) => {
      if (!normalizedSymbols.includes(symbol)) return;

      const now = Date.now();
      const last = lastUpdateTimes[symbol] || 0;

      if (now - last > throttleMs) {
        lastUpdateTimes[symbol] = now;
        setQuotes(prev => {
          const existing = prev[symbol];
          if (!existing) return prev;
          
          return {
            ...prev,
            [symbol]: {
              ...existing,
              price,
              change24h,
              lastUpdated: now,
              source: 'binance',
              isStale: false,
            }
          };
        });
      }
    };

    marketStreamer.addListener(handleUpdate);

    return () => {
      marketStreamer.removeListener(handleUpdate);
      marketStreamer.unsubscribe(normalizedSymbols);
    };
  }, [normalizedSymbols, refresh, throttleMs]);

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
