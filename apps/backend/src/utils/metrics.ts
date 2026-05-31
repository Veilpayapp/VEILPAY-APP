
export function recordRpcLatency(chainKey: string, durationMs: number): void {
  // Sentry.metrics is deprecated/removed in v8. Use captureMessage or custom logic
  console.warn(`[Metrics] rpc_latency_ms: ${durationMs}ms for ${chainKey}`);
}

export function incrementWebhookDeliveryAttempt(status: 'success' | 'failure' | 'permanent_failure'): void {
  // Sentry.metrics is deprecated/removed in v8. Use captureMessage or custom logic
  console.warn(`[Metrics] webhook_delivery_attempt: ${status}`);
}
