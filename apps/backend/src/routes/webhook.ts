import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { config } from '../config';
import { authMiddleware, requireAuth, type AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const webhookTestSchema = z.object({
  merchantId: z.string().uuid(),
  eventType: z.enum(['payment.received', 'invoice.paid', 'invoice.expired']),
  payload: z.record(z.any()),
});

// M1 fix: require full authMiddleware on the test endpoint.
// Previously this endpoint was unauthenticated — anyone could POST to it.
router.post('/test', authMiddleware, requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const data = webhookTestSchema.parse(req.body);

    // Ensure the authenticated merchant can only test their own webhooks.
    if (data.merchantId !== req.merchantId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    res.json({
      success: true,
      message: 'Webhook test received',
      eventType: data.eventType,
      merchantId: data.merchantId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify', async (req, res, next) => {
  try {
    const signatureHeader = req.headers['x-veilpay-signature'];
    const timestampHeader = req.headers['x-veilpay-timestamp'];

    const signature = typeof signatureHeader === 'string' ? signatureHeader : '';
    const timestamp = typeof timestampHeader === 'string' ? timestampHeader : '';
    
    if (!signature) {
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    if (!timestamp) {
      res.status(401).json({ error: 'Missing timestamp' });
      return;
    }

    const timestampNum = parseInt(timestamp, 10);
    if (isNaN(timestampNum) || Math.abs(Date.now() - timestampNum) > 300000) {
      res.status(401).json({ error: 'Invalid or expired timestamp' });
      return;
    }

    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
    const expected = createHmac('sha256', config.webhookSigningSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    if (signature.length !== expected.length || !/^[0-9a-fA-F]+$/.test(signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    
    res.json({
      verified: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export { router as webhookRoutes };
