import { Worker, Job } from "bullmq";
import { createHmac } from "crypto";
import { prisma } from "../lib/prisma";
import { WebhookPayload, enqueueDeadLetter, createWebhookWorker } from "../queue";
import { config } from "../config";

type WebhookEventType = WebhookPayload["eventType"];

interface WebhookConfig {
  url: string;
  secret: string;
}

function generateSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

async function getMerchantWebhookConfig(merchantId: string): Promise<WebhookConfig | null> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { webhookUrl: true, apiKeyHash: true },
  });

  if (!merchant?.webhookUrl) {
    return null;
  }

  // IX-C3 fix: use dedicated webhook signing secret instead of apiKeyHash
  // This allows independent rotation of webhook and API credentials
  return {
    url: merchant.webhookUrl,
    secret: config.webhookSigningSecret || merchant.apiKeyHash,
  };
}

async function sendWebhook(
  cfg: WebhookConfig,
  payload: WebhookPayload
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify(payload);
  const signature = generateSignature(body, cfg.secret);
  const timestamp = Date.now().toString();
  const fetchFn = globalThis.fetch;

  if (!fetchFn) {
    return {
      success: false,
      error: "Fetch API is not available in this runtime",
    };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-VeilPay-Signature": `sha256=${signature}`,
      "X-VeilPay-Event": payload.eventType,
      "X-VeilPay-Timestamp": timestamp,
      "User-Agent": "VeilPay-Webhook/1.0",
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetchFn(cfg.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const status = response.status;

    return {
      success: status >= 200 && status < 300,
      statusCode: status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function recordWebhookDelivery(args: {
  merchantId: string;
  eventType: WebhookEventType;
  payload: WebhookPayload;
  status: "delivered" | "failed";
  statusCode?: number;
  error?: string;
}): Promise<void> {
  await prisma.webhookDelivery.create({
    data: {
      merchantId: args.merchantId,
      eventType: args.eventType,
      payload: args.payload as any,
      status: args.status,
      ...(typeof args.statusCode === "number" ? { statusCode: args.statusCode } : {}),
      ...(args.error ? { error: args.error } : {}),
      completedAt: new Date(),
    },
  });
}

export async function processWebhookJob(job: Job<WebhookPayload>): Promise<void> {
  const { merchantId, eventType } = job.data;

  console.log(`[Webhook] Processing job ${job.id} for merchant ${merchantId}`);

  const cfg = await getMerchantWebhookConfig(merchantId);

  if (!cfg) {
    console.warn(`[Webhook] No webhook config for merchant ${merchantId}`);
    return;
  }

  const result = await sendWebhook(cfg, job.data);

  if (result.success) {
    console.log(`[Webhook] Successfully delivered to ${cfg.url} (status: ${result.statusCode})`);

    const deliveryRecord: Parameters<typeof recordWebhookDelivery>[0] = {
      merchantId,
      eventType,
      payload: job.data,
      status: "delivered",
      ...(typeof result.statusCode === "number" ? { statusCode: result.statusCode } : {}),
    };

    await recordWebhookDelivery(deliveryRecord);
  } else {
    console.error(`[Webhook] Failed to deliver: ${result.error}`);

    throw new Error(`Webhook delivery failed: ${result.error}`);
  }
}

export function startWebhookWorker(): Worker<WebhookPayload> {
  const worker = createWebhookWorker(processWebhookJob);

  worker.on("completed", (job: Job<WebhookPayload>) => {
    console.log(`[Webhook] Job ${job.id} completed`);
  });

  worker.on("failed", (job: Job<WebhookPayload> | undefined, error: Error) => {
    console.error(`[Webhook] Job ${job?.id} failed:`, error.message);

    if (!job) {
      return;
    }

    const attempts = job.opts.attempts ?? 1;

    if (job.attemptsMade < attempts) {
      return;
    }

    void (async () => {
      try {
        await recordWebhookDelivery({
          merchantId: job.data.merchantId,
          eventType: job.data.eventType,
          payload: job.data,
          status: "failed",
          error: error.message,
        });

        await enqueueDeadLetter({
          merchantId: job.data.merchantId,
          eventType: job.data.eventType,
          attemptsMade: job.attemptsMade,
          error: error.message,
          payload: job.data,
          failedAt: new Date().toISOString(),
        });

        console.warn(
          `[Webhook] Job ${job.id} moved to dead-letter queue after ${job.attemptsMade} attempts`
        );
      } catch (finalizationError) {
        console.error(
          `[Webhook] Failed to finalize dead-letter handling for job ${job.id}:`,
          finalizationError instanceof Error ? finalizationError.message : finalizationError
        );
      }
    })();
  });

  console.log("[Webhook] Worker started");
  return worker;
}

export { webhookQueue, enqueueWebhook } from "../queue";
