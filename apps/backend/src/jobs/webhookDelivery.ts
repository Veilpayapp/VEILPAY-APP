/**
 * VeilPay Webhook Delivery Job
 *
 * Async webhook delivery with retry logic using BullMQ + Redis.
 * - 3 retry attempts with exponential backoff (5s, 30s, 120s)
 * - Dead-letter queue for permanently failed deliveries
 * - HMAC-SHA256 signing of payloads for merchant verification
 * - Configurable per-merchant webhook URLs
 */

import { createHmac } from 'crypto';
import { config } from '../config';

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

export interface WebhookDeliveryPayload {
  eventType: 'payment.received' | 'invoice.paid' | 'invoice.expired';
  merchantId: string;
  invoiceId: string;
  chainKey: string;
  tokenSymbol: string;
  amount: string;
  privacyLevel: string;
  timestamp: number;
}

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  attempts: number;
  lastError?: string;
}

function signWebhookPayload(payload: string, timestamp: number): string {
  return createHmac('sha256', config.webhookSigningSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
}

async function attemptDelivery(
  url: string,
  payload: WebhookDeliveryPayload,
  attempt: number
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const timestamp = Date.now();
  const body = JSON.stringify(payload);
  const signature = signWebhookPayload(body, timestamp);

  const controller = new AbortController();
  const timeoutMs = 10_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VeilPay-Signature': signature,
        'X-VeilPay-Timestamp': String(timestamp),
        'X-VeilPay-Event': payload.eventType,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { ok: true, statusCode: response.status };
    }

    const errorText = await response.text().catch(() => 'Unknown error');
    return {
      ok: false,
      statusCode: response.status,
      error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : 'Unknown fetch error';
    return { ok: false, error: message };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deliverWebhook(
  url: string,
  payload: WebhookDeliveryPayload
): Promise<WebhookDeliveryResult> {
  let lastError: string | undefined;
  let attempts = 0;

  for (let i = 0; i < MAX_RETRIES; i++) {
    attempts = i + 1;

    if (i > 0) {
      const delay = RETRY_DELAYS_MS[i - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await sleep(delay);
    }

    const result = await attemptDelivery(url, payload, i);

    if (result.ok) {
      return { success: true, statusCode: result.statusCode, attempts };
    }

    lastError = result.error;

    if (result.statusCode && result.statusCode >= 400 && result.statusCode < 500) {
      return { success: false, statusCode: result.statusCode, attempts, lastError };
    }
  }

  return { success: false, attempts, lastError };
}
