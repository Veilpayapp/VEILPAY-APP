/**
 * VeilPay Webhook Queue Infrastructure (Consumer)
 *
 * REL-002: updates the outbox WebhookDelivery row on each attempt when
 * payload.deliveryId is present.
 */

import { Worker, Job, QueueEvents } from 'bullmq';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import { getRedisClient } from '../lib/redis';
import { deliverWebhook, type WebhookDeliveryPayload } from './webhookDelivery';
import { incrementWebhookDeliveryAttempt } from '../utils/metrics';
import { logger } from '../lib/logger';
import { enqueueWebhookDlq } from './webhookQueue';

let webhookWorkerInstance: Worker<WebhookDeliveryPayload> | null = null;
let queueEventsInstance: QueueEvents | null = null;
let initAttempted = false;

export function initializeWebhookWorker(): boolean {
  if (webhookWorkerInstance) return true;
  if (initAttempted) return false;

  initAttempted = true;

  const redisConnection = getRedisClient();
  if (!redisConnection) {
    return false;
  }

  try {
    webhookWorkerInstance = new Worker<WebhookDeliveryPayload>(
      'webhook-delivery',
      async (job: Job<WebhookDeliveryPayload>): Promise<void> => {
        const payload = job.data;

        const merchant = await prisma.merchant.findUnique({
          where: { id: payload.merchantId },
          select: { webhookUrl: true },
        });

        if (!merchant?.webhookUrl) {
          logger.warn(
            `[WebhookWorker] No webhook URL for merchant ${payload.merchantId}, skipping`
          );
          if (payload.deliveryId) {
            await prisma.webhookDelivery
              .update({
                where: { id: payload.deliveryId },
                data: {
                  status: 'failed',
                  error: 'No webhook URL configured',
                  completedAt: new Date(),
                  retryCount: job.attemptsMade + 1,
                },
              })
              .catch(() => undefined);
          }
          return;
        }

        logger.info(`[WebhookWorker] Delivering job ${job.id} to ${merchant.webhookUrl}`);

        // Mark retrying on subsequent attempts
        if (payload.deliveryId && job.attemptsMade > 0) {
          await prisma.webhookDelivery
            .update({
              where: { id: payload.deliveryId },
              data: {
                status: 'retrying',
                retryCount: job.attemptsMade,
              },
            })
            .catch(() => undefined);
        }

        const result = await deliverWebhook(merchant.webhookUrl, payload);

        const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 3);

        if (result.success || isFinalAttempt) {
          incrementWebhookDeliveryAttempt(
            result.success ? 'success' : 'permanent_failure'
          );

          if (!result.success && isFinalAttempt) {
            await enqueueWebhookDlq(payload, result.lastError);
          }

          if (payload.deliveryId) {
            await prisma.webhookDelivery.update({
              where: { id: payload.deliveryId },
              data: {
                status: result.success ? 'delivered' : 'failed',
                statusCode: result.statusCode,
                error: result.lastError,
                retryCount: job.attemptsMade + 1,
                completedAt: result.success ? new Date() : new Date(),
                payload: payload as unknown as Prisma.InputJsonValue,
              },
            });
          } else {
            // Legacy path: no outbox id — create final record.
            await prisma.webhookDelivery.create({
              data: {
                merchantId: payload.merchantId,
                eventType: payload.eventType,
                payload: payload as unknown as Prisma.InputJsonValue,
                status: result.success ? 'delivered' : 'failed',
                statusCode: result.statusCode,
                error: result.lastError,
                retryCount: job.attemptsMade + 1,
                completedAt: result.success ? new Date() : undefined,
              },
            });
          }
        } else if (payload.deliveryId) {
          // Intermediate failure — keep pending/retrying identity.
          await prisma.webhookDelivery
            .update({
              where: { id: payload.deliveryId },
              data: {
                status: 'retrying',
                statusCode: result.statusCode,
                error: result.lastError,
                retryCount: job.attemptsMade + 1,
              },
            })
            .catch(() => undefined);
        }

        if (!result.success) {
          throw new Error(`Webhook delivery failed: ${result.lastError || 'Unknown'}`);
        }

        logger.info(`[WebhookWorker] Successfully delivered job ${job.id}`);
      },
      {
        connection: redisConnection,
        concurrency: 5,
        lockDuration: 30000,
      }
    );

    queueEventsInstance = new QueueEvents('webhook-delivery', {
      connection: redisConnection,
    });

    queueEventsInstance.on('completed', ({ jobId }) => {
      logger.info(`[WebhookWorker] Job ${jobId} completed`);
    });

    queueEventsInstance.on('failed', ({ jobId, failedReason }) => {
      logger.error(
        `[WebhookWorker] Job ${jobId} failed permanently: ${failedReason}`
      );
    });

    logger.info('[WebhookWorker] Consumer initialized successfully');
    return true;
  } catch (err) {
    logger.warn(
      `[WebhookWorker] Failed to initialize Consumer: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error('Init error:', err);
    webhookWorkerInstance = null;
    queueEventsInstance = null;
    return false;
  }
}

export async function closeWebhookWorker(): Promise<void> {
  if (webhookWorkerInstance) {
    await webhookWorkerInstance.close();
    webhookWorkerInstance = null;
  }
  if (queueEventsInstance) {
    await queueEventsInstance.close();
    queueEventsInstance = null;
  }
}
