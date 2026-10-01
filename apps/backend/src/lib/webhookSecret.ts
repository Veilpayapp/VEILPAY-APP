/**
 * Per-merchant webhook signing secret resolution (round 4).
 *
 * Merchants can now hold their own `webhookSecret` (schema column
 * `merchants.webhook_secret`, migration 1_webhook_secret_and_key_index).
 * Every code path that SIGNS or VERIFIES a merchant webhook must resolve the
 * secret through this helper so the fallback semantics cannot drift:
 *
 *   merchant.webhookSecret ?? config.webhookSigningSecret
 *
 * The global-secret fallback exists so merchants registered before this
 * column (or before they rotate onto a per-merchant secret) keep working —
 * it logs a deprecation warning once per process to push operators to
 * rotate every merchant onto a dedicated secret.
 *
 * NOTE: `src/utils/onrampStatusToken.ts` is a GLOBAL on-ramp status token
 * utility, NOT a per-merchant webhook — it deliberately stays on the global
 * `config.webhookSigningSecret` and must NOT use this helper.
 */

import { config } from '../config';
import { logger } from './logger';

let globalFallbackWarned = false;

/**
 * Resolve the HMAC key for a merchant webhook.
 *
 * @param merchantWebhookSecret the merchant row's `webhookSecret` value
 *   (null/undefined when the merchant has not been rotated yet).
 * @returns the per-merchant secret, or the global env secret as fallback.
 */
export function resolveWebhookSigningSecret(
  merchantWebhookSecret: string | null | undefined
): string {
  if (merchantWebhookSecret) {
    return merchantWebhookSecret;
  }

  if (!globalFallbackWarned) {
    globalFallbackWarned = true;
    logger.warn(
      '[WebhookSecret] Merchant has no per-merchant webhook secret — falling back to the global ' +
        'WEBHOOK_SIGNING_SECRET. This fallback is DEPRECATED; rotate merchants onto per-merchant ' +
        'secrets (Merchant.webhookSecret).'
    );
  }

  return config.webhookSigningSecret;
}

/**
 * Test-only hook (same pattern as jobs/webhookDelivery.ts __testing__):
 * resets the once-per-process deprecation-warning flag so tests can assert
 * the warning deterministically regardless of execution order.
 */
export const __testing__ = {
  resetGlobalFallbackWarning: (): void => {
    globalFallbackWarned = false;
  },
};
