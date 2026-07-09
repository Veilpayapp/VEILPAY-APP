/**
 * useIncomingPaymentNotifications — Tier 1 standard-receive alerts.
 *
 * Verifies the four load-bearing behaviours:
 *   1. Baseline suppression — receives already in history on mount never
 *      notify (only receives that appear afterwards do).
 *   2. Notify-on-new-received — a fresh `type: 'received' / 'completed'`
 *      record fires exactly one local notification with the amount + deep link.
 *   3. De-dupe — the same tx surfacing again across ticks notifies only once.
 *   4. Gate — with `notificationsEnabled` false (or no wallet) nothing fires
 *      and no store subscription is created.
 */

// ── expo-secure-store: in-memory map (overrides the null-returning global mock)
jest.mock('expo-secure-store', () => {
  const memory = new Map<string, string>();
  return {
    __esModule: true,
    setItemAsync: jest.fn(async (k: string, v: string) => {
      memory.set(k, v);
    }),
    getItemAsync: jest.fn(async (k: string) => (memory.has(k) ? memory.get(k)! : null)),
    deleteItemAsync: jest.fn(async (k: string) => {
      memory.delete(k);
    }),
  };
});

// ── transactionStore: controllable snapshot + subscription
//
// Everything the factory closes over must be `mock`-prefixed so
// babel-plugin-jest-hoist permits referencing it before the (hoisted)
// jest.mock call. We hang the controllable state off a single `mockStore`
// object and reach into it from the tests below.
type Listener = (state: { transactions: any[] }) => void;
const mockStore: {
  transactions: any[];
  listeners: Set<Listener>;
  refreshTransactions: jest.Mock;
} = {
  transactions: [],
  listeners: new Set<Listener>(),
  refreshTransactions: jest.fn(async () => {}),
};

jest.mock('../../stores/transactionStore', () => ({
  __esModule: true,
  useTransactionStore: {
    getState: () => ({
      transactions: mockStore.transactions,
      refreshTransactions: mockStore.refreshTransactions,
    }),
    subscribe: (fn: Listener) => {
      mockStore.listeners.add(fn);
      return () => mockStore.listeners.delete(fn);
    },
  },
}));

import { act, renderHook } from '@testing-library/react-native';
import { useIncomingPaymentNotifications } from '../useIncomingPaymentNotifications';

function setTransactions(txs: any[]): void {
  mockStore.transactions = txs;
  for (const l of mockStore.listeners) l({ transactions: mockStore.transactions });
}

const RECEIVED = (hash: string, amount = '1.5', tokenSymbol = 'ETH') => ({
  id: hash,
  type: 'received' as const,
  status: 'completed' as const,
  amount,
  token: tokenSymbol,
  tokenSymbol,
  from: '0xsender',
  to: '0xme',
  timestamp: Date.now(),
  hash,
});

const ADDRESS = '0x00000000000000000000000000000000000000AA';

