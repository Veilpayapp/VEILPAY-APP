/**
 * VeilPay indexer webhook dispatcher.
 *
 * Round-4 hardening (stream C):
 *  - (g) signing: no more `config.webhookSigningSecret || merchant.apiKeyHash`
 *    fallback — the secret is `merchant.webhookSecret ?? config.webhookSigningSecret`.
 *  - STRETCH: the outbound signature is now aligned with the backend
 *    (apps/backend/src/jobs/webhookDelivery.ts): HMAC-SHA256 over
 *    `${timestamp}.${body}`, sent as a bare hex `X-VeilPay-Signature` header
 *    plus `X-VeilPay-Timestamp` — NOT the old `sha256=<hex>` body-only HMAC.
 *    MERCHANT-FACING CHANGE: receivers that verified `sha256=<hmac(body)>`
 *    must switch to `hmac(timestamp.body)`.
 *  - (e) SSRF: the merchant URL is validated at DELIVERY time with the
 *    ported urlSafety guard, and the connection is pinned to the validated
 *    IP via a custom Agent `lookup` (DNS-rebinding TOCTOU closure), with
 *    protocol-layer 3xx rejection and a 10s timeout — mirroring
 *    apps/backend/src/jobs/webhookDelivery.ts:77-131.
 *  - (f) durable outbox: the WebhookDelivery row is created by
 *    enqueueWebhook BEFORE the BullMQ add; the dispatcher updates that SAME
 *    row to delivered/failed instead of creating post-hoc rows.
 */

import { Worker, Job } from "bullmq";
import { createHmac } from "crypto";
import { Prisma } from "@prisma/client";
import { request as httpRequest, Agent as HttpAgent, type ClientRequest } from "http";
import { request as httpsRequest, Agent as HttpsAgent } from "https";
import { prisma } from "../lib/prisma";
import { WebhookPayload, enqueueDeadLetter, createWebhookWorker } from "../queue";
import { config } from "../config";
import { assertSafeWebhookUrl } from "./urlSafety";

type WebhookEventType = WebhookPayload["eventType"];

interface WebhookConfig {
  url: string;
  secret: string;
}

function generateSignature(signedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(signedPayload).digest("hex");
}

async function getMerchantWebhookConfig(merchantId: string): Promise<WebhookConfig | null> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { webhookUrl: true, webhookSecret: true },
  });

  if (!merchant?.webhookUrl) {
    return null;
  }

  // (g) kill the apiKeyHash signing fallback: the API key hash is a
  // password-hash artifact, never a signing key. Prefer the merchant's
  // dedicated webhook secret (Stream B column); fall back to the platform
  // signing secret only when the merchant has no per-merchant secret yet.
  return {
    url: merchant.webhookUrl,
    secret: merchant.webhookSecret ?? config.webhookSigningSecret,
  };
}

/**
 * Pluggable HTTP sender — injectable for tests. Production sends via
 * `http`/`https`.request with a pinning agent (see `defaultHttpSender`);
 * tests inject a stub via `__testing__.setHttpSender` (Node's `http`/
 * `https` modules cannot be jest-mocked under ts-jest's Node runtime).
 *
 * (e) The sender:
 *   1. Uses a custom Agent whose `lookup` always returns the validated IP,
 *      so `connect()` does not re-resolve DNS — this closes the
 *      DNS-rebinding TOCTOU between the SSRF check and the fetch.
 *   2. Treats 3xx responses as failures so a redirect cannot bypass the
 *      SSRF check (the old raw fetch followed redirects).
 *   3. Enforces a 10s timeout instead of the old 30s AbortController.
 */
export interface WebhookSenderArgs {
  url: string;
  body: string;
  headers: Record<string, string>;
  agent: HttpAgent | HttpsAgent;
  timeoutMs: number;
}

export interface WebhookSenderResult {
  statusCode: number;
  lastError?: string;
}

export type WebhookSender = (args: WebhookSenderArgs) => Promise<WebhookSenderResult>;

