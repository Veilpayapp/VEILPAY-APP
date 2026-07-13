import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TransactionRecord } from '../types/transactions';
import { fetchTransactionHistoryPage } from '../utils/transactionHistory';
import type { FiatGatewayProvider as SharedFiatGatewayProvider } from '../utils/fiatGateway';
import { isSppActivityRecord } from '../utils/stellarSpp/sppActivity';
import { useWalletStore } from './walletStore';

export type TransakFlow = 'buy' | 'sell';
export type FiatGatewayProvider = SharedFiatGatewayProvider;
export type TransakOrderStatus = 'initiated' | 'processing' | 'success' | 'failed';

export interface TransakOrderRecord {
  provider: FiatGatewayProvider;
  orderId?: string;
  walletAddress: string;
  flow: TransakFlow;
  status: TransakOrderStatus;
  fiatAmount?: string;
  fiatCurrency?: string;
  cryptoAmount?: string;
  cryptoCurrency?: string;
  network?: string;
  updatedAt: number;
}

export type OnrampOrderStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface OnrampOrderRecord {
  provider: FiatGatewayProvider;
  id: string; // Internal UUID
  orderId?: string; // Provider ID
  /**
   * SEC-005: opaque signed token required to poll `/api/v1/onramp/status/:token`.
   * Issued once from `POST /api/v1/onramp/url`. The raw order UUID is embedded
   * inside the token but never appears in status-poll URLs/logs.
   */
  statusToken?: string;
  walletAddress: string;
  userAddress: string;
  flow: 'buy' | 'sell';
  status: OnrampOrderStatus;
  fiatAmount: string;
  fiatCurrency: string;
  cryptoAmount?: string;
  cryptoToken: string;
  chainKey: string;
  txHash?: string;
  updatedAt: number;
}

/**
 * Dedupe history rows. Prefer local SPP summaries over raw chain rows when
 * they share a tx hash (private activity is the source of truth for pool ops).
 */
const dedupeTransactions = (transactions: TransactionRecord[]): TransactionRecord[] => {
  // Private-pool rows first so they win hash collisions.
  const ordered = [...transactions].sort((a, b) => {
    const aScore = isSppActivityRecord(a) ? 1 : 0;
    const bScore = isSppActivityRecord(b) ? 1 : 0;
    return bScore - aScore;
  });

  const seenHash = new Set<string>();
  const seenId = new Set<string>();
  const out: TransactionRecord[] = [];

  for (const transaction of ordered) {
    const hash = transaction.hash?.trim();
    const id = transaction.id?.trim();
    if (hash && seenHash.has(hash)) continue;
    if (id && seenId.has(id)) continue;
    if (hash) seenHash.add(hash);
    if (id) seenId.add(id);
    out.push(transaction);
  }

  return out;
};

export interface TransactionState {
  transactions: TransactionRecord[];
  transactionsCursor: string | null;
  hasMoreTransactions: boolean;
  isLoadingTransactions: boolean;
  transactionsError: string | null;
  latestTransakOrder: TransakOrderRecord | null;
  latestOnrampOrder: OnrampOrderRecord | null;

  setTransactions: (transactions: TransactionRecord[]) => void;
  addTransaction: (transaction: TransactionRecord) => void;
  fetchTransactions: (options?: {
    reset?: boolean;
    limit?: number;
    /** When true, do not flip isLoading if rows already exist (avoids Activity spam). */
    silent?: boolean;
  }) => Promise<void>;
  refreshTransactions: (options?: { silent?: boolean }) => Promise<void>;
  loadMoreTransactions: () => Promise<void>;
  setLatestTransakOrder: (order: TransakOrderRecord) => void;
  clearLatestTransakOrder: () => void;
  setLatestOnrampOrder: (order: OnrampOrderRecord) => void;
  clearLatestOnrampOrder: () => void;
  clearTransactions: () => void;
}

