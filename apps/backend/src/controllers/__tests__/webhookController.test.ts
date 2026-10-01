import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { enqueueWebhook } from '../../jobs/webhookQueue';
import { testWebhook, verifyWebhook, getFailedWebhooks, retryWebhook } from '../webhookController';
import { createHmac } from 'crypto';
import { logger } from '../../lib/logger';
import { __testing__ as webhookSecretTesting } from '../../lib/webhookSecret';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    merchant: {
      findUnique: jest.fn(),
    },
    webhookDelivery: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../../jobs/webhookQueue', () => ({
  enqueueWebhook: jest.fn(),
}));

// Keep the mocked global secret at 'test-secret' — the legacy verify tests
// below compute their expected HMACs with it.
jest.mock('../../config', () => ({
  config: {
    webhookSigningSecret: 'test-secret',
  },
}));

describe('webhookController', () => {
  let req: Partial<Request> & { merchantId?: string, rawBody?: string };
  let res: Partial<Response>;
  let next: jest.Mock;
  const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    webhookSecretTesting.resetGlobalFallbackWarning();
    req = {
      merchantId: '00000000-0000-0000-0000-000000000000',
      params: {},
      query: {},
      body: {},
      headers: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe('testWebhook', () => {
    it('returns success for valid request', () => {
      req.body = {
        merchantId: '00000000-0000-0000-0000-000000000000',
        eventType: 'payment.received',
        payload: { test: true },
      };

      testWebhook(req as any, res as any, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Webhook test received',
        eventType: 'payment.received',
        merchantId: '00000000-0000-0000-0000-000000000000',
      }));
    });

    it('returns 403 if merchantId does not match', () => {
      req.body = {
        merchantId: '11111111-1111-1111-1111-111111111111',
        eventType: 'payment.received',
        payload: { test: true },
      };

      testWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
    });

    it('calls next on invalid body', () => {
      req.body = {
        // missing fields
      };

      testWebhook(req as any, res as any, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('verifyWebhook', () => {
    it('verifies a valid webhook signature', () => {
      const timestamp = Date.now().toString();
      const rawBody = '{"test":true}';
      const expectedSignature = createHmac('sha256', 'test-secret')
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      req.headers = {
        'x-veilpay-signature': expectedSignature,
        'x-veilpay-timestamp': timestamp,
      };
      req.rawBody = rawBody;

      verifyWebhook(req as any, res as any, next);

      expect(res.json).toHaveBeenCalledWith({
        verified: true,
        timestamp: expect.any(String),
      });
    });

    it('returns 401 if missing signature', () => {
      req.headers = {
        'x-veilpay-timestamp': Date.now().toString(),
      };

      verifyWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing signature' });
    });

    it('returns 401 if missing timestamp', () => {
      req.headers = {
        'x-veilpay-signature': 'sig',
      };

      verifyWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing timestamp' });
    });

    it('returns 401 if timestamp is too old', () => {
      const oldTimestamp = (Date.now() - 400000).toString(); // > 300000 ms
      req.headers = {
        'x-veilpay-signature': 'sig',
        'x-veilpay-timestamp': oldTimestamp,
      };

      verifyWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired timestamp' });
    });

    it('returns 401 on invalid signature format', () => {
      const timestamp = Date.now().toString();
      req.headers = {
        'x-veilpay-signature': 'invalid-format!',
        'x-veilpay-timestamp': timestamp,
      };

      verifyWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
    });

    it('returns 401 on mismatched signature', () => {
      const timestamp = Date.now().toString();
      const rawBody = '{"test":true}';

      // Use wrong secret to generate mismatching signature
      const expectedSignature = createHmac('sha256', 'wrong-secret')
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      req.headers = {
        'x-veilpay-signature': expectedSignature,
        'x-veilpay-timestamp': timestamp,
      };
      req.rawBody = rawBody;

      verifyWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
    });

    // ── Round 4: per-merchant webhook secret verification ─────────────────

    it('verifies with the merchant webhookSecret when the body carries a merchantId', async () => {
      const merchantId = '22222222-2222-2222-2222-222222222222';
      const timestamp = Date.now().toString();
      const rawBody = `{"merchantId":"${merchantId}","amount":"10"}`;
      // signed with the MERCHANT secret, not the global one
      const signature = createHmac('sha256', 'whsec_merchant_abc')
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue({
        webhookSecret: 'whsec_merchant_abc',
      });

      req.headers = {
        'x-veilpay-signature': signature,
        'x-veilpay-timestamp': timestamp,
      };
      req.rawBody = rawBody;

      await verifyWebhook(req as any, res as any, next);

      expect(prisma.merchant.findUnique).toHaveBeenCalledWith({
        where: { id: merchantId },
        select: { webhookSecret: true },
      });
      expect(res.json).toHaveBeenCalledWith({
        verified: true,
        timestamp: expect.any(String),
      });
      // per-merchant verification must not warn
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('rejects a global-secret signature when the merchant has a per-merchant secret', async () => {
      const merchantId = '22222222-2222-2222-2222-222222222222';
      const timestamp = Date.now().toString();
      const rawBody = `{"merchantId":"${merchantId}","amount":"10"}`;
      // signed with the GLOBAL secret while the merchant expects its own
      const signature = createHmac('sha256', 'test-secret')
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue({
        webhookSecret: 'whsec_merchant_abc',
      });

      req.headers = {
        'x-veilpay-signature': signature,
        'x-veilpay-timestamp': timestamp,
      };
      req.rawBody = rawBody;

      await verifyWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
    });

    it('accepts a merchantId query param and uses that merchant secret', async () => {
      const merchantId = '33333333-3333-3333-3333-333333333333';
      const timestamp = Date.now().toString();
      const rawBody = '{"note":"query-param identification"}';
      const signature = createHmac('sha256', 'whsec_query_param')
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue({
        webhookSecret: 'whsec_query_param',
      });

      req.query = { merchantId };
      req.headers = {
        'x-veilpay-signature': signature,
        'x-veilpay-timestamp': timestamp,
      };
      req.rawBody = rawBody;

      await verifyWebhook(req as any, res as any, next);

      expect(prisma.merchant.findUnique).toHaveBeenCalledWith({
        where: { id: merchantId },
        select: { webhookSecret: true },
      });
      expect(res.json).toHaveBeenCalledWith({
        verified: true,
        timestamp: expect.any(String),
      });
    });

    it('falls back to the global secret (deprecated, warns once) for a merchant without a secret', async () => {
      const merchantId = '22222222-2222-2222-2222-222222222222';
      const timestamp = Date.now().toString();
      const rawBody = `{"merchantId":"${merchantId}","amount":"10"}`;
      const signature = createHmac('sha256', 'test-secret')
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue({
        webhookSecret: null,
      });

      req.headers = {
        'x-veilpay-signature': signature,
        'x-veilpay-timestamp': timestamp,
      };
      req.rawBody = rawBody;

      await verifyWebhook(req as any, res as any, next);

      // verified via the deprecated global fallback…
      expect(res.json).toHaveBeenCalledWith({
        verified: true,
        timestamp: expect.any(String),
      });
      // …and the fallback warned exactly once
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0])).toContain('DEPRECATED');
    });

    it('falls back to the global secret without a DB lookup when no merchant is identified', async () => {
      const timestamp = Date.now().toString();
      const rawBody = '{"test":true}';
      const signature = createHmac('sha256', 'test-secret')
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      req.headers = {
        'x-veilpay-signature': signature,
        'x-veilpay-timestamp': timestamp,
      };
      req.rawBody = rawBody;

      await verifyWebhook(req as any, res as any, next);

      // legacy callers (no merchantId anywhere) never hit the DB
      expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        verified: true,
        timestamp: expect.any(String),
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to the global secret for an UNKNOWN merchantId without 404ing', async () => {
      const merchantId = '44444444-4444-4444-4444-444444444444';
      const timestamp = Date.now().toString();
      const rawBody = `{"merchantId":"${merchantId}","amount":"10"}`;
      const signature = createHmac('sha256', 'test-secret')
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue(null);

      req.headers = {
        'x-veilpay-signature': signature,
        'x-veilpay-timestamp': timestamp,
      };
      req.rawBody = rawBody;

      await verifyWebhook(req as any, res as any, next);

      expect(res.json).toHaveBeenCalledWith({
        verified: true,
        timestamp: expect.any(String),
      });
    });
  });

  describe('getFailedWebhooks', () => {
    it('returns a list of failed webhooks', async () => {
      const failedDeliveries = [{ id: '1', status: 'failed' }];
      (prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue(failedDeliveries);

      await getFailedWebhooks(req as any, res as any, next);

      expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith({
        where: {
          merchantId: req.merchantId,
          status: 'failed',
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        deliveries: failedDeliveries,
      });
    });

    it('calls next on error', async () => {
      (prisma.webhookDelivery.findMany as jest.Mock).mockRejectedValue(new Error('DB error'));

      await getFailedWebhooks(req as any, res as any, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('retryWebhook', () => {
    it('re-queues a failed webhook with a fresh per-attempt job (D5)', async () => {
      req.params = { id: 'webhook-1' };
      const delivery = {
        id: 'webhook-1',
        merchantId: '00000000-0000-0000-0000-000000000000',
        status: 'failed',
        retryCount: 0,
        payload: { test: true },
      };

      (prisma.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(delivery);
      (prisma.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...delivery,
        status: 'retrying',
        retryCount: 1,
      });

      await retryWebhook(req as any, res as any, next);

      expect(prisma.webhookDelivery.findUnique).toHaveBeenCalledWith({
        where: { id: 'webhook-1' },
      });
      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'webhook-1' },
        data: {
          status: 'retrying',
          retryCount: { increment: 1 },
        },
      });
      // D5: the retry re-queues THIS delivery row (deliveryId re-attached)
      // with the already-incremented retryCount as the attempt number, so
      // the queue mints a fresh per-attempt jobId instead of hitting
      // BullMQ's duplicate-id swallow.
      expect(enqueueWebhook).toHaveBeenCalledWith(
        { test: true, deliveryId: 'webhook-1' },
        { attempt: 1 }
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Webhook re-queued for delivery',
      });
    });

    it('increments the attempt number on every subsequent retry (D5)', async () => {
      req.params = { id: 'webhook-1' };
      const delivery = {
        id: 'webhook-1',
        merchantId: '00000000-0000-0000-0000-000000000000',
        status: 'failed',
        retryCount: 4,
        payload: { eventType: 'invoice.paid' },
      };

      (prisma.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(delivery);
      (prisma.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...delivery,
        status: 'retrying',
        retryCount: 5,
      });

      await retryWebhook(req as any, res as any, next);

      expect(enqueueWebhook).toHaveBeenCalledWith(
        { eventType: 'invoice.paid', deliveryId: 'webhook-1' },
        { attempt: 5 }
      );
    });

    it('returns 404 if webhook not found', async () => {
      req.params = { id: 'webhook-1' };
      (prisma.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(null);

      await retryWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Webhook delivery not found' });
    });

    it('returns 404 if merchantId does not match', async () => {
      req.params = { id: 'webhook-1' };
      const delivery = {
        id: 'webhook-1',
        merchantId: '11111111-1111-1111-1111-111111111111',
      };
      (prisma.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(delivery);

      await retryWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Webhook delivery not found' });
    });

    it('returns 400 if webhook is not failed', async () => {
      req.params = { id: 'webhook-1' };
      const delivery = {
        id: 'webhook-1',
        merchantId: '00000000-0000-0000-0000-000000000000',
        status: 'delivered', // not failed
      };
      (prisma.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(delivery);

      await retryWebhook(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Only failed webhooks can be retried' });
    });

    it('calls next on error', async () => {
      req.params = { id: 'webhook-1' };
      (prisma.webhookDelivery.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));

      await retryWebhook(req as any, res as any, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });
});
