/* istanbul ignore file */
/**
 * Veilpay Balance Polling Hook
 * Polls wallet balance at regular intervals with automatic refresh and error handling
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useWalletStore, useWalletAddress, useActiveChain } from '../stores/walletStore';
import { fetchNativeBalance, BalanceResult } from '../utils/balanceFetcher';
import { getTokenMarketQuote } from '../utils/marketData';

export type BalancePollingStatus = {
 balance: string | null;
 balanceUsd: string | null;
 isLoading: boolean;
 error: string | null;
 lastUpdated: Date | null;
 isStale: boolean;
};

type UseBalancePollingOptions = {
 intervalMs?: number;
 enabled?: boolean;
 initialFetch?: boolean;
 onBalanceUpdate?: (balance: string, balanceUsd: string) => void;
 onError?: (error: Error) => void;
};

const DEFAULT_INTERVAL_MS = 30000;

export function useBalancePolling(options: UseBalancePollingOptions = {}) {
 const {
 intervalMs = DEFAULT_INTERVAL_MS,
 enabled = true,
 initialFetch = true,
 onBalanceUpdate,
 onError,
 } = options;

 const address = useWalletAddress();
 const activeChain = useActiveChain();
 const setBalance = useWalletStore((state) => state.setBalance);
 const setLoadingBalance = useWalletStore((state) => state.setLoadingBalance);

 const [status, setStatus] = useState<BalancePollingStatus>({
 balance: null,
 balanceUsd: null,
 isLoading: false,
 error: null,
 lastUpdated: null,
 isStale: true,
 });

 const isMountedRef = useRef(true);
 const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
 const isPollingRef = useRef(false);

 useEffect(() => {
 isMountedRef.current = true;
 return () => {
 isMountedRef.current = false;
 };
 }, []);

 const fetchBalance = useCallback(async () => {
 if (!address || !activeChain || !isMountedRef.current) {
 return;
 }

 if (!isMountedRef.current) return;

 setStatus((prev) => ({ ...prev, isLoading: true }));
 setLoadingBalance(true);

 try {
 const chainKey = activeChain.key;
 const result: BalanceResult = await fetchNativeBalance(address, chainKey);

 if (!isMountedRef.current) return;

 if (result.error) {
 setStatus({
 balance: null,
 balanceUsd: null,
 isLoading: false,
 error: result.error,
 lastUpdated: null,
 isStale: true,
 });
 setLoadingBalance(false);
 if (onError) {
 onError(new Error(result.error));
 }
 return;
 }

 let balanceUsd = '0.00';
 try {
 const marketQuote = await getTokenMarketQuote(activeChain.symbol || result.symbol);
 const balanceNum = parseFloat(result.balanceFormatted);
 balanceUsd = (balanceNum * marketQuote.price).toFixed(2);
 } catch {
 balanceUsd = '0.00';
 }

 if (!isMountedRef.current) return;

 const balance = result.balanceFormatted;
 setStatus({
 balance,
 balanceUsd,
 isLoading: false,
 error: null,
 lastUpdated: new Date(result.lastUpdated),
 isStale: result.source === 'fallback',
 });

 setBalance(balance, balanceUsd);
 setLoadingBalance(false);

 if (onBalanceUpdate) {
 onBalanceUpdate(balance, balanceUsd);
 }
 } catch (error) {
 if (!isMountedRef.current) return;

 const errorMessage = error instanceof Error ? error.message : 'Failed to fetch balance';
 setStatus({
 balance: null,
 balanceUsd: null,
 isLoading: false,
 error: errorMessage,
 lastUpdated: null,
 isStale: true,
 });
 setLoadingBalance(false);

 if (onError) {
 onError(error instanceof Error ? error : new Error(errorMessage));
 }
 }
 }, [address, activeChain, setBalance, setLoadingBalance, onBalanceUpdate, onError]);

 const start = useCallback(() => {
 if (isPollingRef.current || !enabled || !address || !activeChain) {
 return;
 }

 isPollingRef.current = true;

 if (initialFetch) {
 fetchBalance();
 }

 intervalIdRef.current = setInterval(fetchBalance, intervalMs);
 }, [enabled, address, activeChain, initialFetch, intervalMs, fetchBalance]);

 const stop = useCallback(() => {
 isPollingRef.current = false;
 if (intervalIdRef.current) {
 clearInterval(intervalIdRef.current);
 intervalIdRef.current = null;
 }
 }, []);

 const refresh = useCallback(async () => {
 await fetchBalance();
 }, [fetchBalance]);

 // PERF-001: pause balance polling in background to save battery + RPC quota.
 useEffect(() => {
 const onAppState = (next: AppStateStatus) => {
 if (next === 'active' && enabled && address && activeChain) {
 start();
 } else if (next !== 'active') {
 stop();
 }
 };
 const sub = AppState.addEventListener('change', onAppState);
 return () => sub.remove();
 }, [enabled, address, activeChain, start, stop]);

 useEffect(() => {
 if (enabled && address && activeChain && AppState.currentState === 'active') {
 start();
 } else {
 stop();
 }

 return () => {
 stop();
 };
 }, [enabled, address, activeChain, start, stop]);

 return {
 ...status,
 start,
 stop,
 refresh,
 };
}

export default useBalancePolling;
