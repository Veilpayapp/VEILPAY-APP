/**
 * D1: prove the rate limiter cannot hang when Redis is down.
 *
 * The old getStore() handed rate-limit-redis the BullMQ client
 * (maxRetriesPerRequest: null): with Redis down every increment queued
 * forever and every rate-limited route hung. The new bounded client +
 * FailoverRateLimitStore must degrade to the in-process memory store within
 * a bounded time instead.
 */

export {}; // Force TypeScript module boundary to avoid TS2451 cross-file conflicts

const assert = require('node:assert/strict');

// Controllable fake clients — mutated per test to simulate Redis states.
const mockBullmqClient = {
  status: 'wait',
  call: jest.fn().mockResolvedValue('OK'),
  ping: jest.fn().mockResolvedValue('PONG'),
};

const mockBoundedClient = {
  status: 'end',
  call: jest.fn().mockResolvedValue('OK'),
};

jest.mock('../../lib/redis', () => ({
  getRedisClient: jest.fn(() => mockBullmqClient),
  getBoundedRedisClient: jest.fn(() => mockBoundedClient),
  getRedisInitError: jest.fn(() => null),
}));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    merchant: {
      findUnique: jest.fn().mockResolvedValue({ id: 'merchant-1', tier: 'basic' }),
    },
  },
}));

const {
  authRateLimiter,
} = require('../rateLimiter');
const { getBoundedRedisClient, getRedisClient } = require('../../lib/redis');

function createMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    app: { get: () => false },
    headers: {},
    ip: '127.0.0.1',
    ips: [],
    method: 'POST',
    originalUrl: '/api/v1/merchant/register',
    path: '/api/v1/merchant/register',
    get: () => undefined,
    ...overrides,
  };
}

function createMockResponse() {
  const listeners = new Map<string, Array<() => void>>();

  return {
    statusCode: 200,
    payload: undefined as unknown,
    headersSent: false,
    on(event: string, handler: () => void) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
      return this;
    },
    emit(event: string) {
      for (const handler of listeners.get(event) || []) {
        handler();
      }
    },
    setHeader() {
      return this;
    },
    set() {
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
      this.headersSent = true;
      return this;
    },
    send(body: unknown) {
      this.payload = body;
      this.headersSent = true;
      return this;
    },
  };
}

async function invokeAuthLimiter(ip = '127.0.0.1') {
  const req = createMockRequest({ ip });
  const res = createMockResponse();
  // 401 so skipSuccessfulRequests never decrements the counter.
  res.statusCode = 401;
  let nextCalled = false;

  await (authRateLimiter as unknown as (
    req: never,
    res: never,
    next: () => void
  ) => unknown)(req as never, res as never, () => {
    nextCalled = true;
  });

  if (nextCalled) {
    res.emit('finish');
  }

  return { res, nextCalled };
}

describe('rate limiter Redis failover (D1)', () => {
  const originalWarn = console.warn;
  let warnCalls: string[];

  beforeAll(() => {
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args.map(String).join(' '));
    };
  });

  afterAll(() => {
    console.warn = originalWarn;
  });

  beforeEach(() => {
    warnCalls = [];
    mockBoundedClient.status = 'end';
    mockBoundedClient.call = jest.fn().mockResolvedValue('OK');
  });

  it('getStore wires the bounded client, not the BullMQ client', () => {
    // Module import already ran getStore() for every static limiter.
    assert.ok(getBoundedRedisClient.mock.calls.length > 0);
    assert.equal(getRedisClient.mock.calls.length, 0);
  });

  it('degrades to the memory store when Redis is down (status not ready)', async () => {
    mockBoundedClient.status = 'end'; // bounded retryStrategy gave up

    // authRateLimiter: max 10 per 15 min. With the memory fallback serving
    // increments, requests count per-instance and the 11th is rejected —
    // no command is ever sent to the dead client.
    for (let i = 0; i < 10; i += 1) {
      const { nextCalled } = await invokeAuthLimiter();
      assert.equal(nextCalled, true, `request ${i + 1} should pass`);
    }

    const blocked = await invokeAuthLimiter();
    assert.equal(blocked.nextCalled, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.deepEqual(blocked.res.payload, {
      error: 'Too many authentication attempts, please try again later.',
      code: 'AUTH_RATE_LIMIT',
    });
    // No increment command was ever sent to the dead client (the only calls
    // the original mock saw were the import-time SCRIPT LOADs, replaced in
    // beforeEach; increments went to the memory store).
    assert.equal(mockBoundedClient.call.mock.calls.length, 0);
  }, 20_000);

  it('does not hang when the client claims ready but commands never settle', async () => {
    // Redis accepted the connection then went silent mid-command — the old
    // BullMQ client (maxRetriesPerRequest: null) queued this forever.
    // Fresh IP so the memory bucket from the previous test does not apply.
    const ip = '10.9.8.7';
    mockBoundedClient.status = 'ready';
    mockBoundedClient.call = jest.fn(() => new Promise(() => undefined));

    const startedAt = Date.now();
    const { nextCalled, res } = await invokeAuthLimiter(ip);
    const elapsedMs = Date.now() - startedAt;

    // Bounded: the store races its own 1s deadline and falls back to memory,
    // so the request completes instead of hanging.
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 401);
    assert.ok(elapsedMs < 5_000, `limiter should settle in bounded time, took ${elapsedMs}ms`);
    assert.ok(
      warnCalls.some((w) => w.includes('Redis store unavailable')),
      'fallback warning should be logged once'
    );
  }, 20_000);
});
