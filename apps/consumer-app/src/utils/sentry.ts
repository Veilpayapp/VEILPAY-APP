/**
 * Veilpay Sentry Stub
 * Telemetry has been physically stripped to reduce bundle size.
 * This module intercepts legacy Sentry calls and routes them to native console.
 *
 * SEC-009: All error context is sanitized to prevent leaking sensitive info.
 */

import { sanitizeContextForSentry } from './sentrySanitizer';

export function initSentry() {
  if (__DEV__) {
    console.log('[sentry-stub] Telemetry disabled.');
  }
}

export function captureError(error: Error, context?: Record<string, unknown>) {
  // SEC-009: Sanitize context before logging to remove sensitive keys
  const sanitized = context ? sanitizeContextForSentry(context) : undefined;
  console.error('Error:', error, 'Context:', sanitized);
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
