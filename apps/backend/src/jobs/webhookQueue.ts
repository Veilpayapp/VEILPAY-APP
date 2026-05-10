/**
 * VeilPay Webhook Queue Infrastructure
 *
 * Production-grade BullMQ + Redis queue for reliable webhook delivery.
 * - LAZY initialization: Redis connects on first use, not at module import (ST-H2 fix)
 * - Proper Redis URL parsing using URL constructor (ST-M4 fix)
 * - 3 retry attempts with exponential backoff (5s, 30s, 120s)
 * - HMAC-SHA256 payload signing for merchant verification
 * - Graceful degradation: server runs without Redis, webhook queue is disabled
 * - Graceful shutdown with worker.close()
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';
import { WebhookDeliveryPayload, deliverWebhook } from './webhookDelivery';
import { prisma } from '../lib/prisma';

// ────────────────────────────────────────────────────────────────────────────
// Redis Connection (lazy — ST-H2 fix)
// ────────────────────────────────────────────────────────────────────────────

let redisConnection: Redis | null = null;
let webhookQueueInstance: Queue<WebhookDeliveryPayload> | null = null;
let webhookWorkerInstance: Worker<WebhookDeliveryPayload> | null = null;
let queueEventsInstance: QueueEvents | null = null;
let initAttempted = false;
let initError: string | null = null;

/**
 * Parse Redis URL properly (ST-M4 fix)
 * Handles redis://, rediss://, host:port, and standard URL formats
 */
function parseRedisUrl(rawUrl: string): { host: string; port: number; password?: string; tls?: boolean } {
  try {
    // Handle simple host:port format (no scheme)
    if (!rawUrl.includes('://')) {
      const [host, portStr] = rawUrl.split(':');
      return {
        host: host || 'localhost',
        port: parseInt(portStr || '6379', 10),
      };
    }

    const parsed = new URL(rawUrl);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? true : undefined,
    };
  } catch {
    console.warn(`[WebhookQueue] Failed to parse Redis URL "${rawUrl}", falling back to localhost:6379`);
    return { host: 'localhost', port: 6379 };
  }
}

/**
 * Lazy initialization of Redis + BullMQ.
 * Called on first enqueue attempt. If Redis is down, the server still runs.
 */
