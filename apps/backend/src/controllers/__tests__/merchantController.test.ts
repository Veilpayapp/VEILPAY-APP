import request from 'supertest';
import express from 'express';
import {
  registerMerchant,
  publishKey,
  getMerchant,
  getMerchantStats,
  updateMerchant,
} from '../merchantController';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Note: jest.mock factories are hoisted before variable declarations,
// so we cannot reference outer variables inside them. Instead, we define
// the mock inline and retrieve it via jest.mocked() after.

jest.mock('../../lib/prisma', () => ({
  prisma: {
    merchant: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    chainViewingKey: {
      upsert: jest.fn(),
    },
    invoice: {
      count: jest.fn(),
    },
    payment: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../middleware/auth', () => ({
  hashApiKey: (key: string) => `hashed_${key}`,
}));

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: () => 'aaaabbbb-cccc-dddd-eeee-ffffgggghhhh',
}));

jest.mock('../../types', () => ({
  uuidParamSchema: {
    parse: (params: any) => params,
  },
  MerchantUpdateRequestSchema: {
    parse: (data: any) => data,
  },
  MerchantUpdateResponseSchema: {
    parse: (data: any) => data,
  },
  MerchantStatsResponseSchema: {
    parse: (data: any) => data,
  },
}));

// Retrieve the mock prisma reference after mocking
const { prisma: mockPrisma } = require('../../lib/prisma') as { prisma: any };


// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject merchantId via middleware (simulating auth)
  const withAuth = (req: any, _res: any, next: any) => {
    req.merchantId = 'merchant-uuid-1234';
    next();
  };

  app.post('/merchant/register', registerMerchant);
  app.post('/merchant/keys', withAuth, publishKey);
  app.get('/merchant/:id', withAuth, getMerchant);
  app.get('/merchant/:id/stats', withAuth, getMerchantStats);
  app.patch('/merchant/:id', withAuth, updateMerchant);

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(400).json({ error: err.message });
  });

  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('merchantController', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── registerMerchant ──────────────────────────────────────────────────────

  describe('POST /merchant/register', () => {
    it('creates a new merchant and returns 201 with apiKey', async () => {
      mockPrisma.merchant.findUnique.mockResolvedValue(null);
      mockPrisma.merchant.create.mockResolvedValue({
        id: 'new-merchant-id',
        businessName: 'Acme Corp',
        email: 'admin@acme.com',
        status: 'active',
      });

      const res = await request(app)
        .post('/merchant/register')
        .send({ businessName: 'Acme Corp', email: 'admin@acme.com' });

      expect(res.status).toBe(201);
      expect(res.body.merchantId).toBe('new-merchant-id');
      expect(res.body.apiKey).toMatch(/^vp_/);
    });

    it('returns 409 when email is already registered', async () => {
      mockPrisma.merchant.findUnique.mockResolvedValue({ id: 'existing-id' });

      const res = await request(app)
        .post('/merchant/register')
        .send({ businessName: 'Acme Corp', email: 'existing@acme.com' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Email already registered');
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/merchant/register')
        .send({ businessName: 'No Email Corp' }); // missing email

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/merchant/register')
        .send({ businessName: 'Test Corp', email: 'not-an-email' });

      expect(res.status).toBe(400);
    });

    it('accepts optional webhookUrl', async () => {
      mockPrisma.merchant.findUnique.mockResolvedValue(null);
      mockPrisma.merchant.create.mockResolvedValue({
        id: 'webhook-merchant-id',
        businessName: 'Webhook Corp',
        email: 'hook@webhook.com',
        status: 'active',
      });

      const res = await request(app)
        .post('/merchant/register')
        .send({ businessName: 'Webhook Corp', email: 'hook@webhook.com', webhookUrl: 'https://example.com/webhook' });

      expect(res.status).toBe(201);
      expect(mockPrisma.merchant.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ webhookUrl: 'https://example.com/webhook' }) })
      );
    });
  });

  // ── publishKey ────────────────────────────────────────────────────────────

  describe('POST /merchant/keys', () => {
    it('upserts viewing key and returns success', async () => {
      mockPrisma.chainViewingKey.upsert.mockResolvedValue({
        chainKey: 'ethereum',
      });

      const res = await request(app)
        .post('/merchant/keys')
        .send({ chainKey: 'ethereum', viewingKey: 'vk_test_key', settlementAddress: '0xAbCdEf' });

      expect(res.status).toBe(200);
      expect(res.body.chainKey).toBe('ethereum');
      expect(res.body.published).toBe(true);
    });

    it('maps solana chain to svm type', async () => {
      mockPrisma.chainViewingKey.upsert.mockResolvedValue({ chainKey: 'solana' });

      await request(app)
        .post('/merchant/keys')
        .send({ chainKey: 'solana', viewingKey: 'vk_sol', settlementAddress: 'SolanaAddress123' });

      expect(mockPrisma.chainViewingKey.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ chainType: 'svm' }) })
      );
    });

    it('maps aptos chain to mvm type', async () => {
      mockPrisma.chainViewingKey.upsert.mockResolvedValue({ chainKey: 'aptos' });

      await request(app)
        .post('/merchant/keys')
        .send({ chainKey: 'aptos', viewingKey: 'vk_apt', settlementAddress: '0xAptosAddr' });

      expect(mockPrisma.chainViewingKey.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ chainType: 'mvm' }) })
      );
    });

    it('returns 400 for invalid/missing fields', async () => {
      const res = await request(app)
        .post('/merchant/keys')
        .send({}); // no chainKey, no viewingKey, no settlementAddress

      expect(res.status).toBe(400);
    });
  });

  // ── getMerchant ───────────────────────────────────────────────────────────

  describe('GET /merchant/:id', () => {
    it('returns merchant data when authenticated', async () => {
      mockPrisma.merchant.findUnique.mockResolvedValue({
        id: 'merchant-uuid-1234',
        businessName: 'Test Merchant',
        email: 'test@merchant.com',
        webhookUrl: null,
        status: 'active',
        tier: 'free',
        viewingKeys: [],
      });

      const res = await request(app).get('/merchant/merchant-uuid-1234');

      expect(res.status).toBe(200);
      expect(res.body.businessName).toBe('Test Merchant');
    });

    it('returns 403 when trying to access another merchant', async () => {
      const res = await request(app).get('/merchant/different-merchant-id');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('returns 404 when merchant does not exist', async () => {
      mockPrisma.merchant.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/merchant/merchant-uuid-1234');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Merchant not found');
    });
  });

  // ── getMerchantStats ──────────────────────────────────────────────────────

  describe('GET /merchant/:id/stats', () => {
    it('returns aggregated stats for merchant', async () => {
      mockPrisma.merchant.findUnique.mockResolvedValue({ id: 'merchant-uuid-1234' });
      mockPrisma.invoice.count.mockResolvedValue(10);
      mockPrisma.payment.count.mockResolvedValue(5);
      mockPrisma.payment.findMany
        .mockResolvedValueOnce([{ chainKey: 'ethereum', amount: '1.5' }, { chainKey: 'ethereum', amount: '2.5' }]) // chainVolumes
        .mockResolvedValueOnce([]); // recentPayments

      const res = await request(app).get('/merchant/merchant-uuid-1234/stats');

      expect(res.status).toBe(200);
      expect(res.body.merchantId).toBe('merchant-uuid-1234');
      expect(res.body.totalVolumeByChain.ethereum).toBeCloseTo(4.0);
    });

    it('returns 403 when accessing another merchant stats', async () => {
      const res = await request(app).get('/merchant/other-id/stats');
      expect(res.status).toBe(403);
    });

    it('returns 404 when merchant not found', async () => {
      mockPrisma.merchant.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/merchant/merchant-uuid-1234/stats');
      expect(res.status).toBe(404);
    });
  });

  // ── updateMerchant ────────────────────────────────────────────────────────

  describe('PATCH /merchant/:id', () => {
    it('updates business name successfully', async () => {
      mockPrisma.merchant.update.mockResolvedValue({
        id: 'merchant-uuid-1234',
        businessName: 'New Name Corp',
        email: 'test@merchant.com',
        webhookUrl: null,
        status: 'active',
        tier: 'free',
        updatedAt: new Date(),
      });

      const res = await request(app)
        .patch('/merchant/merchant-uuid-1234')
        .send({ businessName: 'New Name Corp' });

      expect(res.status).toBe(200);
      expect(res.body.businessName).toBe('New Name Corp');
    });

    it('returns 400 when no fields provided', async () => {
      const res = await request(app)
        .patch('/merchant/merchant-uuid-1234')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No fields to update');
    });

    it('returns 403 when updating another merchant', async () => {
      const res = await request(app)
        .patch('/merchant/different-id')
        .send({ businessName: 'Hacker' });

      expect(res.status).toBe(403);
    });
  });
});
