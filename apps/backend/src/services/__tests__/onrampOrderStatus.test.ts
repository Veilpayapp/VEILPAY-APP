/**
 * Round-5 onramp order status machine + provider status-polling fallback.
 *
 * Covers:
 *   - provider status → FiatOrderStatus mapping (webhook variant keeps the
 *     pinned unknown→failed semantics; polling variant is fail-closed:
 *     unrecognized statuses never mutate an order);
 *   - the CAS transition machine (terminal precondition inside the write,
 *     completed→refunded as the only sanctioned terminal exit);
 *   - the polling sweep: stale-threshold query shape, mocked provider
 *     fetches (NO real provider calls), status-only writes (amounts never
 *     come from provider payloads), fail-closed fetch behavior, batch cap;
 *   - config gating: the poller defaults to OFF.
 *
 * Env vars are pinned at the top BEFORE the module require so the config
 * parse at module load sees them (same pattern as the replay property
 * test). Provider fetches are fully mocked — no provider RPC calls.
 */

process.env.ONRAMP_STATUS_POLLING_ENABLED = 'true';
process.env.ONRAMP_STATUS_POLLING_INTERVAL_MS = '60000';
process.env.ONRAMP_STATUS_POLLING_STALE_MINUTES = '30';
process.env.ONRAMP_MONEY_API_KEY = 'onramp-test-key';
process.env.ONRAMP_MONEY_SECRET = 'onramp-test-secret';
process.env.MOONPAY_SECRET_KEY = 'moonpay-test-secret';

const ORIGINAL_ENV = { ...process.env };

type FakeOrder = {
  id: string;
  orderId: string | null;
  provider: string;
  status: string;
  txHash: string | null;
  cryptoAmount: string | null;
};

/** The live "database table" the prisma mock serves and mutates. */
let orders: FakeOrder[] = [];
const findManyCalls: Array<Record<string, unknown>> = [];
const updateManyCalls: Array<{ where: unknown; data: unknown }> = [];

/** Evaluates a WHERE `status` predicate the way Prisma does. */
function statusPredicateMatches(current: string, predicate: unknown): boolean {
  if (typeof predicate === 'string') return current === predicate;
  if (
    predicate !== null &&
    typeof predicate === 'object' &&
    'notIn' in (predicate as Record<string, unknown>)
  ) {
    const notIn = (predicate as { notIn: unknown[] }).notIn;
    return Array.isArray(notIn) && !notIn.includes(current);
  }
  return true;
}

jest.mock('../../lib/prisma', () => ({
  prisma: {
    fiatOrder: {
      findMany: jest.fn(async (args: Record<string, unknown>) => {
        findManyCalls.push(args);
        return orders.map((o) => ({ ...o }));
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: unknown };
          data: Record<string, unknown>;
        }) => {
          updateManyCalls.push({ where, data });
          let count = 0;
          orders = orders.map((o) => {
            if (o.id !== where.id) return o;
            if (!statusPredicateMatches(o.status, where.status)) return o;
            count += 1;
            return { ...o, ...(data as Partial<FakeOrder>) };
          });
          return { count };
        },
      ),
    },
  },
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  mapProviderWebhookStatus,
  mapProviderPollingStatus,
  applyOnrampStatusTransition,
  pollStaleOnrampOrders,
  startOnrampStatusPoller,
  stopOnrampStatusPoller,
  onrampStatusPollerRunning,
} = require('../onrampOrderStatus') as {
  mapProviderWebhookStatus: (raw: unknown) => string;
  mapProviderPollingStatus: (raw: unknown) => string | null;
  applyOnrampStatusTransition: (
    order: {
      id: string;
      status: string;
      txHash: string | null;
      cryptoAmount: string | null;
    },
    nextStatus: string,
    fields?: { txHash?: string; cryptoAmount?: string },
  ) => Promise<'applied' | 'ignored'>;
  pollStaleOnrampOrders: () => Promise<number>;
  startOnrampStatusPoller: () => boolean;
  stopOnrampStatusPoller: () => void;
  onrampStatusPollerRunning: () => boolean;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MoonPayService } = require('../../lib/moonpay') as {
  MoonPayService: { normalizeStatus: (raw: unknown) => string };
};

const TERMINAL_LIST = ['completed', 'cancelled', 'failed', 'refunded'];

