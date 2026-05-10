import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initSentry() {
  if (!SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    debug: __DEV__,
    tracesSampleRate: __DEV__ ? 0.05 : 0.2,
    enableUserInteractionTracing: true,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
  });
}

export function captureError(error: Error, context?: Record<string, unknown>) {
  if (__DEV__) {
    console.error('Error:', error, 'Context:', context);
  }

  Sentry.captureException(error, {
    extra: context,
  });
}

export function withPerformanceSpan<T>(name: string, op: string, fn: () => T): T {
  if (typeof Sentry.startSpan === 'function') {
    return Sentry.startSpan({ name, op }, fn);
  }

  return fn();
}

export function setUserContext(walletAddress?: string) {
  if (walletAddress) {
    Sentry.setUser({
      id: walletAddress,
      username: `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`,
    });
  } else {
    Sentry.setUser(null);
  }
}

export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
) {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: 'info',
  });
}

export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info'
) {
  if (__DEV__) {
    console.log(`[${level.toUpperCase()}]`, message);
  }

  if (!__DEV__ || level === 'error') {
    Sentry.captureMessage(message, level);
  }
}
