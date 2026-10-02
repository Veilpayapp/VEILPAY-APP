/**
 * @veilpay/webhook-safety — public surface.
 *
 * SEC-002 SSRF guard for merchant-controlled webhook URLs, shared by the
 * backend and the indexer (round-5 hoist of the two keep-in-sync copies).
 * The package is config-free: each app binds its own {@link WebhookUrlPolicy}
 * via a thin app-side wrapper (backend: `src/utils/urlSafety.ts`; indexer:
 * `src/webhook/urlSafety.ts`).
 */
export {
  assertSafeWebhookUrl,
  rejectUnsafeWebhookUrl,
  UnsafeUrlError,
} from './urlSafety';
export type { SafeWebhookUrl, WebhookUrlPolicy } from './urlSafety';
