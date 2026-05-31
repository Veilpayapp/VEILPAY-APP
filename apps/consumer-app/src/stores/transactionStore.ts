import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TransactionRecord } from '../types/transactions';
import { fetchTransactionHistoryPage } from '../utils/transactionHistory';
import { secureStateStorage } from '../utils/secureStateStorage';
import type { FiatGatewayProvider as SharedFiatGatewayProvider } from '../utils/fiatGateway';
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

const dedupeTransactions = (transactions: TransactionRecord[]): TransactionRecord[] => {
  const seen = new Set<string>();

  return transactions.filter((transaction) => {
    const dedupeKey = transaction.id || transaction.hash;
    if (!dedupeKey || seen.has(dedupeKey)) {
      return false;
    }

    seen.add(dedupeKey);
    return true;
  });
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
  fetchTransactions: (options?: { reset?: boolean; limit?: number }) => Promise<void>;
  refreshTransactions: () => Promise<void>;
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

      fetchTransactions: async ({ reset = false, limit = 20 } = {}) => {
        const { address, activeChain } = useWalletStore.getState();
        const {
          isLoadingTransactions,
          transactionsCursor,
          transactions,
        } = get();

        if (!address || !activeChain || isLoadingTransactions) {
          return;
        }

        set({ isLoadingTransactions: true, transactionsError: null });

        try {
          const page = await fetchTransactionHistoryPage({
            address,
            chainKey: activeChain.key,
            cursor: reset ? undefined : transactionsCursor || undefined,
            limit,
          });

          const mergedTransactions = reset
            ? page.transactions
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

      refreshTransactions: async () => {
        await get().fetchTransactions({ reset: true });
      },

      loadMoreTransactions: async () => {
        const { hasMoreTransactions, isLoadingTransactions } = get();
        if (!hasMoreTransactions || isLoadingTransactions) {
          return;
        }

        await get().fetchTransactions({ reset: false });
      },

      clearTransactions: () => {
        set({
          transactions: [],
          transactionsCursor: null,
          hasMoreTransactions: true,
          transactionsError: null,
        });
      },
    }),
    {
      name: 'veilpay-transaction-storage',
      version: 1,
      storage: createJSONStorage(() => secureStateStorage),
      partialize: (state) => ({
        transactions: state.transactions.slice(0, 50),
        latestOnrampOrder: state.latestOnrampOrder,
      }),
    }
  )
);

// Helper hooks
export const useTransactions = () => useTransactionStore((state) => state.transactions);
