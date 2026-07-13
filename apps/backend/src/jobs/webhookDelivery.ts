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
import { request as httpRequest, Agent as HttpAgent, type ClientRequest } from 'http';
import { request as httpsRequest, Agent as HttpsAgent } from 'https';
import { config } from '../config';
import { assertSafeWebhookUrl } from '../utils/urlSafety';

export interface WebhookDeliveryPayload {
  eventType: 'payment.received' | 'invoice.paid' | 'invoice.expired';
  merchantId: string;
  invoiceId: string;
  chainKey: string;
  tokenSymbol: string;
  amount: string;
  privacyLevel: string;
  timestamp: number;
  /** REL-002: durable outbox row id when present */
  deliveryId?: string;
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

/**
 * Pluggable HTTP sender — injectable for tests. Production sends via
 * `https`/`http`.request with a pinning agent (see
 * `defaultHttpSender`); tests inject a stub that captures the request
 * and returns a simulated response.
 *
 * SEC-002 fix: the sender:
 *   1. Uses a custom Agent whose `lookup` always returns the validated
 *      IP, so `connect()` does not re-resolve DNS — this closes the
 *      DNS-rebinding TOCTOU between SSRF check and fetch.
 *   2. Treats 3xx responses as failures so a redirect cannot bypass the
 *      SSRF check (equivalent to `redirect: 'error'`).
 *   3. Writes the body, signs the payload, and sets a 10s timeout.
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

/**
 * Default sender: HTTPS when the URL is `https:`, plain HTTP otherwise.
 * The agent pins the connection to the previously-resolved IP (passed in
 * via `agent`), keeping the original hostname for SNI / Host so TLS cert
 * validation against the merchant's real hostname continues to work.
 */
export const defaultHttpSender: WebhookSender = (args) =>
  new Promise<WebhookSenderResult>((resolve) => {
    const { url, body, headers, agent, timeoutMs } = args;
    const isHttps = url.startsWith('https:');
    const requester = isHttps ? httpsRequest : httpRequest;

    const req: ClientRequest = requester(
      url,
      {
        method: 'POST',
        headers,
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        // Reject redirects at the protocol layer (equivalent to
        // `redirect: 'error'`). A merchant that needs to move endpoints
        // should update webhookUrl (re-validated on write) rather than
        // redirecting. Without this, the redirect target would re-resolve
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
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (statusCode >= 200 && statusCode < 300) {
            resolve({ statusCode });
            return;
          }
          const text = Buffer.concat(chunks).toString('utf8').substring(0, 200);
          resolve({ statusCode, lastError: `HTTP ${statusCode}: ${text}` });
        });
        res.on('error', (err) => {
          resolve({ statusCode: 0, lastError: err.message });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Webhook delivery timed out'));
    });

    req.on('error', (err) => {
      resolve({ statusCode: 0, lastError: err.message });
    });

    req.end(body);
  });

let httpSender: WebhookSender = defaultHttpSender;

/**
 * Test injection hook. Pass `null` to reset to default.
 * Exported under `__testing__` so tests can swap the sender without
 * mocking the Node `http`/`https` modules (which can't be mocked because
 * they're loaded by ts-jest's Node runtime before jest's mock registry
 * resolves).
 */
export const __testing__ = {
  setHttpSender: (sender: WebhookSender | null) => {
    httpSender = sender ?? defaultHttpSender;
  },
  pinnedLookupFactory: (
    resolvedAddress: string,
    family: 4 | 6
  ): ((hostname: string, options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => void) => {
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
  protocol: 'http' | 'https',
  resolvedAddress: string,
  family: 4 | 6
): HttpAgent | HttpsAgent {
  const lookup: LookupFn = (
    _hostname,
    _opts,
    callback
  ): void => callback(null, resolvedAddress, family);
  return protocol === 'https' ? new HttpsAgent({ lookup }) : new HttpAgent({ lookup });
}

export async function deliverWebhook(
  url: string,
  payload: WebhookDeliveryPayload
): Promise<WebhookDeliveryResult> {
  // SEC-002 fix: defense-in-depth SSRF check. Re-validating on every
  // delivery closes any gap between write-time validation and on-call
  // delivery (stored URLs from before the fix, or DNS rebinding attacks).
  let safe;
  try {
    safe = await assertSafeWebhookUrl(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'URL safety check failed';
    return { success: false, lastError: `SSRF guard: ${message}` };
  }

  const timestamp = Date.now();
  const body = JSON.stringify(payload);
  const signature = signWebhookPayload(body, timestamp);

  const protocol: 'http' | 'https' = url.startsWith('https:') ? 'https' : 'http';
  const agent = buildPinningAgent(protocol, safe.resolvedAddress, safe.family);

  const result = await httpSender({
    url,
    body,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      'X-VeilPay-Signature': signature,
      'X-VeilPay-Timestamp': String(timestamp),
      'X-VeilPay-Event': payload.eventType,
    },
    agent,
    timeoutMs: 10_000,
  });

  if (!result.lastError) {
    return { success: true, statusCode: result.statusCode };
  }
  return {
    success: result.statusCode >= 200 && result.statusCode < 300,
    statusCode: result.statusCode,
    lastError: result.lastError,
  };
}
