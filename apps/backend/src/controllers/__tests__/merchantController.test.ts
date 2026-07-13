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

// SEC-002: mock the SSRF guard so controller tests don't hit real DNS.
// Individual tests override assertSafeWebhookUrl to simulate safe/unsafe URLs.
jest.mock('../../utils/urlSafety', () => {
  const assertSafeWebhookUrl = jest.fn();
  class UnsafeUrlError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnsafeUrlError';
    }
  }
  // The controllers delegate to `rejectUnsafeWebhookUrl` (single source of
  // truth for the 400 error contract — see review warning #10). Forward to
  // the mocked assert + UnsafeUrlError so existing tests keep working.
  const rejectUnsafeWebhookUrl = async (
    rawUrl: string | undefined,
    res: { status: (code: number) => { json: (body: unknown) => void } }
  ): Promise<boolean> => {
    if (rawUrl === undefined || rawUrl === null || rawUrl === '') return true;
    try {
      await assertSafeWebhookUrl(rawUrl);
      return true;
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        res.status(400).json({ error: e.message });
        return false;
      }
      throw e;
    }
  };
  return { assertSafeWebhookUrl, UnsafeUrlError, rejectUnsafeWebhookUrl };
});

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
const { assertSafeWebhookUrl: mockAssertSafeWebhookUrl } = require('../../utils/urlSafety') as {
  assertSafeWebhookUrl: jest.Mock;
};


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
    // By default the SSRF guard accepts all URLs; individual tests override
    // this to simulate an unsafe URL.
    mockAssertSafeWebhookUrl.mockResolvedValue(undefined);
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

    it('SEC-002: rejects a webhook URL that fails the SSRF guard with 400', async () => {
      const { UnsafeUrlError } = require('../../utils/urlSafety');
      mockAssertSafeWebhookUrl.mockRejectedValue(
        new UnsafeUrlError('Webhook URL points at a private/reserved IP')
      );

      const res = await request(app)
        .post('/merchant/register')
        .send({
          businessName: 'Evil Corp',
          email: 'evil@acme.com',
          webhookUrl: 'http://169.254.169.254/latest/meta-data/',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('private/reserved IP');
      // Must NOT create the merchant when the webhook URL is unsafe.
      expect(mockPrisma.merchant.create).not.toHaveBeenCalled();
    });

    it('SEC-003: creates pending merchant when NODE_ENV is production and auto-activate is off', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevAuto = process.env.MERCHANT_REGISTRATION_AUTO_ACTIVATE;
      process.env.NODE_ENV = 'production';
      delete process.env.MERCHANT_REGISTRATION_AUTO_ACTIVATE;

      mockPrisma.merchant.findUnique.mockResolvedValue(null);
      mockPrisma.merchant.create.mockResolvedValue({
        id: 'pending-merchant',
        businessName: 'Pending Co',
        email: 'pending@acme.com',
        status: 'pending',
      });

      const res = await request(app)
        .post('/merchant/register')
        .send({ businessName: 'Pending Co', email: 'pending@acme.com' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
      expect(res.body.message).toMatch(/pending activation/i);
      expect(mockPrisma.merchant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending' }),
        })
      );

      process.env.NODE_ENV = prevEnv;
      if (prevAuto !== undefined) {
        process.env.MERCHANT_REGISTRATION_AUTO_ACTIVATE = prevAuto;
      } else {
        delete process.env.MERCHANT_REGISTRATION_AUTO_ACTIVATE;
      }
    });

    it('SEC-003: rejects register without invite token when MERCHANT_REGISTRATION_TOKEN is set', async () => {
      const prev = process.env.MERCHANT_REGISTRATION_TOKEN;
      process.env.MERCHANT_REGISTRATION_TOKEN = 'invite-secret';

      const res = await request(app)
        .post('/merchant/register')
        .send({ businessName: 'No Token', email: 'notoken@acme.com' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MERCHANT_REGISTRATION_FORBIDDEN');
      expect(mockPrisma.merchant.create).not.toHaveBeenCalled();

      if (prev !== undefined) process.env.MERCHANT_REGISTRATION_TOKEN = prev;
      else delete process.env.MERCHANT_REGISTRATION_TOKEN;
    });

    it('SEC-003: accepts register with valid X-Registration-Token header', async () => {
      const prev = process.env.MERCHANT_REGISTRATION_TOKEN;
      process.env.MERCHANT_REGISTRATION_TOKEN = 'invite-secret';

      mockPrisma.merchant.findUnique.mockResolvedValue(null);
      mockPrisma.merchant.create.mockResolvedValue({
        id: 'invited-merchant',
        businessName: 'Invited Co',
        email: 'invited@acme.com',
        status: 'active',
      });

      const res = await request(app)
        .post('/merchant/register')
        .set('X-Registration-Token', 'invite-secret')
        .send({ businessName: 'Invited Co', email: 'invited@acme.com' });

      expect(res.status).toBe(201);
      expect(res.body.merchantId).toBe('invited-merchant');

      if (prev !== undefined) process.env.MERCHANT_REGISTRATION_TOKEN = prev;
      else delete process.env.MERCHANT_REGISTRATION_TOKEN;
    });
  });

  // ── publishKey ────────────────────────────────────────────────────────────

  describe('POST /merchant/keys', () => {
    // SEC-001: the directory serves these values unauthenticated, so publishKey
    // now rejects anything that is not a well-formed PUBLIC key. Use real
    // public keys per chain family in the happy-path tests.
    const EVM_PUBKEY =
      '0x02ba5734d8f7091719471e7f7ed6b9df170dc70cc661ca05e688601ad984f068b0';
    const SVM_PUBKEY = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    // Valid StrKey ed25519 public (all-zero payload + CRC16-XModem)
    const XLM_PUBKEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('upserts viewing key and returns success', async () => {
      mockPrisma.chainViewingKey.upsert.mockResolvedValue({
        chainKey: 'ethereum',
      });

      const res = await request(app)
        .post('/merchant/keys')
        .send({ chainKey: 'ethereum', viewingKey: EVM_PUBKEY, settlementAddress: '0xAbCdEf' });

      expect(res.status).toBe(200);
      expect(res.body.chainKey).toBe('ethereum');
      expect(res.body.published).toBe(true);
    });

    it('maps solana chain to svm type', async () => {
      mockPrisma.chainViewingKey.upsert.mockResolvedValue({ chainKey: 'solana' });

      await request(app)
        .post('/merchant/keys')
        .send({ chainKey: 'solana', viewingKey: SVM_PUBKEY, settlementAddress: 'SolanaAddress123' });

      expect(mockPrisma.chainViewingKey.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ chainType: 'svm' }) })
      );
    });

    it('maps stellar chain to xlm type', async () => {
      mockPrisma.chainViewingKey.upsert.mockResolvedValue({ chainKey: 'stellar' });

      await request(app)
        .post('/merchant/keys')
        .send({ chainKey: 'stellar', viewingKey: XLM_PUBKEY, settlementAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567' });

      expect(mockPrisma.chainViewingKey.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ chainType: 'xlm' }) })
      );
    });

    it('rejects unsupported chainKey (e.g. removed aptos)', async () => {
      const res = await request(app)
        .post('/merchant/keys')
        .send({ chainKey: 'aptos', viewingKey: 'vk_apt', settlementAddress: '0xAptosAddr' });

      expect(res.status).toBe(400);
      expect(mockPrisma.chainViewingKey.upsert).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid/missing fields', async () => {
      const res = await request(app)
        .post('/merchant/keys')
        .send({}); // no chainKey, no viewingKey, no settlementAddress

      expect(res.status).toBe(400);
    });

    // SEC-001: reject secret/private keys and malformed values before they can
    // ever be persisted and served by the unauthenticated directory endpoint.
    it('rejects an EVM private key (32-byte) instead of a public key', async () => {
      const res = await request(app)
        .post('/merchant/keys')
        .send({
          chainKey: 'ethereum',
          // 32-byte secp256k1 private key — must never be published.
          viewingKey:
            '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
          settlementAddress: '0xAbCdEf',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PUBLIC_VIEWING_KEY');
      expect(mockPrisma.chainViewingKey.upsert).not.toHaveBeenCalled();
    });

    it('rejects an off-curve EVM point', async () => {
      const res = await request(app)
        .post('/merchant/keys')
        .send({
          chainKey: 'ethereum',
          viewingKey: '0x02' + '11'.repeat(32),
          settlementAddress: '0xAbCdEf',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PUBLIC_VIEWING_KEY');
      expect(mockPrisma.chainViewingKey.upsert).not.toHaveBeenCalled();
    });

    it('rejects a placeholder / non-key EVM string', async () => {
      const res = await request(app)
        .post('/merchant/keys')
        .send({ chainKey: 'ethereum', viewingKey: 'vk_test_key', settlementAddress: '0xAbCdEf' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PUBLIC_VIEWING_KEY');
      expect(mockPrisma.chainViewingKey.upsert).not.toHaveBeenCalled();
    });

    it('rejects a Stellar secret seed (S…) published as a viewing key', async () => {
      const res = await request(app)
        .post('/merchant/keys')
        .send({
          chainKey: 'stellar',
          viewingKey: 'S' + 'A'.repeat(55),
          settlementAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PUBLIC_VIEWING_KEY');
      expect(mockPrisma.chainViewingKey.upsert).not.toHaveBeenCalled();
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

    it('SEC-002: rejects an unsafe webhookUrl update with 400', async () => {
      const { UnsafeUrlError } = require('../../utils/urlSafety');
      mockAssertSafeWebhookUrl.mockRejectedValue(
        new UnsafeUrlError('Webhook hostname \'localhost\' is blocked')
      );

      const res = await request(app)
        .patch('/merchant/merchant-uuid-1234')
        .send({ webhookUrl: 'https://localhost/admin' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('blocked');
      expect(mockPrisma.merchant.update).not.toHaveBeenCalled();
    });
  });
});
