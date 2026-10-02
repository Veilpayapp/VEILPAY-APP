/**
 * SEC-002 fix: SSRF guard for merchant-controlled webhook URLs.
 *
 * Round-5 hoist: the guard's implementation now lives in the shared
 * workspace package `@veilpay/webhook-safety` (single source of truth for
 * the backend AND the indexer — the former keep-in-sync copy in
 * apps/indexer/src/webhook/urlSafety.ts is a sibling wrapper). This file is
 * reduced to a thin app-side wrapper: it binds the backend's environment
 * policy (https required in production) and keeps the module path that all
 * backend consumers — jobs/webhookDelivery, controllers/merchantController,
 * scripts/audit-webhook-urls — and their tests already import and mock.
 *
 * The package itself is config-free; the policy below is the only
 * app-specific behavior the old copy derived from `config`.
 */

import {
  assertSafeWebhookUrl as assertSafeWebhookUrlWithPolicy,
  rejectUnsafeWebhookUrl as rejectUnsafeWebhookUrlWithPolicy,
  UnsafeUrlError,
  type SafeWebhookUrl,
  type WebhookUrlPolicy,
} from '@veilpay/webhook-safety';
import { config } from '../config';

/** Backend policy: https is required for webhook targets in production. */
const backendWebhookUrlPolicy: WebhookUrlPolicy = {
  requireHttps: config.nodeEnv === 'production',
};

/**
 * Validate that `rawUrl` is safe for the backend to fetch as a webhook
 * target, and return the resolved IP the caller MUST pin for the actual
 * fetch. Throws `UnsafeUrlError` if the URL is malformed, uses a non-https
 * scheme in production, points at localhost / a private / reserved /
 * link-local IP, or resolves via DNS to a blocked address.
 *
 * The returned `resolvedAddress` MUST be used to pin the fetch connection
 * (via `http(s).Agent` `lookup`) so the connection does not re-resolve
 * DNS — that re-resolution is the DNS-rebinding TOCTOU vector.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<SafeWebhookUrl> {
  return assertSafeWebhookUrlWithPolicy(rawUrl, backendWebhookUrlPolicy);
}

/**
 * Convenience wrapper for the merchant controllers (`registerMerchant` and
 * `updateMerchant`): validate a webhook URL, swallowing `UnsafeUrlError`
 * and rewriting it as a `400` response so the controllers do not duplicate
 * the try/catch error-mapping. Returns `true` when the URL is valid (or
 * when it is absent — undefined / null / empty string), `false` after it
 * has written the 400 response.
 *
 * Single source of truth for the SSRF-guard error contract — if the
 * rejection message ever changes (or we want to surface a structured
 * machine-readable code), only this helper needs to bump.
 */
export async function rejectUnsafeWebhookUrl(
  rawUrl: string | null | undefined,
  res: { status(value: number): { json(body: unknown): void } }
): Promise<boolean> {
  return rejectUnsafeWebhookUrlWithPolicy(rawUrl, res, backendWebhookUrlPolicy);
}

export { UnsafeUrlError };
export type { SafeWebhookUrl };
