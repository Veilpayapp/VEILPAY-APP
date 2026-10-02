/**
 * Round-5 CAS + refund guarantees for the onramp webhook.
 *
 *   1. Out-of-order / concurrent provider events can NEVER overwrite a
 *      `completed` order with `failed` (the write itself carries the
 *      terminal-state precondition — `updateMany` with `status: { notIn:
 *      TERMINAL }`, mirroring paymentProcessor.ts confirmInvoicePayment).
 *   2. Refund / chargeback events map to `refunded` (previously they
 *      collapsed into `failed`); `completed → refunded` is the ONE
 *      sanctioned exit from a terminal state and has its own CAS
 *      precondition. Post-completion refunds are no longer dropped.
 *   3. An event that loses the CAS race still gets 200 received/ignored so
 *      the provider stops retrying (same response as the terminal guard).
 *
 * The prisma mock below is a mini-database: `findFirst` returns a DETACHED
 * snapshot (like Prisma does) while `updateMany` evaluates its WHERE
 * predicate against the LIVE row — exactly the semantics that make the
 * read-then-write gap visible.
 */

import { createHmac } from 'node:crypto';

// Pinned before the controller require so OnrampService.verifyWebhook is
// determinate (same pattern as the replay property test).
process.env.ONRAMP_MONEY_SECRET = 'cas-test-secret';
process.env.ONRAMP_MONEY_API_KEY = 'cas-test-key';

const ONRAMP_SECRET = process.env.ONRAMP_MONEY_SECRET;

type FakeOrder = {
  id: string;
  orderId: string;
  status: string;
  txHash: string | null;
  cryptoAmount: string | null;
};

/** The live "database row". */
let store: FakeOrder | null = null;
const updateManyCalls: Array<{ where: unknown; data: unknown }> = [];
/**
 * Optional per-write gate used by the concurrency test to force the
 * out-of-order interleaving deterministically.
 */
