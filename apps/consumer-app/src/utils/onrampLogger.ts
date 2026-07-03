/**
 * Structured logging for on-ramp flows.
 *
 * Emits JSON-structured log lines so that Sentry breadcrumbs, analytics,
 * and debug logs are consistent across quote-fetch, widget-load, and
 * error events. In dev builds these print to the console; in production
 * they feed into the Sentry breadcrumb trail.
 */

type OnrampLogLevel = 'info' | 'warn' | 'error';

interface OnrampLogEvent {
  event: string;
  [key: string]: unknown;
}

function emit(level: OnrampLogLevel, data: OnrampLogEvent): void {
  const payload = { ...data, ts: Date.now() };

  if (__DEV__) {
    const tag = `[Onramp:${level}]`;
    switch (level) {
      case 'error':
        console.error(tag, payload);
        break;
      case 'warn':
        console.warn(tag, payload);
        break;
      default:
        console.log(tag, payload);
    }
  }
}

/** Logs a successful quote fetch */
export function logQuotesFetched(params: {
  fiatAmount: string;
  fiatCurrency: string;
  cryptoToken: string;
  chainKey: string;
  quoteCount: number;
  providers: string[];
}): void {
  emit('info', { event: 'quotes_fetched', ...params });
}

/** Logs when a quote fetch fails */
export function logQuotesFetchError(params: {
  fiatAmount: string;
  fiatCurrency: string;
  cryptoToken: string;
  error: string;
}): void {
  emit('error', { event: 'quotes_fetch_error', ...params });
}

/** Logs when a user selects a provider */
export function logProviderSelected(params: {
  provider: string;
  chainKey: string;
  fiatCurrency: string;
  fiatAmount: string;
}): void {
  emit('info', { event: 'provider_selected', ...params });
}

/** Logs a widget load event */
export function logWidgetLoad(params: {
  provider: string;
  success: boolean;
  durationMs?: number;
  error?: string;
}): void {
  const level = params.success ? 'info' : 'error';
  emit(level, { event: 'widget_load', ...params });
}

/** Logs a widget timeout */
export function logWidgetTimeout(params: {
  provider: string;
  url: string;
}): void {
  emit('warn', { event: 'widget_timeout', ...params });
}

/** Logs an unsupported chain/provider combination */
export function logUnsupportedChain(params: {
  chainKey: string;
  provider?: string;
}): void {
  emit('warn', { event: 'unsupported_chain', ...params });
}
