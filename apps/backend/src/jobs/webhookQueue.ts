/**
 * Veilpay Webhook Queue Infrastructure (Producer)
 *
 * REL-002: durable outbox — persist a WebhookDelivery row (status=pending)
 * with a stable idempotency key BEFORE enqueue. The worker updates the same
 * row per attempt.
 */

import { Queue, Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { getRedisClient, getRedisInitError } from '../lib/redis';
import type { WebhookDeliveryPayload } from './webhookDelivery';
import { logger } from '../lib/logger';

let webhookQueueInstance: Queue<WebhookDeliveryPayload> | null = null;
let webhookDlqInstance: Queue<WebhookDeliveryPayload> | null = null;
let initAttempted = false;

function ensureQueueInitialized(): boolean {
  if (webhookQueueInstance && webhookDlqInstance) return true;
  if (initAttempted) return false;

  initAttempted = true;

  const redisConnection = getRedisClient();
  if (!redisConnection) {
    return false;
  }

  try {
    webhookQueueInstance = new Queue<WebhookDeliveryPayload>('webhook-delivery', {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { count: 100, age: 86400 },
        removeOnFail: { count: 50, age: 604800 },
      },
    });

    webhookDlqInstance = new Queue<WebhookDeliveryPayload>('webhook-dlq', {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: { count: 1000, age: 30 * 86400 },
        removeOnFail: false,
      },
    });

    logger.info('[WebhookQueue] Producer and DLQ initialized successfully');
    return true;
  } catch (err) {
    logger.warn(
      `[WebhookQueue] Failed to initialize Producer: ${err instanceof Error ? err.message : String(err)}`
    );
    webhookQueueInstance = null;
    webhookDlqInstance = null;
    return false;
  }
}

export function isWebhookQueueAvailable(): boolean {
  return webhookQueueInstance !== null;
}

export function initializeWebhookQueue(): boolean {
  return ensureQueueInitialized();
}

/**
 * Stable idempotency key for an event: merchant + eventType + invoice + payload timestamp.
 * Retries re-use the same deliveryId; they must not mint a new identity.
 */
export function buildWebhookJobId(payload: WebhookDeliveryPayload, deliveryId: string): string {
  return `wh-${deliveryId}`;
}

