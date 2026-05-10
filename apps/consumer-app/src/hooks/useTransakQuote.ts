import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTransakQuote, type TransakQuote, type TransakQuoteRequest } from '../utils/transakQuote';

export interface UseTransakQuoteOptions {
  enabled?: boolean;
  debounceMs?: number;
  preferCache?: boolean;
}

export interface UseTransakQuoteResult {
  quote: TransakQuote | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
}

function isRequestReady(request: TransakQuoteRequest | null): boolean {
  if (!request) {
    return false;
  }

  if (request.isBuyOrSell === 'BUY') {
    return typeof request.fiatAmount === 'number' && request.fiatAmount > 0;
  }

  return typeof request.cryptoAmount === 'number' && request.cryptoAmount > 0;
}

export function useTransakQuote(
  request: TransakQuoteRequest | null,
  options: UseTransakQuoteOptions = {}
): UseTransakQuoteResult {
  const { enabled = true, debounceMs = 400, preferCache = true } = options;
  const [quote, setQuote] = useState<TransakQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const requestVersionRef = useRef(0);

  const requestIsReady = useMemo(() => isRequestReady(request), [request]);

  const runRequest = useCallback(
    async (currentRequest: TransakQuoteRequest) => {
      const currentVersion = ++requestVersionRef.current;
      setIsLoading(true);
      setError(null);

      const nextQuote = await getTransakQuote(currentRequest, { preferCache });

      if (requestVersionRef.current !== currentVersion) {
        return;
      }

      setQuote(nextQuote);
      setLastUpdated(nextQuote.lastUpdated);
      setError(nextQuote.source === 'fallback' ? nextQuote.fallbackReason ?? null : null);
      setIsLoading(false);
    },
    [preferCache]
  );

  useEffect(() => {
    if (!enabled || !request || !requestIsReady) {
      requestVersionRef.current += 1;
      setQuote(null);
      setIsLoading(false);
      setError(null);
      setLastUpdated(null);
      return;
    }

    const timeoutId = setTimeout(() => {
      void runRequest(request);
    }, debounceMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [enabled, debounceMs, request, requestIsReady, runRequest]);

  const refresh = useCallback(async () => {
    if (!enabled || !request || !requestIsReady) {
      return;
    }

    await runRequest(request);
  }, [enabled, request, requestIsReady, runRequest]);

  return {
    quote,
    isLoading,
    error,
    lastUpdated,
    refresh,
  };
}

export default useTransakQuote;