/** Default sender: HTTPS when the URL is `https:`, plain HTTP otherwise. */
export const defaultHttpSender: WebhookSender = (args) =>
  new Promise<WebhookSenderResult>((resolve) => {
    const { url, body, headers, agent, timeoutMs } = args;
    const isHttps = url.startsWith("https:");
    const requester = isHttps ? httpsRequest : httpRequest;

    const req: ClientRequest = requester(
      url,
      {
        method: "POST",
        headers,
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        // Reject redirects at the protocol layer. A merchant that needs to
        // move endpoints should update webhookUrl (re-validated on write)
        // rather than redirecting — the redirect target would re-resolve
        // DNS and could point at a private IP.
        if (statusCode >= 300 && statusCode < 400) {
          res.resume();
          resolve({
            statusCode,
            lastError: `HTTP ${statusCode}: redirect rejected by webhook delivery`,
          });
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if (statusCode >= 200 && statusCode < 300) {
            resolve({ statusCode });
            return;
          }
          const text = Buffer.concat(chunks).toString("utf8").substring(0, 200);
          resolve({ statusCode, lastError: `HTTP ${statusCode}: ${text}` });
        });
        res.on("error", (err) => {
          resolve({ statusCode: 0, lastError: err.message });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Webhook delivery timed out"));
    });

    req.on("error", (err) => {
      resolve({ statusCode: 0, lastError: err.message });
    });

    req.end(body);
  });

let httpSender: WebhookSender = defaultHttpSender;

/**
 * Test injection hook. Pass `null` to reset to default. Exported under
 * `__testing__` so tests can swap the sender without mocking the Node
 * `http`/`https` modules (same pattern as the backend's webhookDelivery).
 */
export const __testing__ = {
  setHttpSender: (sender: WebhookSender | null) => {
    httpSender = sender ?? defaultHttpSender;
  },
  pinnedLookupFactory: (
    resolvedAddress: string,
    family: 4 | 6
  ): ((
    hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
  ) => void) => {
    const fn = (
      _hostname: string,
      _opts: unknown,
      callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
    ): void => callback(null, resolvedAddress, family);
    return fn;
  },
};

type LookupFn = (
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
) => void;

function buildPinningAgent(
  protocol: "http" | "https",
  resolvedAddress: string,
  family: 4 | 6
): HttpAgent | HttpsAgent {
  const lookup: LookupFn = (
    _hostname,
    _opts,
    callback
  ): void => callback(null, resolvedAddress, family);
  return protocol === "https" ? new HttpsAgent({ lookup }) : new HttpAgent({ lookup });
}

/** Hard delivery timeout — 10s instead of the old 30s raw fetch. */
const WEBHOOK_TIMEOUT_MS = 10_000;

async function sendWebhook(
  cfg: WebhookConfig,
  payload: WebhookPayload
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify(payload);

  // (e) SSRF guard at DELIVERY time — merchant URLs are stored data that
  // may predate write-time validation, and DNS can rebind between the
  // write check and this fetch.
  let safe;
  try {
    safe = await assertSafeWebhookUrl(cfg.url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "URL safety check failed";
    return { success: false, error: `SSRF guard: ${message}` };
  }

  // STRETCH (backend alignment): HMAC over `${timestamp}.${body}`, bare hex
  // in X-VeilPay-Signature, timestamp in X-VeilPay-Timestamp. The old
  // `sha256=<hmac(body)>` format signed the body only and left the
  // timestamp header unsigned (replayable).
  const timestamp = Date.now();
  const signature = generateSignature(`${timestamp}.${body}`, cfg.secret);

  // (e) pin the connection to the validated IP; the original hostname is
  // kept in the URL for SNI/Host so TLS validation still works.
  const protocol: "http" | "https" = cfg.url.startsWith("https:") ? "https" : "http";
  const agent = buildPinningAgent(protocol, safe.resolvedAddress, safe.family);

  const result = await httpSender({
    url: cfg.url,
    body,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      "X-VeilPay-Signature": signature,
      "X-VeilPay-Timestamp": String(timestamp),
      "X-VeilPay-Event": payload.eventType,
      "User-Agent": "VeilPay-Webhook/1.0",
    },
    agent,
    timeoutMs: WEBHOOK_TIMEOUT_MS,
  });

  if (!result.lastError) {
    return { success: true, statusCode: result.statusCode };
  }
  return {
    success: result.statusCode >= 200 && result.statusCode < 300,
    statusCode: result.statusCode,
    error: result.lastError,
  };
}

/**
 * (f) Update the SAME durable outbox row created by enqueueWebhook to its
 * terminal state. Jobs without a deliveryId (enqueued before the outbox
 * landed) fall back to a post-hoc row so history is not lost mid-rollout.
 */
async function finalizeDeliveryRow(args: {
  deliveryId?: string;
  merchantId: string;
  eventType: WebhookEventType;
  payload: WebhookPayload;
  status: "delivered" | "failed";
  statusCode?: number;
  error?: string;
}): Promise<void> {
  if (args.deliveryId) {
    await prisma.webhookDelivery.update({
      where: { id: args.deliveryId },
      data: {
        status: args.status,
        ...(typeof args.statusCode === "number" ? { statusCode: args.statusCode } : {}),
        ...(args.error ? { error: args.error } : {}),
        completedAt: new Date(),
      },
    });
    return;
  }

  await prisma.webhookDelivery.create({
    data: {
      merchantId: args.merchantId,
      eventType: args.eventType,
      payload: args.payload as unknown as Prisma.InputJsonValue,
      status: args.status,
      ...(typeof args.statusCode === "number" ? { statusCode: args.statusCode } : {}),
      ...(args.error ? { error: args.error } : {}),
      completedAt: new Date(),
    },
  });
}

export async function processWebhookJob(job: Job<WebhookPayload>): Promise<void> {
  const { merchantId, eventType, deliveryId } = job.data;

  console.warn(`[Webhook] Processing job ${job.id} for merchant ${merchantId}`);

  const cfg = await getMerchantWebhookConfig(merchantId);

  if (!cfg) {
    console.warn(`[Webhook] No webhook config for merchant ${merchantId}`);
    // The outbox row exists (pending) — mark it failed so it does not sit
    // pending forever and surface as stuck in the drift check.
    try {
      await finalizeDeliveryRow({
        deliveryId,
        merchantId,
        eventType,
        payload: job.data,
        status: "failed",
        error: "Merchant has no webhookUrl configured",
      });
    } catch (dbErr) {
      console.error(
        `[Webhook] Failed to mark delivery row for merchant ${merchantId}:`,
        dbErr instanceof Error ? dbErr.message : String(dbErr)
      );
    }
    return;
  }

  const result = await sendWebhook(cfg, job.data);

  if (result.success) {
    console.warn(`[Webhook] Successfully delivered to ${cfg.url} (status: ${result.statusCode})`);
    await finalizeDeliveryRow({
      deliveryId,
      merchantId,
      eventType,
      payload: job.data,
      status: "delivered",
      ...(typeof result.statusCode === "number" ? { statusCode: result.statusCode } : {}),
    });
    return;
  }

  console.error(`[Webhook] Failed to deliver: ${result.error}`);
  throw new Error(`Webhook delivery failed: ${result.error}`);
}

export function startWebhookWorker(): Worker<WebhookPayload> {
  const worker = createWebhookWorker(processWebhookJob);

  worker.on("completed", (job: Job<WebhookPayload>) => {
    console.warn(`[Webhook] Job ${job.id} completed`);
  });

  worker.on("failed", (job: Job<WebhookPayload> | undefined, error: Error) => {
    console.error(`[Webhook] Job ${job?.id} failed:`, error.message);

    if (!job) {
      return;
    }

    const attempts = job.opts.attempts ?? 1;
    const deliveryId = job.data.deliveryId;

    if (job.attemptsMade < attempts) {
      // Intermediate failure — the outbox row stays pending (retries left),
      // but record the attempt count for observability.
      if (deliveryId) {
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        void (async () => {
          try {
            await prisma.webhookDelivery.update({
              where: { id: deliveryId },
              data: { retryCount: job.attemptsMade },
            });
          } catch (updateErr) {
            console.error(
              `[Webhook] Failed to update retryCount for delivery ${deliveryId}:`,
              updateErr instanceof Error ? updateErr.message : String(updateErr)
            );
          }
        })();
      }
      return;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    void (async () => {
      try {
        // (f) final failure — settle the SAME outbox row (not a new one).
        await finalizeDeliveryRow({
          deliveryId,
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

  console.warn("[Webhook] Worker started");
  return worker;
}

export { webhookQueue, enqueueWebhook } from "../queue";