export async function enqueueWebhookDlq(
  payload: WebhookDeliveryPayload,
  failedReason: string | undefined
): Promise<Job<WebhookDeliveryPayload> | null> {
  if (!ensureQueueInitialized() || !webhookDlqInstance) {
    logger.error('[WebhookQueue] DLQ not available');
    return null;
  }

  try {
    const job = await webhookDlqInstance.add('webhook-dlq', payload, {
      jobId: `dlq-${payload.deliveryId || payload.merchantId}-${payload.invoiceId}-${Date.now()}`,
    });
    logger.info(
      `[WebhookQueue] Enqueued job ${job.id} into DLQ for merchant ${payload.merchantId}. Reason: ${failedReason}`
    );
    return job;
  } catch (err) {
    logger.error(
      `[WebhookQueue] DLQ add failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export async function enqueueWebhook(
  payload: WebhookDeliveryPayload
): Promise<Job<WebhookDeliveryPayload> | null> {
  // REL-002: create outbox row first (pending), then enqueue with that id.
  let deliveryId = payload.deliveryId;
  if (!deliveryId) {
    try {
      const row = await prisma.webhookDelivery.create({
        data: {
          merchantId: payload.merchantId,
          eventType: payload.eventType,
          payload: payload as unknown as Prisma.InputJsonValue,
          status: 'pending',
          retryCount: 0,
        },
        select: { id: true },
      });
      deliveryId = row.id;
    } catch (dbErr) {
      logger.error({ err: dbErr }, '[WebhookQueue] Failed to create outbox row');
      // Continue without durable id if DB write fails — still try queue.
    }
  }

  const enriched: WebhookDeliveryPayload = {
    ...payload,
    deliveryId,
  };

  if (!ensureQueueInitialized() || !webhookQueueInstance) {
    logger.warn(
      '[WebhookQueue] Queue not available — webhook fallback: %s %s',
      payload.eventType,
      payload.invoiceId
    );
    if (deliveryId) {
      await prisma.webhookDelivery
        .update({
          where: { id: deliveryId },
          data: {
            status: 'failed',
            error: `Webhook queue unavailable: ${getRedisInitError() || 'Redis not connected'}`,
            completedAt: new Date(),
          },
        })
        .catch((dbErr: unknown) => {
          logger.error({ err: dbErr }, '[WebhookQueue] Failed to mark outbox failed');
        });
    } else {
      await prisma.webhookDelivery
        .create({
          data: {
            merchantId: payload.merchantId,
            eventType: payload.eventType,
            payload: payload as unknown as Prisma.InputJsonValue,
            status: 'failed',
            error: `Webhook queue unavailable: ${getRedisInitError() || 'Redis not connected'}`,
            completedAt: new Date(),
          },
        })
        .catch((dbErr: unknown) => {
          logger.error({ err: dbErr }, '[WebhookQueue] Failed to persist fallback webhook record');
        });
    }
    return null;
  }

  let job: Job<WebhookDeliveryPayload> | null = null;
  try {
    const jobId = deliveryId
      ? buildWebhookJobId(enriched, deliveryId)
      : `${payload.merchantId}-${payload.invoiceId}-${payload.timestamp || Date.now()}`;
    job = await webhookQueueInstance.add('webhook-delivery', enriched, {
      jobId,
    });
    logger.info(`[WebhookQueue] Enqueued job ${job.id} for merchant ${payload.merchantId}`);
  } catch (err) {
    // BullMQ rejects duplicate jobId when a prior job still exists — treat as
    // idempotent success for the same outbox row.
    const msg = err instanceof Error ? err.message : String(err);
    if (deliveryId && /already exists|JobId/i.test(msg)) {
      logger.info(`[WebhookQueue] Job already enqueued for delivery ${deliveryId}`);
      return null;
    }
    logger.warn(
      '[WebhookQueue] Queue add failed — webhook fallback: %s %s',
      payload.eventType,
      payload.invoiceId
    );
    if (deliveryId) {
      await prisma.webhookDelivery
        .update({
          where: { id: deliveryId },
          data: {
            status: 'failed',
            error: `Webhook queue add failed: ${msg}`,
            completedAt: new Date(),
          },
        })
        .catch((dbErr: unknown) => {
          logger.error({ err: dbErr }, '[WebhookQueue] Failed to mark outbox failed');
        });
    }
  }

  return job;
}

/**
 * REL-002 recovery: re-enqueue deliveries that were left `pending` because the
 * process crashed between the outbox row create and the BullMQ add. Without
 * this sweep such a row is orphaned forever (webhook silently dropped).
 *
 * Idempotent: each stale row is passed back through `enqueueWebhook` reusing
 * its `deliveryId`, so the BullMQ `jobId` (`wh-<deliveryId>`) dedupes against a
 * job that already exists. Only rows older than ORPHAN_PENDING_AGE_MS are
 * touched, so an in-flight normal create is never raced.
 */
export const ORPHAN_PENDING_AGE_MS = 60_000;
export const ORPHAN_RECOVERY_BATCH = 100;

export async function recoverOrphanedPendingDeliveries(): Promise<number> {
  // W2: lazily initialize the producer rather than silently no-oping when the
  // producer wasn't initialized in this process (e.g. a worker-only or second
  // instance). When Redis is genuinely unavailable, ensureQueueInitialized
  // returns false and we skip without crashing.
  if (!ensureQueueInitialized()) {
    logger.warn(
      '[WebhookQueue] Recovery sweep skipped — queue producer unavailable'
    );
    return 0;
  }
  try {
    const cutoff = new Date(Date.now() - ORPHAN_PENDING_AGE_MS);
    const stale = await prisma.webhookDelivery.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
        // W1: skip rows already claimed by an earlier sweep (in-recovery), so
        // a restart cannot re-sweep a row the previous sweep already picked up.
        nextRetryAt: null,
      },
      orderBy: { createdAt: 'asc' },
      take: ORPHAN_RECOVERY_BATCH,
      select: { id: true, payload: true },
    });
    let reenqueued = 0;
    for (const row of stale) {
      const payload = row.payload as unknown as WebhookDeliveryPayload | null;
      if (!payload || typeof payload !== 'object') continue;

      // W1: the BullMQ `jobId` (`wh-<deliveryId>`) dedupe only holds while the
      // job still lives in Redis; `removeOnComplete` purges completed jobs. If
      // the job already exists in the queue (still queued/active) the enqueue
      // already happened — skip to avoid re-delivering a handled delivery.
      const jobId = buildWebhookJobId(payload, row.id);
      const existing = webhookQueueInstance
        ? await webhookQueueInstance.getJob(jobId)
        : null;
      if (existing) continue;

      // W1: claim the row before enqueue so this sweep's pick survives a
      // restart (in-flight re-enqueued job isn't re-swept). Revisit nextRetryAt
      // as the claim timestamp — it is a no-op field in the delivery flow.
      try {
        await prisma.webhookDelivery.update({
          where: { id: row.id },
          data: { nextRetryAt: new Date() },
        });
      } catch (claimErr) {
        logger.warn(
          { err: claimErr },
          `[WebhookQueue] Failed to claim delivery ${row.id}, skipping`
        );
        continue;
      }

      const job = await enqueueWebhook({ ...payload, deliveryId: row.id });
      if (job) {
        reenqueued += 1;
      } else {
        // Enqueue failed — revert the claim so the next sweep can retry it.
        await prisma.webhookDelivery
          .update({
            where: { id: row.id },
            data: { nextRetryAt: null },
          })
          .catch(() => undefined);
      }
    }
    if (reenqueued > 0) {
      logger.info(
        `[WebhookQueue] Recovery re-enqueued ${reenqueued} orphaned pending deliveries`
      );
    }
    return reenqueued;
  } catch (err) {
    logger.warn(
      `[WebhookQueue] Recovery sweep failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return 0;
  }
}

export async function closeWebhookQueue(): Promise<void> {
  if (webhookQueueInstance) {
    await webhookQueueInstance.close();
    webhookQueueInstance = null;
  }
  if (webhookDlqInstance) {
    await webhookDlqInstance.close();
    webhookDlqInstance = null;
  }
}
