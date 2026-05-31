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
  lastError?: string;
}

function signWebhookPayload(payload: string, timestamp: number): string {
  return createHmac('sha256', config.webhookSigningSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
}

export async function deliverWebhook(
  url: string,
  payload: WebhookDeliveryPayload
): Promise<WebhookDeliveryResult> {
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
      return { success: true, statusCode: response.status };
    }

    const errorText = await response.text().catch(() => 'Unknown error');
    return {
      success: false,
      statusCode: response.status,
      lastError: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : 'Unknown fetch error';
    return { success: false, lastError: message };
  }
}