function makeOrder(overrides: Partial<FakeOrder> = {}): FakeOrder {
  return {
    id: 'order-1',
    orderId: 'gw-order-1',
    provider: 'onramp_money',
    status: 'pending',
    txHash: null,
    cryptoAmount: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

describe('mapProviderWebhookStatus', () => {
  it.each([
    ['completed', 'completed'],
    ['success', 'completed'],
    ['SUCCESS', 'completed'],
    ['processing', 'processing'],
    ['pending', 'pending'],
    ['cancelled', 'cancelled'],
    ['refunded', 'refunded'],
    ['REFUNDED', 'refunded'],
    ['refunded_card_payment', 'refunded'],
    ['ORDER_REFUNDED', 'refunded'],
    ['some_new_provider_state', 'failed'],
    ['', 'failed'],
  ])('maps %s → %s', (raw, expected) => {
    expect(mapProviderWebhookStatus(raw)).toBe(expected);
  });

  it('maps non-string statuses to failed (pinned webhook semantics)', () => {
    expect(mapProviderWebhookStatus(undefined)).toBe('failed');
    expect(mapProviderWebhookStatus(null)).toBe('failed');
    expect(mapProviderWebhookStatus(42)).toBe('failed');
  });
});

describe('mapProviderPollingStatus (fail-closed)', () => {
  it.each([
    ['completed', 'completed'],
    ['success', 'completed'],
    ['processing', 'processing'],
    ['pending', 'pending'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['refunded', 'refunded'],
  ])('maps recognized status %s → %s', (raw, expected) => {
    expect(mapProviderPollingStatus(raw)).toBe(expected);
  });

  it('returns null for unrecognized statuses — a poller must never guess', () => {
    expect(mapProviderPollingStatus('declined_by_processor')).toBeNull();
    expect(mapProviderPollingStatus('some_new_provider_state')).toBeNull();
    expect(mapProviderPollingStatus('')).toBeNull();
    expect(mapProviderPollingStatus(undefined)).toBeNull();
  });

  it('still recognizes refund statuses (fail-closed only for the unknown)', () => {
    expect(mapProviderPollingStatus('refunded_card_payment')).toBe('refunded');
    expect(mapProviderPollingStatus('ORDER_REFUNDED')).toBe('refunded');
  });
});

// ---------------------------------------------------------------------------
// CAS transition machine
// ---------------------------------------------------------------------------

describe('applyOnrampStatusTransition', () => {
  beforeEach(() => {
    orders = [makeOrder({ status: 'processing' })];
    updateManyCalls.length = 0;
  });

  it('applies non-terminal transitions with the terminal CAS precondition in the WHERE clause', async () => {
    const snapshot = { ...orders[0] };
    const result = await applyOnrampStatusTransition(snapshot, 'completed', {
      txHash: '0x1',
      cryptoAmount: '2.0',
    });

    expect(result).toBe('applied');
    expect(orders[0].status).toBe('completed');
    expect(orders[0].txHash).toBe('0x1');
    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].where).toEqual({
      id: 'order-1',
      status: { notIn: TERMINAL_LIST },
    });
    expect(updateManyCalls[0].data).toEqual({ status: 'completed', txHash: '0x1', cryptoAmount: '2.0' });
  });

  it('is provably inert when a concurrent completion beat a stale failed event', async () => {
    // The webhook read `processing`; a concurrent completed event flipped
    // the row before this write landed.
    const staleSnapshot = makeOrder({ status: 'processing' });
    orders[0] = makeOrder({ status: 'completed', txHash: '0xwon', cryptoAmount: '1.0' });

    const result = await applyOnrampStatusTransition(staleSnapshot, 'failed');

    expect(result).toBe('ignored');
    expect(orders[0].status).toBe('completed'); // NEVER overwritten by failed
    expect(orders[0].txHash).toBe('0xwon');
    expect(updateManyCalls[0].where).toEqual({
      id: 'order-1',
      status: { notIn: TERMINAL_LIST },
    });
  });

  it('completed → refunded uses its own CAS precondition and never writes event amounts', async () => {
    orders[0] = makeOrder({ status: 'completed', cryptoAmount: '2.0' });
    const result = await applyOnrampStatusTransition({ ...orders[0] }, 'refunded', {
      cryptoAmount: '999',
    });

    expect(result).toBe('applied');
    expect(orders[0].status).toBe('refunded');
    expect(orders[0].cryptoAmount).toBe('2.0');
    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].where).toEqual({ id: 'order-1', status: 'completed' });
    expect(updateManyCalls[0].data).toEqual({ status: 'refunded' });
  });

  it('refuses completed → failed without any write at all', async () => {
    orders[0] = makeOrder({ status: 'completed' });
    const result = await applyOnrampStatusTransition({ ...orders[0] }, 'failed');

    expect(result).toBe('ignored');
    expect(orders[0].status).toBe('completed');
    expect(updateManyCalls).toHaveLength(0);
  });

  it.each(['cancelled', 'failed', 'refunded'])(
    'refuses to leave terminal state %s for any event',
    async (terminal) => {
      orders[0] = makeOrder({ status: terminal });
      const result = await applyOnrampStatusTransition({ ...orders[0] }, 'completed');

      expect(result).toBe('ignored');
      expect(orders[0].status).toBe(terminal);
      expect(updateManyCalls).toHaveLength(0);
    },
  );

  it('a refund that lost the non-terminal CAS race to a completion still lands refunded', async () => {
    const staleSnapshot = makeOrder({ status: 'processing' });
    orders[0] = makeOrder({ status: 'completed', cryptoAmount: '1.0' });

    const result = await applyOnrampStatusTransition(staleSnapshot, 'refunded');

    expect(result).toBe('applied');
    expect(orders[0].status).toBe('refunded');
    expect(updateManyCalls).toHaveLength(2);
    expect(updateManyCalls[0].where).toEqual({ id: 'order-1', status: { notIn: TERMINAL_LIST } });
    expect(updateManyCalls[1].where).toEqual({ id: 'order-1', status: 'completed' });
  });

  it('a refund that lost the race to a cancelled order stays inert', async () => {
    const staleSnapshot = makeOrder({ status: 'processing' });
    orders[0] = makeOrder({ status: 'cancelled' });

    const result = await applyOnrampStatusTransition(staleSnapshot, 'refunded');

    expect(result).toBe('ignored');
    expect(orders[0].status).toBe('cancelled');
    expect(updateManyCalls).toHaveLength(2);
    expect(updateManyCalls[1].where).toEqual({ id: 'order-1', status: 'completed' });
  });
});

