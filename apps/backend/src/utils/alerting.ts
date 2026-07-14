/**
 * Ops alerting helper.
 *
 * Forwards operational signals (RPC budget exhaustion, upstream throttling, a
 * tripped circuit breaker) to Sentry as a warning-level message and to the
 * process log. Alerts are throttled per key so a burst of upstream 429s cannot
 * flood Sentry or the logs — one alert per key per window, subsequent hits are
 * counted and surfaced on the next emission.
 */

import * as Sentry from '@sentry/node';

const DEFAULT_THROTTLE_MS = 60_000;

interface ThrottleEntry {
  /** Timestamp of the last emitted alert for this key. */
  lastSentAt: number;
  /** Alerts suppressed since the last emission. */
  suppressed: number;
}

const throttleState = new Map<string, ThrottleEntry>();

export interface OpsAlertOptions {
  /** Minimum ms between emitted alerts for this key. Defaults to 60s. */
  throttleMs?: number;
  /** Structured context attached to the Sentry event (never secrets). */
  context?: Record<string, unknown>;
}

/**
 * Emit an ops alert. De-duplicated per `key`: at most one emission per throttle
 * window; the count of suppressed alerts is included when the window reopens.
 */
export function sendOpsAlert(key: string, message: string, options: OpsAlertOptions = {}): void {
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const now = Date.now();
  const entry = throttleState.get(key);

  if (entry && now - entry.lastSentAt < throttleMs) {
    entry.suppressed += 1;
    return;
  }

  const suppressed = entry?.suppressed ?? 0;
  throttleState.set(key, { lastSentAt: now, suppressed: 0 });

  const suffix = suppressed > 0 ? ` (+${suppressed} suppressed since last alert)` : '';
  // eslint-disable-next-line no-console
  console.warn(`[OpsAlert] ${key}: ${message}${suffix}`);

  try {
    Sentry.captureMessage(`[${key}] ${message}${suffix}`, {
      level: 'warning',
      extra: { ...options.context, suppressedSinceLastAlert: suppressed },
    });
  } catch {
    // Sentry must never take down the request path.
  }
}

/** Test helper: clear throttle state between cases. */
export const __test = {
  reset(): void {
    throttleState.clear();
  },
};
