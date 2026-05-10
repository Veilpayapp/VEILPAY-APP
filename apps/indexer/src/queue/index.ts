import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";

const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export interface WebhookPayload {
  merchantId: string;
  eventType: "payment.received" | "payment.confirmed" | "invoice.expired";
  timestamp: number;
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
  connection,
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
  connection,
  defaultJobOptions: {
    removeOnComplete: {
      age: 30 * 24 * 3600,
      count: 1000,
    },
  },
});

export async function enqueueWebhook(payload: WebhookPayload): Promise<string> {
  const job = await webhookQueue.add("webhook", payload, {
    jobId: `${payload.merchantId}-${payload.data.txHash}`,
  });
  return job.id!;
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
    connection,
    concurrency: 5,
    limiter: {
      max: 100,
      duration: 1000,
    },
  });
}