// ---------------------------------------------------------------------------
// Polling sweep (mocked fetch — no real provider calls)
// ---------------------------------------------------------------------------

describe('pollStaleOnrampOrders', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    findManyCalls.length = 0;
    updateManyCalls.length = 0;
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('queries only stale pending/processing orders, oldest first, capped at 50', async () => {
    orders = [];
    await pollStaleOnrampOrders();

    expect(findManyCalls).toHaveLength(1);
    const args = findManyCalls[0];
    expect((args as { where: Record<string, unknown> }).where.status).toEqual({
      in: ['pending', 'processing'],
    });
    const staleBefore = (
      (args as { where: { updatedAt: { lt: Date } } }).where.updatedAt.lt
    );
    const expected = Date.now() - 30 * 60_000;
    expect(Math.abs(staleBefore.getTime() - expected)).toBeLessThan(10_000);
    expect((args as { orderBy: unknown }).orderBy).toEqual({ updatedAt: 'asc' });
    expect((args as { take: number }).take).toBe(50);
  });

  it('reconciles a stale onramp_money order with a STATUS-ONLY write', async () => {
    orders = [makeOrder({ provider: 'onramp_money', status: 'pending', orderId: 'gw-order-1' })];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'completed' }) });

    const reconciled = await pollStaleOnrampOrders();

    expect(reconciled).toBe(1);
    expect(orders[0].status).toBe('completed');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('onramp.money/api/v2/coin/order-status?orderId=gw-order-1'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer onramp-test-key' },
        signal: expect.any(AbortSignal),
      }),
    );
    // Status-only semantics: no txHash, no cryptoAmount from the provider.
    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].data).toEqual({ status: 'completed' });
    expect(updateManyCalls[0].where).toEqual({
      id: 'order-1',
      status: { notIn: TERMINAL_LIST },
    });
  });

  it('reconciles a stale moonpay order from the transactions list endpoint', async () => {
    orders = [
      makeOrder({ id: 'order-2', orderId: 'gw-order-2', provider: 'moonpay', status: 'processing' }),
    ];
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ status: 'completed' }] });

    const reconciled = await pollStaleOnrampOrders();

    expect(reconciled).toBe(1);
    expect(orders[0].status).toBe('completed');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api.moonpay.com/v1/transactions?externalTransactionId=gw-order-2'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer moonpay-test-secret' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('normalizes moonpay in-progress statuses instead of terminalizing the order', async () => {
    orders = [makeOrder({ id: 'order-2', orderId: 'gw-order-2', provider: 'moonpay', status: 'pending' })];
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ status: 'waitingPayment' }] });

    const reconciled = await pollStaleOnrampOrders();

    expect(reconciled).toBe(1);
    expect(orders[0].status).toBe('processing');
  });

  it('rescues a lost terminal webhook: pending → failed via polling', async () => {
    orders = [makeOrder({ status: 'pending' })];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'failed' }) });

    const reconciled = await pollStaleOnrampOrders();

    expect(reconciled).toBe(1);
    expect(orders[0].status).toBe('failed');
  });

  it('leaves the order untouched when the provider returns an unrecognized status', async () => {
    orders = [makeOrder({ status: 'pending' })];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'declined_by_processor' }) });

    const reconciled = await pollStaleOnrampOrders();

    expect(reconciled).toBe(0);
    expect(orders[0].status).toBe('pending');
    expect(updateManyCalls).toHaveLength(0);
  });

  it('leaves the order untouched when the provider returns a non-200', async () => {
    orders = [makeOrder({ status: 'pending' })];
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const reconciled = await pollStaleOnrampOrders();

    expect(reconciled).toBe(0);
    expect(updateManyCalls).toHaveLength(0);
  });

  it('fails closed when the provider fetch throws (no crash, no write)', async () => {
    orders = [makeOrder({ status: 'pending' })];
    fetchMock.mockRejectedValue(new Error('upstream down'));

    const reconciled = await pollStaleOnrampOrders();

    expect(reconciled).toBe(0);
    expect(orders[0].status).toBe('pending');
    expect(updateManyCalls).toHaveLength(0);
  });

  it('skips orders already at the provider-reported status', async () => {
    orders = [makeOrder({ status: 'pending' })];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) });

    const reconciled = await pollStaleOnrampOrders();

    expect(reconciled).toBe(0);
    expect(updateManyCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Provider fetch abort deadline (D4 pattern — mirrors upstreamTimeouts.test.ts)
// ---------------------------------------------------------------------------

describe('provider status fetch abort timeout', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function abortedError(): Error {
    return Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
  }

  it('OnrampService.fetchOrderStatus passes a 10s abort signal and fails closed on abort', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    fetchMock.mockImplementation(
      (_url: unknown, init: { signal?: AbortSignal } | undefined) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(abortedError());
            return;
          }
          signal?.addEventListener('abort', () => reject(abortedError()));
        }),
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OnrampService } = require('../../lib/onramp') as {
      OnrampService: { fetchOrderStatus: (orderId: string) => Promise<{ status: string } | null> };
    };
    await expect(OnrampService.fetchOrderStatus('order-9')).resolves.toBeNull();
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('order-status?orderId=order-9'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('MoonPayService.fetchTransactionStatus passes a 10s abort signal and fails closed on abort', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    fetchMock.mockImplementation(
      (_url: unknown, init: { signal?: AbortSignal } | undefined) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(abortedError());
            return;
          }
          signal?.addEventListener('abort', () => reject(abortedError()));
        }),
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MoonPayService: MP } = require('../../lib/moonpay') as {
      MoonPayService: {
        fetchTransactionStatus: (id: string) => Promise<{ status: string } | null>;
      };
    };
    await expect(MP.fetchTransactionStatus('order-9')).resolves.toBeNull();
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('externalTransactionId=order-9'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

// ---------------------------------------------------------------------------
// MoonPay status vocabulary normalization
// ---------------------------------------------------------------------------

describe('MoonPayService.normalizeStatus', () => {
  it.each([
    ['pending', 'processing'],
    ['waitingPayment', 'processing'],
    ['waitingAuthorization', 'processing'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['refunded', 'refunded'],
    ['refunded_card_payment', 'refunded_card_payment'],
  ])('normalizes %s → %s', (raw, expected) => {
    expect(MoonPayService.normalizeStatus(raw)).toBe(expected);
  });

  it('returns an empty string for non-string input', () => {
    expect(MoonPayService.normalizeStatus(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Config gating — the poller ships OFF by default
// ---------------------------------------------------------------------------

describe('onramp status poller config gating', () => {
  let freshModule: {
    startOnrampStatusPoller: () => boolean;
    stopOnrampStatusPoller: () => void;
    onrampStatusPollerRunning: () => boolean;
    pollStaleOnrampOrders: () => Promise<number>;
  } | null = null;

  afterEach(() => {
    freshModule?.stopOnrampStatusPoller();
    freshModule = null;
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to OFF: start() is a no-op and the sweep does nothing', async () => {
    delete process.env.ONRAMP_STATUS_POLLING_ENABLED;
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const poller = require('../onrampOrderStatus') as NonNullable<typeof freshModule>;
    freshModule = poller;

    expect(poller.startOnrampStatusPoller()).toBe(false);
    expect(poller.onrampStatusPollerRunning()).toBe(false);

    findManyCalls.length = 0;
    await expect(poller.pollStaleOnrampOrders()).resolves.toBe(0);
    expect(findManyCalls).toHaveLength(0);
  });

  it('starts only when ONRAMP_STATUS_POLLING_ENABLED=true, and stop() clears it', () => {
    process.env.ONRAMP_STATUS_POLLING_ENABLED = 'true';
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const poller = require('../onrampOrderStatus') as NonNullable<typeof freshModule>;
    freshModule = poller;

    expect(poller.startOnrampStatusPoller()).toBe(true);
    expect(poller.onrampStatusPollerRunning()).toBe(true);
    poller.stopOnrampStatusPoller();
    expect(poller.onrampStatusPollerRunning()).toBe(false);
  });
});
