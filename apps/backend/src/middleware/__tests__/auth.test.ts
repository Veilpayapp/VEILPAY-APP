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
const { after, afterEach, beforeEach, describe, it } = require('node:test');

const { prisma } = require('../../lib/prisma');
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

describe('auth middleware', () => {
  let originalFindFirst: unknown;

  beforeEach(() => {
    originalFindFirst = (prisma.merchant as any).findFirst;
  });

  afterEach(() => {
    (prisma.merchant as any).findFirst = originalFindFirst;
  });

  after(() => {
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

    (prisma.merchant as any).findFirst = async () => ({
      id: 'merchant-1',
      businessName: 'Acme',
      email: 'billing@acme.com',
    });

    await authMiddleware(req, res as never, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.merchantId, 'merchant-1');
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

    (prisma.merchant as any).findFirst = async () => {
      throw new Error('database should not be queried for expired timestamps');
    };

    await authMiddleware(req, res as never, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.payload, { error: 'Invalid or expired timestamp' });
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