function ensureInitialized(): boolean {
  if (webhookQueueInstance) return true;
  if (initAttempted) return false;

  initAttempted = true;

  try {
    const parsed = parseRedisUrl(config.redisUrl);

    const redisOptions = {
      host: parsed.host,
      port: parsed.port,
      password: parsed.password || config.redisPassword || undefined,
      maxRetriesPerRequest: null as null, // Required for BullMQ compatibility
      enableReadyCheck: false,
      lazyConnect: true,
      ...(parsed.tls ? { tls: {} } : {}),
    };

    redisConnection = new Redis(redisOptions);

    // Attempt to connect — but don't block if it fails
    redisConnection.connect().catch((err) => {
      initError = err instanceof Error ? err.message : 'Redis connection failed';
      console.warn(`[WebhookQueue] Redis connection failed: ${initError}. Webhook queue disabled.`);
      redisConnection = null;
      webhookQueueInstance = null;
      webhookWorkerInstance = null;
    });

    // ── Queue (Producer) ──────────────────────────────────────────────────
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

    // ── Worker (Consumer) ─────────────────────────────────────────────────
    webhookWorkerInstance = new Worker<WebhookDeliveryPayload>(
      'webhook-delivery',
      async (job: Job<WebhookDeliveryPayload>): Promise<void> => {
        const payload = job.data;

        const merchant = await prisma.merchant.findUnique({
          where: { id: payload.merchantId },
          select: { webhookUrl: true },
        });

        if (!merchant?.webhookUrl) {
          console.warn(`[WebhookQueue] No webhook URL for merchant ${payload.merchantId}, skipping`);
          return;
        }

        console.log(`[WebhookQueue] Delivering job ${job.id} to ${merchant.webhookUrl}`);

        const result = await deliverWebhook(merchant.webhookUrl, payload);

        // ST-M2 fix: persist delivery record only on final outcome
        // (success, or last attempt failure) — not on every retry
        const isFinalAttempt = (job.attemptsMade + 1) >= (job.opts.attempts ?? 3);

        if (result.success || isFinalAttempt) {
          await prisma.webhookDelivery.create({
            data: {
              merchantId: payload.merchantId,
              eventType: payload.eventType,
              payload: payload as any,
              status: result.success ? 'delivered' : 'failed',
              statusCode: result.statusCode,
              error: result.lastError,
              retryCount: job.attemptsMade + 1,
              completedAt: result.success ? new Date() : undefined,
            },
          });
        }

        if (!result.success) {
          throw new Error(
            `Webhook delivery failed after ${result.attempts} attempts: ${result.lastError || 'Unknown'}`
          );
        }

        console.log(`[WebhookQueue] Successfully delivered job ${job.id}`);
      },
      {
        connection: redisConnection,
        concurrency: 5,
        lockDuration: 30000,
      }
    );

    // ── Queue Events ──────────────────────────────────────────────────────
    queueEventsInstance = new QueueEvents('webhook-delivery', { connection: redisConnection });

    queueEventsInstance.on('completed', ({ jobId }) => {
      console.log(`[WebhookQueue] Job ${jobId} completed`);
    });

    queueEventsInstance.on('failed', ({ jobId, failedReason }) => {
      console.error(`[WebhookQueue] Job ${jobId} failed permanently: ${failedReason}`);
    });

    console.log('[WebhookQueue] Initialized successfully');
    return true;
  } catch (err) {
    initError = err instanceof Error ? err.message : 'Unknown initialization error';
    console.warn(`[WebhookQueue] Failed to initialize: ${initError}. Webhook queue disabled.`);
    redisConnection = null;
    webhookQueueInstance = null;
    webhookWorkerInstance = null;
    queueEventsInstance = null;
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/** Check if the webhook queue is available and connected */
export function isWebhookQueueAvailable(): boolean {
  return webhookQueueInstance !== null && redisConnection !== null;
}

/** Enqueue a webhook for delivery. Degrades gracefully if Redis is unavailable. */
export async function enqueueWebhook(payload: WebhookDeliveryPayload): Promise<Job<WebhookDeliveryPayload> | null> {
  if (!ensureInitialized() || !webhookQueueInstance) {
    console.warn('[WebhookQueue] Queue not available — webhook skipped:', payload.eventType, payload.invoiceId);
    // Still persist the record so the merchant can see the event was triggered
    await prisma.webhookDelivery.create({
      data: {
        merchantId: payload.merchantId,
        eventType: payload.eventType,
        payload: payload as any,
        status: 'failed',
        error: `Webhook queue unavailable: ${initError || 'Redis not connected'}`,
        completedAt: new Date(),
      },
    }).catch((dbErr: unknown) => {
      console.error('[WebhookQueue] Failed to persist fallback webhook record:', dbErr);
    });
    return null;
  }

  const job = await webhookQueueInstance.add('webhook-delivery', payload, {
    jobId: `${payload.merchantId}-${payload.invoiceId}-${Date.now()}`,
  });
  console.log(`[WebhookQueue] Enqueued job ${job.id} for merchant ${payload.merchantId}`);
  return job;
}

/** Graceful shutdown — safe to call even if queue was never initialized */
export async function closeWebhookQueue(): Promise<void> {
  try {
    if (webhookWorkerInstance) await webhookWorkerInstance.close();
    if (webhookQueueInstance) await webhookQueueInstance.close();
    if (queueEventsInstance) await queueEventsInstance.close();
    if (redisConnection) redisConnection.disconnect();
    console.log('[WebhookQueue] Gracefully shut down');
  } catch (err) {
    console.warn('[WebhookQueue] Error during shutdown:', err);
  }
}
