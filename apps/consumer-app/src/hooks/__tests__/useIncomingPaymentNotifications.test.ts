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
});