export const useTransactionStore = create<TransactionState>()(
  persist(
    (set, get) => ({
      transactions: [],
      transactionsCursor: null,
      hasMoreTransactions: true,
      isLoadingTransactions: false,
      transactionsError: null,
      latestTransakOrder: null,
      latestOnrampOrder: null,

      setTransactions: (transactions: TransactionRecord[]) => {
        const uniqueTransactions = dedupeTransactions(transactions).sort(
          (a, b) => b.timestamp - a.timestamp
        );
        set({ transactions: uniqueTransactions });
      },

      addTransaction: (transaction: TransactionRecord) => {
        set((state) => ({
          transactions: dedupeTransactions([transaction, ...state.transactions])
            .sort((a, b) => b.timestamp - a.timestamp),
        }));
      },

      setLatestTransakOrder: (order: TransakOrderRecord) => {
        set({
          latestTransakOrder: {
            ...order,
            provider: 'transak',
            updatedAt: order.updatedAt ?? Date.now(),
          },
        });
      },

      clearLatestTransakOrder: () => {
        set({ latestTransakOrder: null });
      },
      
      setLatestOnrampOrder: (order: OnrampOrderRecord) => {
        set({
          latestOnrampOrder: {
            ...order,
            provider: 'onramp_money',
            walletAddress: order.walletAddress || order.userAddress,
            userAddress: order.userAddress || order.walletAddress,
            updatedAt: order.updatedAt ?? Date.now(),
          },
        });
      },

      clearLatestOnrampOrder: () => {
        set({ latestOnrampOrder: null });
      },

      fetchTransactions: async ({
        reset = false,
        limit = 20,
        silent = false,
      }: { reset?: boolean; limit?: number; silent?: boolean } = {}) => {
        const { address, activeChain } = useWalletStore.getState();
        const {
          isLoadingTransactions,
          transactionsCursor,
          transactions,
        } = get();

        if (!address || !activeChain) {
          return;
        }
        // Allow reset (pull-to-refresh / chain change) to preempt a stuck load.
        // Non-reset calls still skip while a fetch is in flight.
        if (isLoadingTransactions && !reset) {
          return;
        }

        // Silent refresh keeps existing rows on screen (no Activity skeleton spam).
        const showLoading = !silent || transactions.length === 0;
        if (showLoading) {
          set({ isLoadingTransactions: true, transactionsError: null });
        } else {
          set({ transactionsError: null });
        }

        try {
          const page = await fetchTransactionHistoryPage({
            address,
            chainKey: activeChain.key,
            cursor: reset ? undefined : transactionsCursor || undefined,
            limit,
          });

          const localPrivatePoolTransactions = transactions.filter(isSppActivityRecord);
          const mergedTransactions = reset
            ? [...page.transactions, ...localPrivatePoolTransactions]
            : [...transactions, ...page.transactions];

          const normalizedTransactions = dedupeTransactions(mergedTransactions).sort(
            (a, b) => b.timestamp - a.timestamp
          );

          set({
            transactions: normalizedTransactions,
            transactionsCursor: page.nextCursor,
            hasMoreTransactions: page.hasMore,
            isLoadingTransactions: false,
            transactionsError: null,
          });
        } catch (error) {
          set({
            isLoadingTransactions: false,
            transactionsError:
              error instanceof Error ? error.message : 'Unable to load transaction history.',
          });
        }
      },

      refreshTransactions: async (opts?: { silent?: boolean }) => {
        await get().fetchTransactions({ reset: true, silent: opts?.silent === true });
      },

      loadMoreTransactions: async () => {
        const { hasMoreTransactions, isLoadingTransactions } = get();
        if (!hasMoreTransactions || isLoadingTransactions) {
          return;
        }

        await get().fetchTransactions({ reset: false });
      },

      clearTransactions: () => {
        const localPrivatePoolTransactions = get().transactions.filter(isSppActivityRecord);
        set({
          transactions: localPrivatePoolTransactions,
          transactionsCursor: null,
          hasMoreTransactions: true,
          transactionsError: null,
        });
      },
    }),
    {
      name: 'veilpay-transaction-storage',
      version: 2,
      // AsyncStorage (not SecureStore): activity lists exceed Android SecureStore
      // size limits (~2KB). Writes then fell back to AsyncStorage while reads
      // still returned a stale SecureStore blob — private SPP rows vanished.
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Keep private-pool rows first so they aren't dropped by the slice.
        transactions: (() => {
          const all = state.transactions;
          const privateRows = all.filter(isSppActivityRecord);
          const publicRows = all.filter((t) => !isSppActivityRecord(t));
          return dedupeTransactions([...privateRows, ...publicRows]).slice(0, 50);
        })(),
        latestOnrampOrder: state.latestOnrampOrder,
      }),
      migrate: (persistedState: unknown, fromVersion: number) => {
        // SEC-005: in-flight onramp orders created BEFORE the statusToken
        // was introduced (v1) have no `statusToken` and therefore cannot
        // be polled by `checkOrderStatus` (the route requires a signed
        // token and returns 401 for a raw UUID). Without this migrate,
        // pre-deploy persisted records deserialise as-is and the home
        // dashboard silently skips polling, leaving users without status
        // updates. Drop the stale order so the next onramp flow starts
        // clean — the alternative (an unauthenticated backfill endpoint)
        // is a larger blast radius and not justified at this stage.
        if (fromVersion < 2 && persistedState && typeof persistedState === 'object') {
          const state = persistedState as { latestOnrampOrder?: { statusToken?: string } | null };
          const order = state.latestOnrampOrder;
          if (order && !order.statusToken) {
            return { ...(persistedState as Record<string, unknown>), latestOnrampOrder: null };
          }
        }
        return persistedState as TransactionState;
      },
    }
  )
);

// Helper hooks
export const useTransactions = () => useTransactionStore((state) => state.transactions);
