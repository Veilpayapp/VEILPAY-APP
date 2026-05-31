/**
 * Replay-protection guarantees for the Onramp.money webhook.
 *
 * The Onramp.money webhook is HMAC-signed but the third-party provider
 * does not always include a fresh timestamp header. Without additional
 * defenses, a captured webhook can be replayed indefinitely to flip an
 * order's state. We layer two replay defenses on top of signature
 * verification:
 *
 *   1. Body-timestamp window — when the signed body carries a
 *      `timestamp` / `eventTime` / `createdAt` field, refuse events
 *      older than 5 minutes (mirrors the internal webhookController's
 *      `Math.abs(Date.now() - ts) > 300_000` check).
 *
 *   2. Terminal-state guard — refuse to move an order *out* of
 *      `completed` / `cancelled` / `failed`. This is the actual harm of
 *      a replay attack on this endpoint and the guarantee that holds
 *      even when the provider ships no timestamp.
 *
 * This file pins both behaviors so a future refactor cannot silently
 * regress them.
 */

import { createHmac } from 'node:crypto';

// Jest setup runs `tests/setup.ts` before this; we additionally pin the
// onramp secret so OnrampService.verifyWebhook can produce a determinate
// signature. Both `process.env` writes happen at module-load time so
// they are visible to the controller import below.
process.env.ONRAMP_MONEY_SECRET = 'replay-test-secret';
process.env.ONRAMP_MONEY_API_KEY = 'replay-test-key';

const ONRAMP_SECRET = process.env.ONRAMP_MONEY_SECRET;

// Single mutable order record the prisma mock returns from `findFirst`
// and accepts mutations against via `update`. Each test reseeds it.
type FakeOrder = {
  id: string;
  orderId: string;
  status: string;
  txHash: string | null;
  cryptoAmount: string | null;
};

let fakeOrder: FakeOrder | null = null;
const updateCalls: Array<{ where: unknown; data: unknown }> = [];

jest.mock('../../lib/prisma', () => ({
  prisma: {
    fiatOrder: {
      findFirst: jest.fn(async () => fakeOrder),
      update: jest.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        updateCalls.push({ where, data });
        if (fakeOrder) {
          fakeOrder = { ...fakeOrder, ...(data as Partial<FakeOrder>) };
        }
        return fakeOrder;
      }),
    },
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
// Test fixtures
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

/**
 * Tiny adapter that satisfies the controller's `Response` parameter without
 * implementing all 90+ methods Express's full type ships with. The
 * controller only ever calls `.status().json()` so a structural cast is
 * safe and keeps the tests readable.
 */
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

beforeEach(() => {
  fakeOrder = {
    id: 'order-1',
    orderId: 'order-1',
    status: 'pending',
    txHash: null,
    cryptoAmount: null,
  };
  updateCalls.length = 0;
});

// ---------------------------------------------------------------------------
// Property A — body-timestamp replay window
// ---------------------------------------------------------------------------

describe('Onramp webhook — body-timestamp replay window', () => {
  it('accepts a fresh signed event with a current ms-epoch timestamp', async () => {
    const req = buildSignedRequest({
      orderId: 'order-1',
      status: 'completed',
      timestamp: Date.now(),
    });
    const res = mockResponse();
    await handleOnrampWebhook(req, asResponse(res), jest.fn());

    expect(res.statusCode).toBe(200);
    expect(updateCalls).toHaveLength(1);
  });

  it('rejects a signed event whose body timestamp is older than 5 minutes', async () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    const req = buildSignedRequest({
      orderId: 'order-1',
      status: 'completed',
      timestamp: sixMinutesAgo,
    });
    const res = mockResponse();
    await handleOnrampWebhook(req, asResponse(res), jest.fn());

    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ error: 'Invalid or expired timestamp' });
    expect(updateCalls).toHaveLength(0);
  });

  it('handles seconds-epoch timestamps (Onramp ships both ms- and s-epoch)', async () => {
    const sixMinutesAgoSeconds = Math.floor((Date.now() - 6 * 60 * 1000) / 1000);
    const req = buildSignedRequest({
      orderId: 'order-1',
      status: 'completed',
      eventTime: sixMinutesAgoSeconds,
    });
    const res = mockResponse();
    await handleOnrampWebhook(req, asResponse(res), jest.fn());

    expect(res.statusCode).toBe(401);
    expect(updateCalls).toHaveLength(0);
  });

  it('handles ISO-8601 string timestamps', async () => {
    const sixMinutesAgoIso = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const req = buildSignedRequest({
      orderId: 'order-1',
      status: 'completed',
      createdAt: sixMinutesAgoIso,
    });
    const res = mockResponse();
    await handleOnrampWebhook(req, asResponse(res), jest.fn());

    expect(res.statusCode).toBe(401);
    expect(updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Property B — terminal-state replay guard
// ---------------------------------------------------------------------------

describe('Onramp webhook — terminal-state replay guard', () => {
  it.each(['completed', 'cancelled', 'failed'])(
    'refuses to mutate an order already in terminal state: %s',
    async (terminalStatus) => {
      fakeOrder = {
        id: 'order-1',
        orderId: 'order-1',
        status: terminalStatus,
        txHash: '0xabc',
        cryptoAmount: '1.0',
      };

      const req = buildSignedRequest({
        orderId: 'order-1',
        status: 'pending',
        timestamp: Date.now(),
      });
      const res = mockResponse();
      await handleOnrampWebhook(req, asResponse(res), jest.fn());

      expect(res.statusCode).toBe(200);
      expect(updateCalls).toHaveLength(0);
      expect((res.payload as { ignored?: string }).ignored).toMatch(/terminal/);
    },
  );

  it('still allows transitions from non-terminal states', async () => {
    fakeOrder = {
      id: 'order-1',
      orderId: 'order-1',
      status: 'processing',
      txHash: null,
      cryptoAmount: null,
    };

    const req = buildSignedRequest({
      orderId: 'order-1',
      status: 'completed',
      timestamp: Date.now(),
    });
    const res = mockResponse();
    await handleOnrampWebhook(req, asResponse(res), jest.fn());

    expect(res.statusCode).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect((updateCalls[0].data as { status: string }).status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Property C — signature is still required (regression guard)
// ---------------------------------------------------------------------------

describe('Onramp webhook — signature is still required after replay defenses', () => {
  it('rejects an unsigned event even when timestamp and order are fresh', async () => {
    const body = { orderId: 'order-1', status: 'completed', timestamp: Date.now() };
    const req = {
      headers: {},
      body,
      rawBody: JSON.stringify(body),
    } as unknown as import('express').Request;
    const res = mockResponse();
    await handleOnrampWebhook(req, asResponse(res), jest.fn());

    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ error: 'Invalid signature' });
    expect(updateCalls).toHaveLength(0);
  });
});