/** Pump the microtask queue so the hook's async baseline/evaluate settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useIncomingPaymentNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.transactions = [];
    mockStore.listeners.clear();
  });

  it('baselines existing history without notifying', async () => {
    const notify = jest.fn();
    mockStore.transactions = [RECEIVED('0xexisting')];

    renderHook(() =>
      useIncomingPaymentNotifications({
        address: ADDRESS,
        isConnected: true,
        notificationsEnabled: true,
        notify,
      })
    );

    await flush();
    // The pre-existing receive was folded into the baseline seen-set.
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies for a new received tx with amount and deep link', async () => {
    const notify = jest.fn();

    renderHook(() =>
      useIncomingPaymentNotifications({
        address: ADDRESS,
        isConnected: true,
        notificationsEnabled: true,
        notify,
      })
    );

    await flush(); // baseline seeded (empty history)

    await act(async () => {
      setTransactions([RECEIVED('0xabc123', '0.5', 'ETH')]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const [title, body, data] = notify.mock.calls[0];
    expect(title).toBe('Payment received');
    expect(body).toBe('You received 0.5 ETH');
    expect(data.transactionHash).toBe('0xabc123');
    expect(data.deepLink).toContain('0xabc123');
  });

  it('does not notify twice for the same tx across store emissions', async () => {
    const notify = jest.fn();

    renderHook(() =>
      useIncomingPaymentNotifications({
        address: ADDRESS,
        isConnected: true,
        notificationsEnabled: true,
        notify,
      })
    );

    await flush();

    await act(async () => {
      setTransactions([RECEIVED('0xdup')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Same record re-emitted (e.g. a later refresh returns it again).
    await act(async () => {
      setTransactions([RECEIVED('0xdup')]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('stays inert when notifications are disabled', async () => {
    const notify = jest.fn();

    renderHook(() =>
      useIncomingPaymentNotifications({
        address: ADDRESS,
        isConnected: true,
        notificationsEnabled: false,
        notify,
      })
    );

    await flush();

    await act(async () => {
      setTransactions([RECEIVED('0xignored')]);
      await Promise.resolve();
    });

    expect(notify).not.toHaveBeenCalled();
    // No subscription should have been registered while disabled.
    expect(mockStore.listeners.size).toBe(0);
  });

  it('ignores sent transactions', async () => {
    const notify = jest.fn();

    renderHook(() =>
      useIncomingPaymentNotifications({
        address: ADDRESS,
        isConnected: true,
        notificationsEnabled: true,
        notify,
      })
    );

    await flush();

    await act(async () => {
      setTransactions([{ ...RECEIVED('0xsent'), type: 'sent' }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it('dedupes by lowercase hash and falls back to id when hash is missing', async () => {
    const notify = jest.fn();

    renderHook(() =>
      useIncomingPaymentNotifications({
        address: ADDRESS,
        isConnected: true,
        notificationsEnabled: true,
        notify,
      })
    );

    await flush();

    await act(async () => {
      setTransactions([RECEIVED('0xAbC')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Same hash, different casing — must not re-notify.
    await act(async () => {
      setTransactions([RECEIVED('0xabc')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(notify).toHaveBeenCalledTimes(1);

    // Hash-less record: identity is `id`.
    await act(async () => {
      setTransactions([
        RECEIVED('0xabc'),
        {
          id: 'local-id-1',
          type: 'received',
          status: 'completed',
          amount: '2',
          token: 'ETH',
          tokenSymbol: 'ETH',
          from: '0xsender',
          to: '0xme',
          timestamp: Date.now(),
          hash: '',
        },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('keys the seen-set by address (different wallet gets a fresh baseline)', async () => {
    const SecureStore = require('expo-secure-store');
    const notifyA = jest.fn();
    const notifyB = jest.fn();
    const addressB = '0x00000000000000000000000000000000000000BB';

    // Wallet A sees a receive and marks it seen.
    const { unmount } = renderHook(() =>
      useIncomingPaymentNotifications({
        address: ADDRESS,
        isConnected: true,
        notificationsEnabled: true,
        notify: notifyA,
      })
    );
    await flush();
    await act(async () => {
      setTransactions([RECEIVED('0xshared')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(notifyA).toHaveBeenCalledTimes(1);
    unmount();

    // Wallet B mounts with the same store snapshot — must baseline (not notify)
    // from its own empty seen-set + current history, not wallet A's set.
    mockStore.transactions = [RECEIVED('0xshared')];
    renderHook(() =>
      useIncomingPaymentNotifications({
        address: addressB,
        isConnected: true,
        notificationsEnabled: true,
        notify: notifyB,
      })
    );
    await flush();
    expect(notifyB).not.toHaveBeenCalled();

    // And the two wallets wrote to distinct SecureStore keys.
    const keys = (SecureStore.setItemAsync as jest.Mock).mock.calls.map((c: string[]) => c[0]);
    expect(keys.some((k: string) => k.toLowerCase().includes(ADDRESS.toLowerCase().slice(-4)))).toBe(true);
    expect(keys.some((k: string) => k.toLowerCase().includes(addressB.toLowerCase().slice(-4)))).toBe(true);
  });
});
