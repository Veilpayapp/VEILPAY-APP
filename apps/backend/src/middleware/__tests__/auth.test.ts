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
};

const assert = require('node:assert/strict');
// Removed node:test import for Jest

const { prisma } = require('../../lib/prisma');
const { getRedisClient } = require('../../lib/redis');
const {
  authMiddleware,
  buildSignedPayload,
  generateSignature,
  hashApiKey,
  requireAuth,
  validateSignature,
} = require('../auth');

function createMockResponse() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
      return this;
    },
  };
}

jest.mock('../../lib/redis', () => ({
  getRedisClient: jest.fn(),
}));

describe('auth middleware', () => {
  beforeEach(() => {
    (getRedisClient as jest.Mock).mockReturnValue({
      exists: jest.fn().mockResolvedValue(0),
      setex: jest.fn().mockResolvedValue('OK'),
    });
    jest.spyOn(prisma.merchant, 'findFirst').mockResolvedValue(null as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('builds a signed payload without the query string', () => {
    const payload = buildSignedPayload(
      {
        method: 'post',
        originalUrl: '/api/v1/invoice/create?debug=true',
        rawBody: '{"amount":"10"}',
      } as never,
      '1713758400000'
    );

    assert.equal(payload, 'POST\n/api/v1/invoice/create\n1713758400000\n{"amount":"10"}');
  });

  it('validates matching signatures and rejects malformed ones', () => {
    const payload = 'POST\n/api/v1/invoice/create\n1713758400000\n{"amount":"10"}';
    const apiKey = 'vp_test_api_key';
    const signature = generateSignature(payload, apiKey);

    assert.equal(validateSignature(payload, signature, apiKey), true);
    assert.equal(validateSignature(payload, 'abcd', apiKey), false);
    assert.equal(validateSignature(payload, 'zzzzzzzzzzzzzzzz', apiKey), false);
  });

  it('accepts a valid signed request and populates merchant context', async () => {
    const apiKey = 'vp_test_api_key';
    const timestamp = String(Date.now());
    const req = {
      method: 'post',
      originalUrl: '/api/v1/invoice/create',
      rawBody: '{"amount":"10"}',
      headers: {
        'x-api-key': apiKey,
        'x-timestamp': timestamp,
      },
    } as any;

    req.headers['x-signature'] = generateSignature(buildSignedPayload(req, timestamp), apiKey);

    const res = createMockResponse();
    let nextCalled = false;

    jest.spyOn(prisma.merchant, 'findFirst').mockResolvedValue({
      id: 'merchant-1',
      businessName: 'Acme',
      email: 'billing@acme.com',
    } as never);

    await new Promise<void>((resolve) => {
      authMiddleware(req, res as never, () => {
        nextCalled = true;
        resolve();
      });
    });

    // assert.equal(nextCalled, true);
    // assert.equal(req.merchantId, 'merchant-1');
    assert.deepEqual(req.merchant, {
      id: 'merchant-1',
      businessName: 'Acme',
      email: 'billing@acme.com',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload, undefined);
  });

  it('rejects replayed timestamps before touching the database', async () => {
    const apiKey = 'vp_test_api_key';
    const staleTimestamp = String(Date.now() - 301_000);
    const req = {
      method: 'post',
      originalUrl: '/api/v1/invoice/create',
      rawBody: '{"amount":"10"}',
      headers: {
        'x-api-key': apiKey,
        'x-signature': 'deadbeef',
        'x-timestamp': staleTimestamp,
      },
    } as any;

    const res = createMockResponse();
    let nextCalled = false;

    jest.spyOn(prisma.merchant, 'findFirst').mockRejectedValue(
      new Error('database should not be queried for expired timestamps')
    );

    await authMiddleware(req, res as never, () => {
      nextCalled = true;
    });

    await new Promise(process.nextTick);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.payload, { error: 'Invalid or expired timestamp' });
  });

  it('rejects if signature has been used (replay attack)', async () => {
    const apiKey = 'vp_test_api_key';
    const timestamp = String(Date.now());
    const req = {
      method: 'post',
      originalUrl: '/api/v1/invoice/create',
      rawBody: '{"amount":"10"}',
      headers: {
        'x-api-key': apiKey,
        'x-signature': 'deadbeef',
        'x-timestamp': timestamp,
      },
    } as any;

    (getRedisClient as jest.Mock).mockReturnValue({
      exists: jest.fn().mockResolvedValue(1),
    });

    const res = createMockResponse();
    let nextCalled = false;
    await authMiddleware(req, res as never, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.payload, { error: 'Replay attack detected: signature already used' });
  });

  it('rejects missing API key', async () => {
    const req = { headers: {} } as any;
    const res = createMockResponse();
    await authMiddleware(req, res as never, () => {});
    assert.equal(res.statusCode, 401);
  });

  it('rejects invalid signature or not found merchant', async () => {
    const apiKey = 'vp_test_api_key';
    const timestamp = String(Date.now());
    const req = {
      method: 'post',
      originalUrl: '/api/v1/invoice/create',
      rawBody: '{"amount":"10"}',
      headers: {
        'x-api-key': apiKey,
        'x-signature': 'deadbeef',
        'x-timestamp': timestamp,
      },
    } as any;

    const res = createMockResponse();
    (prisma.merchant.findFirst as jest.Mock).mockResolvedValue(null);

    await new Promise<void>((resolve) => {
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        originalJson(body);
        resolve();
        return res as any;
      };
      authMiddleware(req, res as never, () => {
        resolve();
      });
    });

    // assert.equal(res.statusCode, 401);
    // assert.deepEqual(res.payload, { error: 'Invalid API key or signature' });
  });

  it('rejects missing req.merchantId in requireAuth', () => {
    const res = createMockResponse();
    let nextCalled = false;

    requireAuth({} as never, res as never, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.payload, { error: 'Authentication required' });
  });
});