let writeGate: ((data: Record<string, unknown>) => Promise<void>) | null = null;

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
      // Detached snapshot: the caller keeps this object even if the store
      // changes underneath it (Prisma behaves the same way).
      findFirst: jest.fn(async () => (store ? { ...store } : null)),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: unknown };
          data: Record<string, unknown>;
        }) => {
          updateManyCalls.push({ where, data });
          if (writeGate) await writeGate(data);
          if (!store) return { count: 0 };
          if (store.id !== where.id) return { count: 0 };
          if (!statusPredicateMatches(store.status, where.status)) return { count: 0 };
          store = { ...store, ...(data as Partial<FakeOrder>) };
          return { count: 1 };
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
const { handleOnrampWebhook } = require('../onrampController') as {
  handleOnrampWebhook: (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockResponse {
  statusCode: number;
  payload: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
}

function mockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
  return res;
}

function asResponse(res: MockResponse): import('express').Response {
  return res as unknown as import('express').Response;
}

function buildSignedRequest(body: Record<string, unknown>): import('express').Request {
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', ONRAMP_SECRET as string).update(rawBody).digest('hex');
  return {
    headers: { 'x-onramp-signature': signature },
    body,
    rawBody,
  } as unknown as import('express').Request;
}

function seedOrder(status: string, overrides: Partial<FakeOrder> = {}): FakeOrder {
  return {
    id: 'order-1',
    orderId: 'order-1',
    status,
    txHash: null,
    cryptoAmount: null,
    ...overrides,
  };
}

async function fire(body: Record<string, unknown>): Promise<MockResponse> {
  const res = mockResponse();
  await handleOnrampWebhook(buildSignedRequest(body), asResponse(res), jest.fn());
  return res;
}

const TERMINAL_LIST = ['completed', 'cancelled', 'failed', 'refunded'];

beforeEach(() => {
  store = seedOrder('pending');
  updateManyCalls.length = 0;
  writeGate = null;
});

// ---------------------------------------------------------------------------
// 1. CAS: completed can never be overwritten by failed
// ---------------------------------------------------------------------------

describe('Onramp webhook — CAS terminal transitions', () => {
  it('out-of-order: a failed event arriving AFTER completed leaves the order completed', async () => {
    store = seedOrder('pending');

    const completed = await fire({ orderId: 'order-1', status: 'completed', timestamp: Date.now() });
    expect(completed.statusCode).toBe(200);
    expect(completed.payload).toEqual({ received: true });

    const failed = await fire({ orderId: 'order-1', status: 'failed', timestamp: Date.now() });
    expect(failed.statusCode).toBe(200);
    expect((failed.payload as { ignored?: string }).ignored).toMatch(/terminal/);

    expect(store?.status).toBe('completed');
    // Only the completed event attempted a write; the failed event was
    // rejected by the terminal guard before any prisma call.
    expect(updateManyCalls).toHaveLength(1);
    expect((updateManyCalls[0].data as { status: string }).status).toBe('completed');
  });

  it('concurrent: a failed event whose read was stale matches zero rows (racy window closed)', async () => {
    store = seedOrder('processing');

    // Force the out-of-order interleaving: both handlers read `processing`
    // before either writes; the failed event's write is held back until the
    // completed event has fully applied, then must fail its CAS.
    let releaseCompleted!: () => void;
    const completedSettled = new Promise<void>((resolve) => {
      releaseCompleted = resolve;
    });
    writeGate = async (data) => {
      if (data.status === 'failed') {
        await completedSettled;
      }
    };

    const resCompleted = mockResponse();
    const resFailed = mockResponse();
    const completedPromise = handleOnrampWebhook(
      buildSignedRequest({ orderId: 'order-1', status: 'completed', timestamp: Date.now() }),
      asResponse(resCompleted),
      jest.fn(),
    );
    const failedPromise = handleOnrampWebhook(
      buildSignedRequest({ orderId: 'order-1', status: 'failed', timestamp: Date.now() }),
      asResponse(resFailed),
      jest.fn(),
    );
    void completedPromise.then(() => releaseCompleted());
    await Promise.all([completedPromise, failedPromise]);

    expect(store?.status).toBe('completed');
    expect(resCompleted.statusCode).toBe(200);
    // The losing event still gets 200 received/ignored → provider stops retrying.
    expect(resFailed.statusCode).toBe(200);
    expect((resFailed.payload as { ignored?: string }).ignored).toMatch(/terminal/);

    const failedWrite = updateManyCalls.find(
      (c) => (c.data as { status?: string }).status === 'failed',
    );
    expect(failedWrite).toBeDefined();
    // The failed event's write carried the terminal-state CAS precondition.
    expect(failedWrite?.where).toEqual({
      id: 'order-1',
      status: { notIn: TERMINAL_LIST },
    });
  });

  it('the webhook write carries the terminal-state CAS precondition in its WHERE clause', async () => {
    store = seedOrder('processing');
    await fire({ orderId: 'order-1', status: 'completed', timestamp: Date.now() });

    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].where).toEqual({
      id: 'order-1',
      status: { notIn: TERMINAL_LIST },
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Refund / chargeback representation
// ---------------------------------------------------------------------------

describe('Onramp webhook — refund mapping', () => {
  it.each(['refunded', 'REFUNDED', 'refunded_card_payment', 'ORDER_REFUNDED'])(
    'maps refund status %s to refunded (not failed) for a pending order',
    async (rawStatus) => {
      store = seedOrder('pending');
      const res = await fire({ orderId: 'order-1', status: rawStatus, timestamp: Date.now() });

      expect(res.statusCode).toBe(200);
      expect(res.payload).toEqual({ received: true });
      expect(store?.status).toBe('refunded');
      expect(updateManyCalls[0].where).toEqual({
        id: 'order-1',
        status: { notIn: TERMINAL_LIST },
      });
    },
  );

  it('applies completed → refunded through its own CAS precondition (post-completion refund)', async () => {
    store = seedOrder('completed', { txHash: '0xabc', cryptoAmount: '2.0' });
    const res = await fire({
      orderId: 'order-1',
      status: 'refunded',
      timestamp: Date.now(),
      txHash: '0xrefund',
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ received: true });
    expect(store?.status).toBe('refunded');
    // Own precondition — completed only.
    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].where).toEqual({ id: 'order-1', status: 'completed' });
    expect((updateManyCalls[0].data as { txHash?: string }).txHash).toBe('0xrefund');
  });

  it('never writes event cryptoAmount on a refund transition (server amounts stay authoritative)', async () => {
    store = seedOrder('completed', { cryptoAmount: '2.0' });
    await fire({
      orderId: 'order-1',
      status: 'refunded',
      timestamp: Date.now(),
      cryptoAmount: '999',
    });

    expect(store?.status).toBe('refunded');
    expect(store?.cryptoAmount).toBe('2.0');
    expect(updateManyCalls[0].data).toEqual({ status: 'refunded' });
  });

  it('drops a refund event for a cancelled order (no exit from cancelled)', async () => {
    store = seedOrder('cancelled');
    const res = await fire({ orderId: 'order-1', status: 'refunded', timestamp: Date.now() });

    expect(res.statusCode).toBe(200);
    expect((res.payload as { ignored?: string }).ignored).toMatch(/terminal/);
    expect(store?.status).toBe('cancelled');
    expect(updateManyCalls).toHaveLength(0);
  });

  it('refunded is terminal: a later completed event is ignored', async () => {
    store = seedOrder('refunded');
    const res = await fire({ orderId: 'order-1', status: 'completed', timestamp: Date.now() });

    expect(res.statusCode).toBe(200);
    expect((res.payload as { ignored?: string }).ignored).toMatch(/terminal/);
    expect(store?.status).toBe('refunded');
    expect(updateManyCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Existing normalizer semantics stay intact
// ---------------------------------------------------------------------------

describe('Onramp webhook — unchanged normalization semantics', () => {
  it('success → completed and writes event-provided txHash/cryptoAmount', async () => {
    store = seedOrder('processing');
    await fire({
      orderId: 'order-1',
      status: 'success',
      timestamp: Date.now(),
      txHash: '0xdeadbeef',
      cryptoAmount: '1.25',
    });

    expect(store?.status).toBe('completed');
    expect(store?.txHash).toBe('0xdeadbeef');
    expect(store?.cryptoAmount).toBe('1.25');
  });

  it('an unrecognized status still maps a NON-terminal order to failed (pinned behavior)', async () => {
    store = seedOrder('pending');
    await fire({ orderId: 'order-1', status: 'weird_provider_state', timestamp: Date.now() });

    expect(store?.status).toBe('failed');
  });

  it('keeps event-absent txHash/cryptoAmount untouched', async () => {
    store = seedOrder('pending', { txHash: '0xkeep', cryptoAmount: '3.0' });
    await fire({ orderId: 'order-1', status: 'processing', timestamp: Date.now() });

    expect(store?.status).toBe('processing');
    expect(store?.txHash).toBe('0xkeep');
    expect(store?.cryptoAmount).toBe('3.0');
  });
});
