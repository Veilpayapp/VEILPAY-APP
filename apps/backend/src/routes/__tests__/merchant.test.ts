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
const { merchantRoutes } = require('../merchant');

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

function getRouteHandler(method: string, path: string) {
  const layer = merchantRoutes.stack.find((entry: any) => {
    if (!entry.route) {
      return false;
    }

    return entry.route.path === path && entry.route.methods[method.toLowerCase()];
  });

  if (!layer?.route?.stack?.length) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  return layer.route.stack[layer.route.stack.length - 1].handle as (
    req: never,
    res: never,
    next: (error?: unknown) => void
  ) => unknown;
}

describe('merchant routes', () => {
  let originalFindUnique: unknown;
  let originalCreate: unknown;
  let originalUpsert: unknown;

  beforeEach(() => {
    originalFindUnique = (prisma.merchant as any).findUnique;
    originalCreate = (prisma.merchant as any).create;
    originalUpsert = (prisma.chainViewingKey as any).upsert;
  });

  afterEach(() => {
    (prisma.merchant as any).findUnique = originalFindUnique;
    (prisma.merchant as any).create = originalCreate;
    (prisma.chainViewingKey as any).upsert = originalUpsert;
  });

  after(() => {
    process.env = ORIGINAL_ENV;
  });

  it('registers a merchant and returns a prefixed api key', async () => {
    const registerHandler = getRouteHandler('POST', '/register');
    const req = {
      body: {
        businessName: 'Acme Corp',
        email: 'billing@acme.com',
        webhookUrl: 'https://acme.com/webhooks/veilpay',
      },
    } as any;
    const res = createMockResponse();
    let createdData: any;

    (prisma.merchant as any).findUnique = async () => null;
    (prisma.merchant as any).create = async ({ data }: any) => {
      createdData = data;

      return {
        id: '11111111-1111-4111-8111-111111111111',
        businessName: data.businessName,
        email: data.email,
        status: data.status,
      };
    };

    await registerHandler(req, res as never, (error?: unknown) => {
      if (error) {
        throw error;
      }
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.merchantId, '11111111-1111-4111-8111-111111111111');
    assert.equal(res.payload.businessName, 'Acme Corp');
    assert.equal(res.payload.email, 'billing@acme.com');
    assert.equal(res.payload.status, 'active');
    assert.equal(typeof res.payload.apiKey, 'string');
    assert.match(res.payload.apiKey, /^vp_[a-f0-9]+$/i);
    assert.equal(typeof createdData.apiKeyHash, 'string');
    assert.equal(createdData.status, 'active');
  });

  it('rejects duplicate merchant registrations by email', async () => {
    const registerHandler = getRouteHandler('POST', '/register');
    const req = {
      body: {
        businessName: 'Acme Corp',
        email: 'billing@acme.com',
      },
    } as any;
    const res = createMockResponse();

    (prisma.merchant as any).findUnique = async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'billing@acme.com',
    });

    await registerHandler(req, res as never, (error?: unknown) => {
      if (error) {
        throw error;
      }
    });

    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.payload, { error: 'Email already registered' });
  });

  it('publishes a viewing key using the chain type derived from the key name', async () => {
    const publishHandler = getRouteHandler('POST', '/keys/publish');
    const req = {
      body: {
        chainKey: 'solana-devnet',
        viewingKey: 'viewing-key-123',
        settlementAddress: 'So11111111111111111111111111111111111111112',
      },
      merchantId: '22222222-2222-4222-8222-222222222222',
    } as any;
    const res = createMockResponse();
    let upsertArgs: any;

    (prisma.chainViewingKey as any).upsert = async (args: any) => {
      upsertArgs = args;

      return {
        chainKey: args.create.chainKey,
      };
    };

    await publishHandler(req, res as never, (error?: unknown) => {
      if (error) {
        throw error;
      }
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      chainKey: 'solana-devnet',
      published: true,
    });
    assert.equal(upsertArgs.create.chainType, 'svm');
    assert.equal(upsertArgs.create.merchantId, '22222222-2222-4222-8222-222222222222');
  });

  it('forbids fetching another merchant profile', async () => {
    const getHandler = getRouteHandler('GET', '/:id');
    const req = {
      params: { id: '33333333-3333-4333-8333-333333333333' },
      merchantId: '44444444-4444-4444-8444-444444444444',
    } as any;
    const res = createMockResponse();

    (prisma.merchant as any).findUnique = async () => {
      throw new Error('should not query merchant details for forbidden request');
    };

    await getHandler(req, res as never, (error?: unknown) => {
      if (error) {
        throw error;
      }
    });

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.payload, { error: 'Forbidden' });
  });
});