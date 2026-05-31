/**
 * Veilpay Sentry Stub
 * Telemetry has been physically stripped to reduce bundle size.
 * This module intercepts legacy Sentry calls and routes them to native console.
 */

export function initSentry() {
  if (__DEV__) {
    console.log('[sentry-stub] Telemetry disabled.');
  }
}

export function captureError(error: Error, context?: Record<string, unknown>) {
  console.error('Error:', error, 'Context:', context);
}

export function withPerformanceSpan<T>(name: string, op: string, fn: () => T): T {
  return fn();
}

export function setUserContext(walletAddress?: string) {
  // no-op
}

export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
) {
  // no-op
}

export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info'
) {
  if (level === 'error') {
    console.error(`[${level.toUpperCase()}]`, message);
  } else if (level === 'warning') {
    console.warn(`[${level.toUpperCase()}]`, message);
  } else if (__DEV__) {
    console.log(`[${level.toUpperCase()}]`, message);
  }
}
