/**
 * useBalance Hook
 * React hook for fetching and caching blockchain balances
 * 
 * Features:
 * - Auto-refresh on wallet/chain changes
 * - Background refresh intervals
 * - Loading and error states
 * - USD price integration
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWalletStore } from '../stores/walletStore';
import { fetchNativeBalance, fetchERC20Balances, type BalanceResult, type TokenBalance } from '../utils/balanceFetcher';
import { getTokenMarketQuote } from '../utils/marketData';
import { getFiatExchangeRate } from '../utils/priceFeed';
import { useSettingsStore } from '../stores/settingsStore';
import { useShallow } from 'zustand/react/shallow';

export interface UseBalanceResult {
  nativeBalance: BalanceResult | null;
  tokenBalances: TokenBalance[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lastUpdated: number | null;
  fiatRate: number;
}

const REFRESH_INTERVAL_MS = 30000; // 30 seconds
const MIN_REFRESH_INTERVAL_MS = 5000; // 5 seconds minimum between refreshes

export function useBalance(autoRefresh: boolean = true): UseBalanceResult {
  const { address, activeChain, setBalance, setLoadingBalance } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      setBalance: state.setBalance,
      setLoadingBalance: state.setLoadingBalance,
    }))
  );
  
  const nativeCurrency = useSettingsStore((state) => state.nativeCurrency);
  
  const [nativeBalance, setNativeBalance] = useState<BalanceResult | null>(null);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [fiatRate, setFiatRate] = useState<number>(1.0);
  
  const lastFetchTime = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!address || !activeChain) {
      return;
    }

    const now = Date.now();
    if (now - lastFetchTime.current < MIN_REFRESH_INTERVAL_MS) {
      return;
    }
    lastFetchTime.current = now;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setLoadingBalance(true);
    setError(null);

    try {
      const chainKey = activeChain.key;

      // Fetch native balance and token balances in parallel
      const [native, tokens, fiatRate] = await Promise.all([
        fetchNativeBalance(address, chainKey),
        activeChain.type === 'evm' ? fetchERC20Balances(address, chainKey) : Promise.resolve([]),
        getFiatExchangeRate(nativeCurrency || 'USD'),
      ]);

      const marketQuote = await getTokenMarketQuote(activeChain.symbol || native.symbol);

      // Update state
      setNativeBalance(native);
      setTokenBalances(tokens);
      setFiatRate(fiatRate);
      setLastUpdated(Date.now());

      // Calculate Fiat value and update wallet store
      if (native.balanceFormatted && marketQuote) {
        const balanceNum = parseFloat(native.balanceFormatted);
        const fiatValue = (balanceNum * marketQuote.price * fiatRate).toFixed(2);
        setBalance(native.balanceFormatted, fiatValue);
      } else {
        setBalance(native.balanceFormatted, '0.00');
      }

      if (native.error) {
        setError(native.error);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch balance';
      setError(errorMessage);
      setBalance('0.000', '0.00');
    } finally {
      setIsLoading(false);
      setLoadingBalance(false);
    }
  }, [address, activeChain, setBalance, setLoadingBalance, nativeCurrency]);
  // Initial fetch on mount and when wallet/chain changes
  useEffect(() => {
    if (address && activeChain) {
      refresh();
    } else {
      setNativeBalance(null);
      setTokenBalances([]);
      setBalance('0.000', '0.00');
    }
  }, [address, activeChain?.key, refresh, setBalance]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || !address || !activeChain) {
      return;
    }

    const intervalId = setInterval(() => {
      refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [autoRefresh, address, activeChain, refresh]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    nativeBalance,
    tokenBalances,
    isLoading,
    error,
    refresh,
    lastUpdated,
    fiatRate,
  };
}

export function useTokenBalances(chainKey?: string): {
  tokens: TokenBalance[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const { address, activeChain } = useWalletStore();
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetChain = chainKey || activeChain?.key;
  const chainType = activeChain?.type;

  const refresh = useCallback(async () => {
    if (!address || !targetChain) {
      return;
    }

    // Only fetch ERC20 tokens for EVM chains
    if (chainType !== 'evm') {
      setTokens([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const fetchedTokens = await fetchERC20Balances(address, targetChain);
      setTokens(fetchedTokens);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch token balances';
      setError(errorMessage);
      setTokens([]);
    } finally {
      setIsLoading(false);
    }
  }, [address, targetChain, chainType]);
  useEffect(() => {
    if (address && targetChain && chainType === 'evm') {
      refresh();
    } else {
      setTokens([]);
    }
  }, [address, targetChain, chainType, refresh]);

  return {
    tokens,
    isLoading,
    error,
    refresh,
  };
}

export default useBalance;
