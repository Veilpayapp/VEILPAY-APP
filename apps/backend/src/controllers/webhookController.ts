import type { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { enqueueWebhook } from '../jobs/webhookQueue';
import { resolveWebhookSigningSecret } from '../lib/webhookSecret';
import type { WebhookDeliveryPayload } from '../jobs/webhookDelivery';

const webhookTestSchema = z.object({
  merchantId: z.string().uuid(),
  eventType: z.enum(['payment.received', 'invoice.paid', 'invoice.expired']),
  payload: z.record(z.any()),
});

// Optional merchant identifier for signature verification: a UUID either as
// the `?merchantId=` query param or as the `merchantId` field of the JSON
// body being verified (delivered webhook payloads carry merchantId). When
// present, the merchant's per-merchant webhook secret is used; when absent
// (or unknown merchant), verification falls back to the global secret.
const merchantIdSchema = z.string().uuid();

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

/**
 * Resolve the merchant identifier a verification request is scoped to.
 * Accepted forms (first hit wins):
 *   1. `?merchantId=<uuid>` query param
 *   2. a `merchantId` field inside the JSON raw body being verified
 *      (every delivered webhook payload carries merchantId)
 * Returns null when no valid identifier is present — callers then fall
 * back to the global signing secret.
 */
function extractMerchantId(req: Request & { rawBody?: string }): string | null {
  const queryId = req.query?.merchantId;
  if (typeof queryId === 'string' && queryId.length > 0) {
    const parsed = merchantIdSchema.safeParse(queryId);
    if (parsed.success) return parsed.data;
    return null;
  }
  try {
    const body = JSON.parse(req.rawBody ?? '');
    if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).merchantId === 'string') {
      const parsed = merchantIdSchema.safeParse((body as Record<string, unknown>).merchantId);
      if (parsed.success) return parsed.data;
    }
  } catch {
    // rawBody is not JSON — no embedded merchantId.
  }
  return null;
}

export const verifyWebhook = async (
  req: Request & { rawBody?: string },
  res: Response,
  next: NextFunction,
): Promise<void> => {
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

    // Per-merchant signing: when the request identifies a merchant, verify
    // against that merchant's webhookSecret. Merchants that have not been
    // rotated yet (or unknown ids) fall back to the global env secret —
    // resolveWebhookSigningSecret handles both and warns on the fallback.
    const merchantId = extractMerchantId(req);
    let merchantWebhookSecret: string | null | undefined;
    if (merchantId) {
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { webhookSecret: true },
      });
      merchantWebhookSecret = merchant?.webhookSecret ?? null;
    }
    const signingSecret = resolveWebhookSigningSecret(merchantWebhookSecret);

    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
    const expected = createHmac('sha256', signingSecret)
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

    // Update DB status to retrying. The post-increment retryCount is this
    // attempt's number — each manual retry must mint a FRESH BullMQ jobId.
    const updated = await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'retrying',
        retryCount: { increment: 1 }
      },
    });

    // D5: re-deliver THIS outbox row with a per-attempt jobId
    // (`wh-<deliveryId>-retry-<attempt>`). Re-using the deterministic
    // `wh-<deliveryId>` id let BullMQ dedupe the add as "already exists" —
    // the endpoint answered 200 while nothing was re-delivered. The stored
    // payload may predate deliveryId enrichment, so re-attach it: without
    // it enqueueWebhook would mint a duplicate outbox row instead of
    // retrying this one.
    const storedPayload = (delivery.payload ?? {}) as unknown as Record<string, unknown>;
    const attempt = updated.retryCount ?? (delivery.retryCount ?? 0) + 1;
    await enqueueWebhook(
      { ...storedPayload, deliveryId } as unknown as WebhookDeliveryPayload,
      { attempt }
    );

    res.json({ success: true, message: 'Webhook re-queued for delivery' });
  } catch (error) {
    next(error);
  }
};
