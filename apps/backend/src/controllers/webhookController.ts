import type { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { config } from '../config';
import type { AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { enqueueWebhook } from '../jobs/webhookQueue';
import type { WebhookDeliveryPayload } from '../jobs/webhookDelivery';

const webhookTestSchema = z.object({
  merchantId: z.string().uuid(),
  eventType: z.enum(['payment.received', 'invoice.paid', 'invoice.expired']),
  payload: z.record(z.any()),
});

export const testWebhook = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const data = webhookTestSchema.parse(req.body);

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
};

export const verifyWebhook = (
  req: Request & { rawBody?: string },
  res: Response,
  next: NextFunction,
): void => {
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
};

export const getFailedWebhooks = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const failedDeliveries = await prisma.webhookDelivery.findMany({
      where: {
        merchantId: req.merchantId,
        status: 'failed',
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, deliveries: failedDeliveries });
  } catch (error) {
    next(error);
  }
};

export const retryWebhook = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const deliveryId = req.params.id;
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery || delivery.merchantId !== req.merchantId) {
      res.status(404).json({ error: 'Webhook delivery not found' });
      return;
    }

    if (delivery.status !== 'failed') {
      res.status(400).json({ error: 'Only failed webhooks can be retried' });
      return;
    }

    // Update DB status to retrying
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { 
        status: 'retrying',
        retryCount: { increment: 1 }
      },
    });

    // Re-queue the job
    await enqueueWebhook(delivery.payload as unknown as WebhookDeliveryPayload);

    res.json({ success: true, message: 'Webhook re-queued for delivery' });
  } catch (error) {
    next(error);
  }
};
