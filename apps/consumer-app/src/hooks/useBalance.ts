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
import {
  fetchNativeBalance,
  fetchTokenBalancesForChain,
  type BalanceResult,
  type TokenBalance,
} from '../utils/balanceFetcher';
import { getTokenMarketQuote } from '../utils/marketData';
import { getFiatExchangeRate } from '../utils/priceFeed';
import { useSettingsStore } from '../stores/settingsStore';
import { useShallow } from 'zustand/react/shallow';

export interface UseBalanceResult {
  nativeBalance: BalanceResult | null;
  tokenBalances: TokenBalance[];
  isLoading: boolean;
  error: string | null;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
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
  const lastAddressRef = useRef<string | null>(null);
  const lastChainRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // `silent` refreshes update data without flipping the loading skeleton.
  // Background interval + pull-to-refresh use silent mode; only the initial
  // load and a wallet/chain switch (isNewContext) should show the skeleton,
  // otherwise the card flashes to skeleton every 30s auto-refresh cycle.
  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!address || !activeChain) {
      return;
    }

    const now = Date.now();
    const isNewContext = lastAddressRef.current !== address || lastChainRef.current !== activeChain.key;
    if (!isNewContext && now - lastFetchTime.current < MIN_REFRESH_INTERVAL_MS) {
      return;
    }
    lastFetchTime.current = now;
    lastAddressRef.current = address;
    lastChainRef.current = activeChain.key;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Only surface the loading skeleton for the first load / context switch.
    const showLoading = isNewContext || !options?.silent;
    if (showLoading) {
      setIsLoading(true);
      setLoadingBalance(true);
    }
    setError(null);

    try {
      const chainKey = activeChain.key;

      // Fetch native balance and token balances in parallel
      const [native, tokens, fiatRate] = await Promise.all([
        fetchNativeBalance(address, chainKey),
        fetchTokenBalancesForChain(address, chainKey),
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
      if (showLoading) {
        setIsLoading(false);
        setLoadingBalance(false);
      }
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
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- key on activeChain.key (stable primitive), NOT the activeChain object. The object identity is unstable across store rehydration, so depending on it re-fires this fetch every render → balance card reload loop. The chain key is the real dependency; refresh reads the latest activeChain from its own closure.
  }, [address, activeChain?.key, setBalance]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || !address || !activeChain) {
      return;
    }

    const intervalId = setInterval(() => {
      // Silent: refresh data in the background without flashing the skeleton.
      refresh({ silent: true });
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
  const { address, activeChain, allChains } = useWalletStore();
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetChain = chainKey || activeChain?.key;

  const refresh = useCallback(async () => {
    if (!address || !targetChain) {
      setTokens([]);
      return;
    }

    // Resolve type for the *target* chain (not only activeChain) so the token
    // selector can load Stellar USDC / Solana SPL while browsing another key.
    const chains =
      typeof allChains === 'function' ? allChains() : [];
    const cfg =
      chains.find((c) => c.key === targetChain) ||
      (activeChain?.key === targetChain ? activeChain : null);
    const chainType = cfg?.type || activeChain?.type;
    if (!chainType || (chainType !== 'evm' && chainType !== 'svm' && chainType !== 'xlm')) {
      setTokens([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const fetchedTokens = await fetchTokenBalancesForChain(address, targetChain);
      setTokens(fetchedTokens);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch token balances';
      setError(errorMessage);
      setTokens([]);
    } finally {
      setIsLoading(false);
    }
  }, [address, activeChain, allChains, targetChain]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    tokens,
    isLoading,
    error,
    refresh,
  };
}

export default useBalance;
