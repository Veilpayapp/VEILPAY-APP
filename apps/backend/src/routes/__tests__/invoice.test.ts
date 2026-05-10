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
const { invoiceRoutes } = require('../invoice');

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
  const layer = invoiceRoutes.stack.find((entry: any) => {
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

describe('invoice routes', () => {
  let originalFindUnique: unknown;
  let originalCreate: unknown;
  let originalUpdate: unknown;

  beforeEach(() => {
    originalFindUnique = (prisma.invoice as any).findUnique;
    originalCreate = (prisma.invoice as any).create;
    originalUpdate = (prisma.invoice as any).update;
  });

  afterEach(() => {
    (prisma.invoice as any).findUnique = originalFindUnique;
    (prisma.invoice as any).create = originalCreate;
    (prisma.invoice as any).update = originalUpdate;
    (prisma.chainViewingKey as any).findUnique = undefined;
  });

  after(() => {
    process.env = ORIGINAL_ENV;
  });

  it('creates an invoice for the authenticated merchant', async () => {
    const createHandler = getRouteHandler('POST', '/create');
    const req = {
      body: {
        merchantId: '11111111-1111-4111-8111-111111111111',
        chainKey: 'ethereum',
        tokenSymbol: 'USDC',
        amount: '100.00',
        memo: 'Order #12345',
        expiresInMinutes: 60,
        privacyLevel: 'standard',
      },
      merchantId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockResponse();
    let viewingKeyLookups = 0;

    (prisma.chainViewingKey as any).findUnique = async () => {
      viewingKeyLookups += 1;

      return {
      settlementAddress: '0x1111111111111111111111111111111111111111',
      };
    };
    (prisma.invoice as any).create = async ({ data }: any) => ({
      id: '55555555-5555-4555-8555-555555555555',
      merchantId: data.merchantId,
      chainKey: data.chainKey,
      tokenSymbol: data.tokenSymbol,
      amount: data.amount,
      memo: data.memo,
      privacyLevel: data.privacyLevel,
      status: 'pending',
      paymentAddress: data.paymentAddress,
      paymentTxHash: null,
      paidAt: null,
      expiresAt: data.expiresAt,
    });

    await createHandler(req, res as never, (error?: unknown) => {
      if (error) {
        throw error;
      }
    });

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.payload, {
      invoiceId: '55555555-5555-4555-8555-555555555555',
      merchantId: '11111111-1111-4111-8111-111111111111',
      status: 'pending',
      paymentAddress: '0x1111111111111111111111111111111111111111',
      paymentTxHash: undefined,
      paidAt: undefined,
      expiresAt: new Date(res.payload.expiresAt),
      chainKey: 'ethereum',
      tokenSymbol: 'USDC',
      amount: '100.00',
      memo: 'Order #12345',
      privacyLevel: 'standard',
    });
    assert.equal(viewingKeyLookups, 1);
  });

  it('rejects invoice creation when the merchant id does not match the authenticated merchant', async () => {
    const createHandler = getRouteHandler('POST', '/create');
    const req = {
      body: {
        merchantId: '22222222-2222-4222-8222-222222222222',
        chainKey: 'ethereum',
        tokenSymbol: 'USDC',
        amount: '100.00',
        expiresInMinutes: 60,
        privacyLevel: 'standard',
      },
      merchantId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockResponse();

    (prisma.chainViewingKey as any).findUnique = async () => {
      throw new Error('should not query viewing keys on forbidden request');
    };

    await createHandler(req, res as never, (error?: unknown) => {
      if (error) {
        throw error;
      }
    });

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.payload, { error: 'Forbidden' });
  });

  it('returns invoice status without requiring auth', async () => {
    const statusHandler = getRouteHandler('GET', '/:id/status');
    const req = {
      params: { id: '66666666-6666-4666-8666-666666666666' },
    } as any;
    const res = createMockResponse();

    (prisma.invoice as any).findUnique = async () => ({
      id: '66666666-6666-4666-8666-666666666666',
      status: 'paid',
      paymentAddress: '0x1111111111111111111111111111111111111111',
      paymentTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      paidAt: new Date('2026-04-22T12:00:00.000Z'),
      expiresAt: new Date('2026-04-22T13:00:00.000Z'),
    });

    await statusHandler(req, res as never, (error?: unknown) => {
      if (error) {
        throw error;
      }
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      invoiceId: '66666666-6666-4666-8666-666666666666',
      status: 'paid',
      paymentAddress: '0x1111111111111111111111111111111111111111',
      paymentTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      paidAt: new Date('2026-04-22T12:00:00.000Z'),
      expiresAt: new Date('2026-04-22T13:00:00.000Z'),
    });
  });

  it('prevents cancelling invoices that are no longer pending', async () => {
    const cancelHandler = getRouteHandler('POST', '/:id/cancel');
    const req = {
      params: { id: '77777777-7777-4777-8777-777777777777' },
      merchantId: '11111111-1111-4111-8111-111111111111',
    } as any;
    const res = createMockResponse();

    (prisma.invoice as any).findUnique = async () => ({
      id: '77777777-7777-4777-8777-777777777777',
      merchantId: '11111111-1111-4111-8111-111111111111',
      status: 'paid',
    });

    await cancelHandler(req, res as never, (error?: unknown) => {
      if (error) {
        throw error;
      }
    });

    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.payload, { error: 'Only pending invoices can be cancelled' });
  });
});