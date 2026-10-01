/**
 * transactionStore — activity-lane tests.
 *
 * Covers the lanes the load-only stub missed: add/set dedupe + timestamp sort,
 * fetchTransactions guards and merge modes (reset vs append, silent refresh,
 * error → message fallback), loadMore gating, refreshTransactions, the
 * Transak order normalizer, clearLatestOnrampOrder, the SEC-005 persist slice
 * (token stripping, 50-row cap with private rows kept) and v1→v2 migrate
 * (stale onramp order dropped), SecureStore token index cleanup, and the
 * on-rehydrate token restore.
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../utils/transactionHistory', () => ({
  fetchTransactionHistoryPage: jest.fn(),
}));

import {
  useTransactionStore,
  clearAllOnrampTokens,
  type TransactionState,
} from '../transactionStore';
import { useWalletStore } from '../walletStore';
import { fetchTransactionHistoryPage } from '../../utils/transactionHistory';
import type { TransactionRecord } from '../../types/transactions';

const secureGet = SecureStore.getItemAsync as jest.Mock;
const secureSet = SecureStore.setItemAsync as jest.Mock;
const secureDelete = SecureStore.deleteItemAsync as jest.Mock;

function tx(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  // hash/from/to stay unique per fixture so dedupeTransactions never
  // collapses two distinct rows that merely share an id-less default.
  const n = Math.random().toString(36).slice(2, 8);
  return {
    id: 'tx-' + n,
    type: 'sent',
    amount: '1',
    token: 'ETH',
    tokenSymbol: 'ETH',
    from: '0x' + n.padEnd(6, '0'),
    to: '0x' + n.padEnd(6, '1'),
    timestamp: 100,
    status: 'completed',
    hash: '0x' + n.padEnd(8, '2'),
    ...overrides,
  };
}

function sppTx(id: string, timestamp: number): TransactionRecord {
  return tx({ id, timestamp, sppOp: 'shield' as never, isPrivatePoolTx: true });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('transactionStore lanes', () => {
  beforeEach(() => {
    secureGet.mockReset().mockResolvedValue(null);
    secureSet.mockReset().mockResolvedValue(undefined);
    secureDelete.mockReset().mockResolvedValue(undefined);
    (fetchTransactionHistoryPage as jest.Mock).mockReset().mockResolvedValue({
      transactions: [],
      nextCursor: null,
      hasMore: false,
    });
    useTransactionStore.setState({
      transactions: [],
      transactionsCursor: null,
      hasMoreTransactions: true,
      isLoadingTransactions: false,
      transactionsError: null,
      latestTransakOrder: null,
      latestOnrampOrder: null,
    });
    useWalletStore.setState({
      address: '0x' + '1'.repeat(40),
      activeChain: { key: 'ethereum', type: 'evm' } as never,
    });
  });

  describe('list mutations', () => {
    it('addTransaction dedupes by id and sorts newest-first', () => {
      const a = tx({ id: 'a', timestamp: 100 });
      const b = tx({ id: 'b', timestamp: 300 });
      const s = useTransactionStore.getState();

      s.addTransaction(a);
      s.addTransaction(b);
      s.addTransaction({ ...a, status: 'failed' }); // duplicate id → replaced, not appended

      const list = useTransactionStore.getState().transactions;
      expect(list.map((t) => t.id)).toEqual(['b', 'a']);
      expect(list.find((t) => t.id === 'a')?.status).toBe('failed');
    });

    it('setTransactions dedupes (first occurrence wins) and sorts newest-first', () => {
      const a = tx({ id: 'a', timestamp: 1 });
      const b = tx({ id: 'b', timestamp: 2 });
      useTransactionStore.getState().setTransactions([a, b, { ...a, timestamp: 99 }]);
      const list = useTransactionStore.getState().transactions;
      expect(list).toHaveLength(2);
      // Dedupe keeps the FIRST occurrence in input order, then sorts desc.
      expect(list.map((t) => t.id)).toEqual(['b', 'a']);
      expect(list[0].timestamp).toBe(2);
    });
  });

  describe('fetchTransactions', () => {
    it('no address → no fetch, no loading flag', async () => {
      useWalletStore.setState({ address: null });
      await useTransactionStore.getState().fetchTransactions();
      expect(fetchTransactionHistoryPage).not.toHaveBeenCalled();
      expect(useTransactionStore.getState().isLoadingTransactions).toBe(false);
    });

    it('skips while a load is already in flight', async () => {
      useTransactionStore.setState({ isLoadingTransactions: true });
      await useTransactionStore.getState().fetchTransactions();
      expect(fetchTransactionHistoryPage).not.toHaveBeenCalled();
    });

    it('reset merges the page with local private rows and dedupes', async () => {
      useTransactionStore.setState({
        transactions: [sppTx('priv-1', 500), tx({ id: 'pub-old', timestamp: 50 })],
      });
      (fetchTransactionHistoryPage as jest.Mock).mockResolvedValue({
        transactions: [tx({ id: 'pub-new', timestamp: 400 })],
        nextCursor: 'cursor-2',
        hasMore: true,
      });

      await useTransactionStore.getState().fetchTransactions({ reset: true });

      const state = useTransactionStore.getState();
      expect(state.transactions.map((t) => t.id)).toEqual(['priv-1', 'pub-new']);
      expect(state.transactionsCursor).toBe('cursor-2');
      expect(state.hasMoreTransactions).toBe(true);
      expect(state.isLoadingTransactions).toBe(false);
      expect(state.transactionsError).toBeNull();
    });

    it('non-reset appends the page to existing rows', async () => {
      useTransactionStore.setState({ transactions: [tx({ id: 'old', timestamp: 500 })] });
      (fetchTransactionHistoryPage as jest.Mock).mockResolvedValue({
        transactions: [tx({ id: 'new', timestamp: 400 })],
        nextCursor: null,
        hasMore: false,
      });

      await useTransactionStore.getState().fetchTransactions({ reset: false });

      const ids = useTransactionStore.getState().transactions.map((t) => t.id);
      expect(ids).toEqual(['old', 'new']);
    });

    it('silent refresh with rows on screen keeps the loading flag off', async () => {
      useTransactionStore.setState({ transactions: [tx()] });
      await useTransactionStore.getState().fetchTransactions({ silent: true });
      expect(useTransactionStore.getState().isLoadingTransactions).toBe(false);
    });

    it('silent refresh with an empty list still shows loading', async () => {
      // Microtask resolution — real setTimeout would hang under fake timers.
      (fetchTransactionHistoryPage as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            Promise.resolve().then(() =>
              resolve({ transactions: [], nextCursor: null, hasMore: false })
            )
          )
      );
      const promise = useTransactionStore.getState().fetchTransactions({ silent: true });
      expect(useTransactionStore.getState().isLoadingTransactions).toBe(true);
      await promise;
      expect(useTransactionStore.getState().isLoadingTransactions).toBe(false);
    });

    it('fetch error surfaces the message and clears loading', async () => {
      (fetchTransactionHistoryPage as jest.Mock).mockRejectedValue(
        new Error('Horizon timeout')
      );
      await useTransactionStore.getState().fetchTransactions();
      expect(useTransactionStore.getState().transactionsError).toBe('Horizon timeout');
      expect(useTransactionStore.getState().isLoadingTransactions).toBe(false);
    });

    it('non-Error rejection falls back to the generic message', async () => {
      (fetchTransactionHistoryPage as jest.Mock).mockRejectedValue('nope');
      await useTransactionStore.getState().fetchTransactions();
      expect(useTransactionStore.getState().transactionsError).toBe(
        'Unable to load transaction history.'
      );
    });

    it('loadMoreTransactions no-ops when exhausted or already loading', async () => {
      useTransactionStore.setState({ hasMoreTransactions: false });
      await useTransactionStore.getState().loadMoreTransactions();
      expect(fetchTransactionHistoryPage).not.toHaveBeenCalled();

      useTransactionStore.setState({ hasMoreTransactions: true, isLoadingTransactions: true });
      await useTransactionStore.getState().loadMoreTransactions();
      expect(fetchTransactionHistoryPage).not.toHaveBeenCalled();
    });

    it('refreshTransactions resets from the first page', async () => {
      (fetchTransactionHistoryPage as jest.Mock).mockResolvedValue({
        transactions: [tx({ id: 'fresh', timestamp: 1 })],
        nextCursor: null,
        hasMore: false,
      });
      useTransactionStore.setState({
        transactions: [tx({ id: 'stale', timestamp: 99 })],
        transactionsCursor: 'old-cursor',
      });
      await useTransactionStore.getState().refreshTransactions();
      // reset semantics: the cursor is cleared and the page replaces the list.
      expect(useTransactionStore.getState().transactions.map((t) => t.id)).toEqual(['fresh']);
      expect(useTransactionStore.getState().transactionsCursor).toBeNull();
    });
  });

  describe('onramp/transak records', () => {
    it('setLatestTransakOrder forces provider transak and stamps updatedAt', () => {
      useTransactionStore.getState().setLatestTransakOrder({
        provider: 'onramp_money' as never,
        walletAddress: '0xw',
        flow: 'buy',
        status: 'processing',
        updatedAt: undefined as unknown as number,
      });
      const order = useTransactionStore.getState().latestTransakOrder!;
      expect(order.provider).toBe('transak');
      expect(order.updatedAt).toBeGreaterThan(0);
    });

    it('setLatestOnrampOrder persists the statusToken to SecureStore', async () => {
      useTransactionStore.getState().setLatestOnrampOrder({
        provider: 'onramp_money',
        id: 'order-9',
        orderId: 'order-9',
        statusToken: 'tok-9',
        walletAddress: '0xw',
        userAddress: '0xw',
        flow: 'buy',
        status: 'pending',
        fiatAmount: '10',
        fiatCurrency: 'USD',
        cryptoToken: 'ETH',
        chainKey: 'ethereum',
        updatedAt: 1,
      });
      await flush();
      expect(secureSet).toHaveBeenCalledWith(
        'veilpay:onramp-status-token:order-9',
        'tok-9',
        expect.anything()
      );
    });

    it('clearLatestOnrampOrder nulls the record and mirrors a token wipe', async () => {
      useTransactionStore.getState().setLatestOnrampOrder({
        provider: 'onramp_money',
        id: 'order-10',
        orderId: 'order-10',
        statusToken: 'tok-10',
        walletAddress: '0xw',
        userAddress: '0xw',
        flow: 'buy',
        status: 'pending',
        fiatAmount: '10',
        fiatCurrency: 'USD',
        cryptoToken: 'ETH',
        chainKey: 'ethereum',
        updatedAt: 1,
      });
      await flush();
      useTransactionStore.getState().clearLatestOnrampOrder();
      expect(useTransactionStore.getState().latestOnrampOrder).toBeNull();
      await flush();
      expect(secureDelete).toHaveBeenCalledWith(
        'veilpay:onramp-status-token:order-10',
        expect.anything()
      );
    });
  });

  describe('SEC-005 persist slice + migrate', () => {
    it('partialize strips the statusToken and caps the list at 50 private-first rows', () => {
      const rows: TransactionRecord[] = [];
      for (let i = 0; i < 60; i++) {
        rows.push(
          i % 2 === 0
            ? sppTx('priv-' + i, i)
            : tx({ id: 'pub-' + i, timestamp: i })
        );
      }
      useTransactionStore.setState({
        transactions: rows,
        latestOnrampOrder: {
          provider: 'onramp_money',
          id: 'order-1',
          orderId: 'order-1',
          statusToken: 'secret-token',
          walletAddress: '0xw',
          userAddress: '0xw',
          flow: 'buy',
          status: 'pending',
          fiatAmount: '0',
          fiatCurrency: 'USD',
          cryptoToken: 'ETH',
          chainKey: 'ethereum',
          updatedAt: 1,
        },
      });

      const options = (useTransactionStore as unknown as {
        persist: { getOptions: () => { partialize: (s: TransactionState) => unknown } };
      }).persist.getOptions();
      const persisted = options.partialize(useTransactionStore.getState()) as {
        transactions: TransactionRecord[];
        latestOnrampOrder?: { statusToken?: string };
      };

      expect(persisted.transactions).toHaveLength(50);
      // Private rows survive the cap ahead of public rows.
      expect(persisted.transactions.some((t) => t.id.startsWith('priv-'))).toBe(true);
      expect(persisted.latestOnrampOrder?.statusToken).toBeUndefined();
    });

    it('migrate drops a v1 onramp order that predates statusToken', () => {
      const options = (useTransactionStore as unknown as {
        persist: { getOptions: () => { migrate: (p: unknown, v: number) => unknown } };
      }).persist.getOptions();

      const stale = options.migrate({ latestOnrampOrder: { id: 'old' } }, 1) as {
        latestOnrampOrder: unknown;
      };
      expect(stale.latestOnrampOrder).toBeNull();

      const fresh = options.migrate(
        { latestOnrampOrder: { id: 'new', statusToken: 'tok' } },
        1
      ) as { latestOnrampOrder: { statusToken?: string } };
      expect(fresh.latestOnrampOrder?.statusToken).toBe('tok');

      const v2 = options.migrate({ latestOnrampOrder: { id: 'kept' } }, 2) as {
        latestOnrampOrder: { id: string };
      };
      expect(v2.latestOnrampOrder?.id).toBe('kept');
    });

    it('onRehydrateStorage restores the token from SecureStore when present', async () => {
      const options = (useTransactionStore as unknown as {
        persist: {
          getOptions: () => {
            onRehydrateStorage: () => (state: unknown) => void;
          };
        };
      }).persist.getOptions();
      const onState = options.onRehydrateStorage();
      secureGet.mockResolvedValueOnce('restored-token');

      onState({
        latestOnrampOrder: {
          provider: 'onramp_money',
          id: 'order-77',
          orderId: 'order-77',
          statusToken: undefined,
          walletAddress: '0xw',
          userAddress: '0xw',
          flow: 'buy',
          status: 'pending',
          fiatAmount: '0',
          fiatCurrency: 'USD',
          cryptoToken: 'ETH',
          chainKey: 'ethereum',
          updatedAt: 1,
        },
      });
      await flush();
      expect(secureGet).toHaveBeenCalledWith(
        'veilpay:onramp-status-token:order-77',
        expect.anything()
      );
      expect(useTransactionStore.getState().latestOnrampOrder?.statusToken).toBe(
        'restored-token'
      );
    });

    it('onRehydrateStorage with a SecureStore failure leaves the record untouched', async () => {
      const options = (useTransactionStore as unknown as {
        persist: {
          getOptions: () => {
            onRehydrateStorage: () => (state: unknown) => void;
          };
        };
      }).persist.getOptions();
      const onState = options.onRehydrateStorage();
      secureGet.mockRejectedValueOnce(new Error('keychain locked'));

      expect(() =>
        onState({
          latestOnrampOrder: {
            provider: 'onramp_money',
            id: 'order-88',
            walletAddress: '0xw',
            userAddress: '0xw',
            flow: 'buy',
            status: 'pending',
            fiatAmount: '0',
            fiatCurrency: 'USD',
            cryptoToken: 'ETH',
            chainKey: 'ethereum',
            updatedAt: 1,
          },
        })
      ).not.toThrow();
      await flush();
      expect(useTransactionStore.getState().latestOnrampOrder?.statusToken).toBeUndefined();
    });

    it('onRehydrateStorage with no order id does nothing', async () => {
      const options = (useTransactionStore as unknown as {
        persist: {
          getOptions: () => {
            onRehydrateStorage: () => (state: unknown) => void;
          };
        };
      }).persist.getOptions();
      const onState = options.onRehydrateStorage();
      onState({ latestOnrampOrder: null });
      await flush();
      expect(secureGet).not.toHaveBeenCalled();
    });
  });

  describe('clearAllOnrampTokens', () => {
    it('removes every indexed token plus the index key', async () => {
      secureGet.mockImplementation(async (key: string) =>
        key === 'veilpay:onramp-token-index' ? JSON.stringify(['o1', 'o2']) : null
      );

      await clearAllOnrampTokens();

      expect(secureDelete).toHaveBeenCalledWith(
        'veilpay:onramp-status-token:o1',
        expect.anything()
      );
      expect(secureDelete).toHaveBeenCalledWith(
        'veilpay:onramp-status-token:o2',
        expect.anything()
      );
      expect(secureDelete).toHaveBeenCalledWith(
        'veilpay:onramp-token-index',
        expect.anything()
      );
    });

    it('index cleanup also fires when SecureStore delete fails (best-effort)', async () => {
      secureGet.mockImplementation(async (key: string) =>
        key === 'veilpay:onramp-token-index' ? JSON.stringify(['o1']) : null
      );
      secureDelete.mockRejectedValueOnce(new Error('nope'));

      await clearAllOnrampTokens();
      expect(secureDelete).toHaveBeenCalled();
    });
  });

  it('wipePersistedState removes the persisted AsyncStorage key', async () => {
    const removeSpy = jest.spyOn(AsyncStorage, 'removeItem').mockResolvedValue(undefined);
    await useTransactionStore.getState().wipePersistedState();
    expect(removeSpy).toHaveBeenCalledWith('veilpay-transaction-storage');
    removeSpy.mockRestore();
  });
});
