const ORIGINAL_ENV = process.env;

process.env = {
  ...ORIGINAL_ENV,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://veilpay:veilpay_dev_password@localhost:5432/veilpay',
  JWT_SECRET: 'x'.repeat(32),
  API_KEY_SALT: 'y'.repeat(32),
  WEBHOOK_SIGNING_SECRET: 'z'.repeat(32),
  CORS_ORIGINS: '*',
  REDIS_URL: 'redis://localhost:6379',
  REDIS_PASSWORD: '',
  DEFAULT_MERCHANT_TIER: 'basic',
};

const assert = require('node:assert/strict');
const { after, afterEach, beforeEach, describe, it } = require('node:test');

const { prisma } = require('../../lib/prisma');
const {
  authRateLimiter,
  getMerchantLimiter,
  getMerchantTierLimit,
  invoiceStatusRateLimiter,
  invalidateMerchantLimiter,
} = require('../rateLimiter');

function createMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    app: {
      get: () => false,
    },
    headers: {},
    ip: '127.0.0.1',
    ips: [],
    method: 'POST',
    originalUrl: '/api/v1/auth/login',
    path: '/api/v1/auth/login',
    get: () => undefined,
    ...overrides,
  };
}

function createMockResponse() {
  const listeners = new Map<string, Array<() => void>>();
  const headers = new Map<string, unknown>();

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
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    set(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
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

async function invokeLimiter(
  limiter: (req: never, res: never, next: () => void) => unknown,
  reqOverrides: Record<string, unknown> = {},
  resStatusCode = 200
) {
  const req = createMockRequest(reqOverrides);
  const res = createMockResponse();
  res.statusCode = resStatusCode;
  let nextCalled = false;

  await limiter(req as never, res as never, () => {
    nextCalled = true;
  });

  if (nextCalled) {
    res.emit('finish');
  }

  return { req, res, nextCalled };
}

describe('rate limiter middleware', () => {
  beforeEach(() => {
    (prisma.merchant as any).findUnique = async () => ({
      id: 'merchant-1',
      tier: 'basic',
    });
  });

  afterEach(() => {
    invalidateMerchantLimiter('merchant-1');
    invalidateMerchantLimiter('merchant-2');
    invalidateMerchantLimiter('merchant-3');
  });

  after(() => {
    process.env = ORIGINAL_ENV;
  });

  it('maps merchant tiers to the expected request windows', () => {
    assert.deepEqual(getMerchantTierLimit('basic'), { windowMs: 60_000, max: 60 });
    assert.deepEqual(getMerchantTierLimit('pro'), { windowMs: 60_000, max: 300 });
    assert.deepEqual(getMerchantTierLimit('enterprise'), { windowMs: 60_000, max: 1000 });
    assert.deepEqual(getMerchantTierLimit('unknown-tier'), { windowMs: 60_000, max: 100 });
  });

  it('caches merchant-specific limiters and rebuilds after invalidation', async () => {
    let findUniqueCalls = 0;

    (prisma.merchant as any).findUnique = async () => {
      findUniqueCalls += 1;
      return {
        id: 'merchant-1',
        tier: 'pro',
      };
    };

    const firstLimiter = await getMerchantLimiter('merchant-1');
    const secondLimiter = await getMerchantLimiter('merchant-1');

    assert.equal(firstLimiter, secondLimiter);
    assert.equal(findUniqueCalls, 1);

    invalidateMerchantLimiter('merchant-1');

    const thirdLimiter = await getMerchantLimiter('merchant-1');

    assert.notEqual(thirdLimiter, firstLimiter);
    assert.equal(findUniqueCalls, 2);
  });

  it('blocks repeated invoice status lookups after the configured ceiling', async () => {
    let lastResult: Awaited<ReturnType<typeof invokeLimiter>> | undefined;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      lastResult = await invokeLimiter(invoiceStatusRateLimiter as never, {
        method: 'GET',
        originalUrl: '/api/v1/invoice/123/status',
        path: '/api/v1/invoice/123/status',
      });

      assert.equal(lastResult.nextCalled, true);
    }

    const blocked = await invokeLimiter(invoiceStatusRateLimiter as never, {
      method: 'GET',
      originalUrl: '/api/v1/invoice/123/status',
      path: '/api/v1/invoice/123/status',
    });

    assert.equal(blocked.nextCalled, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.deepEqual(blocked.res.payload, {
      error: 'Too many invoice status requests. Please slow down.',
      code: 'INVOICE_STATUS_RATE_LIMIT',
    });
  });

  it('blocks repeated auth failures after the configured ceiling', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await invokeLimiter(authRateLimiter as never, {
        method: 'POST',
        originalUrl: '/api/v1/merchant/register',
        path: '/api/v1/merchant/register',
      }, 401);

      assert.equal(result.nextCalled, true);
    }

    const blocked = await invokeLimiter(authRateLimiter as never, {
      method: 'POST',
      originalUrl: '/api/v1/merchant/register',
      path: '/api/v1/merchant/register',
    }, 401);

    assert.equal(blocked.nextCalled, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.deepEqual(blocked.res.payload, {
      error: 'Too many authentication attempts, please try again later.',
      code: 'AUTH_RATE_LIMIT',
    });
  });
});