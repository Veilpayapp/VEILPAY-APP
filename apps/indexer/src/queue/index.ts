import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { config } from "../config";

/**
 * Shared BullMQ connection.
 *
 * Lifecycle note (jest-exit fix, round-5): the client is created with
 * `lazyConnect: true`, so it sits in ioredis' `wait` state — no socket, no
 * reconnect timer — until the first command. Importing this module therefore
 * no longer holds a Node event loop open, which is what kept Jest from
 * exiting without `--forceExit`. This is lifecycle-only: BullMQ explicitly
 * supports lazy clients (it calls `connect()` itself when it observes
 * status `wait` — bullmq 5.74.1 `redis-connection.js` `waitUntilReady`), and
 * `maxRetriesPerRequest: null` — the durability requirement that commands
 * queue forever while Redis is down — is unchanged.
 */
let connection: IORedis | null = null;

function getQueueConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return connection;
}

/**
 * Force-close the shared queue connection so a Jest worker's event loop can
 * drain (called from `src/__tests__/setup.ts` `afterAll`). Safe to call when
 * the client is still in `wait` state, and idempotent. Intended for test
 * teardown only — production never calls it; the next `getQueueConnection()`
 * mints a fresh client.
 */
export function closeQueueConnection(): void {
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

export interface WebhookPayload {
  merchantId: string;
  eventType: "payment.received" | "payment.confirmed" | "invoice.expired";
  timestamp: number;
  /**
   * Durable outbox row id (WebhookDelivery, status=pending) created BEFORE
   * this payload is enqueued — see enqueueWebhook. The dispatcher updates
   * that same row to delivered/failed instead of creating post-hoc rows.
   */
  deliveryId?: string;
  data: {
    invoiceId?: string;
    paymentId?: string;
    chainKey: string;
    txHash: string;
    amount: string;
    tokenSymbol: string;
    fromAddress?: string;
    toAddress?: string;
    blockNumber?: number;
    privacyLevel?: string;
  };
}

export interface DeadLetterPayload {
  merchantId: string;
  eventType: WebhookPayload["eventType"];
  attemptsMade: number;
  error: string;
  payload: WebhookPayload;
  failedAt: string;
}

export const webhookQueue = new Queue<WebhookPayload>("veilpay-webhooks", {
  connection: getQueueConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      age: 7 * 24 * 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 30 * 24 * 3600,
    },
  },
});

export const deadLetterQueue = new Queue<DeadLetterPayload>("veilpay-webhook-dlq", {
  connection: getQueueConnection(),
  defaultJobOptions: {
    removeOnComplete: {
      age: 30 * 24 * 3600,
      count: 1000,
    },
  },
});

/**
 * Durable outbox (mirrors apps/backend/src/jobs/webhookQueue.ts:109-128):
 * persist a WebhookDelivery row with status=pending BEFORE the BullMQ add,
 * so a crash between the DB commit and the enqueue cannot silently drop a
 * merchant notification — the stranded row is visible to the drift job.
 *
 * The BullMQ jobId is `wh-<deliveryId>` (backend's buildWebhookJobId), so
 * the job identity is bound to the outbox row. This also fixes a latent
 * dedup bug in the old `${merchantId}-${txHash}` id: two different event
 * types for the same txHash were swallowed by BullMQ's jobId dedupe.
 */
export async function enqueueWebhook(payload: WebhookPayload): Promise<string> {
  let deliveryId = payload.deliveryId;
  if (!deliveryId) {
    try {
      const row = await prisma.webhookDelivery.create({
        data: {
          merchantId: payload.merchantId,
          eventType: payload.eventType,
          payload: payload as unknown as Prisma.InputJsonValue,
          status: "pending",
          retryCount: 0,
        },
        select: { id: true },
      });
      deliveryId = row.id;
    } catch (dbErr) {
      // DB write failed — still try to enqueue so the merchant gets the
      // notification (undurable but delivered beats durable but dropped).
      console.error(
        "[WebhookQueue] Failed to create outbox row:",
        dbErr instanceof Error ? dbErr.message : String(dbErr)
      );
    }
  }

  const enriched: WebhookPayload = { ...payload, deliveryId };

  try {
    const job = await webhookQueue.add("webhook", enriched, {
      jobId: deliveryId
        ? `wh-${deliveryId}`
        : `${payload.merchantId}-${payload.data.txHash}`,
    });
    return job.id!;
  } catch (err) {
    // Enqueue failed — mark the outbox row failed so the drift job reports
    // it instead of it sitting in pending forever.
    if (deliveryId) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: "failed",
            error: `Webhook queue add failed: ${msg}`,
            completedAt: new Date(),
          },
        });
      } catch (updateErr) {
        console.error(
          "[WebhookQueue] Failed to mark outbox row failed:",
          updateErr instanceof Error ? updateErr.message : String(updateErr)
        );
      }
    }
    throw err;
  }
}

export async function enqueueDeadLetter(payload: DeadLetterPayload): Promise<string> {
  const job = await deadLetterQueue.add("webhook-dead-letter", payload, {
    jobId: `${payload.merchantId}-${payload.eventType}-${payload.payload.data.txHash}`,
  });
  return job.id!;
}

export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const [waiting, active, completed, failed] = await Promise.all([
    webhookQueue.getWaitingCount(),
    webhookQueue.getActiveCount(),
    webhookQueue.getCompletedCount(),
    webhookQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}

export function createWebhookWorker(
  processor: (job: Job<WebhookPayload>) => Promise<void>
): Worker<WebhookPayload> {
  return new Worker("veilpay-webhooks", processor, {
    connection: getQueueConnection(),
    concurrency: 5,
    limiter: {
      max: 100,
      duration: 1000,
    },
  });
}
