/**
 * Sentry Context Sanitizer (SEC-009)
 *
 * Redacts sensitive information before sending context to Sentry.
 * Implements a whitelist of safe keys and masks sensitive values.
 */

// List of keys that are known to contain sensitive data and should be denied
const SENSITIVE_KEYS = new Set([
  'mnemonic',
  'privatekey',
  'private_key',
  'nullifier',
  'secret',
  'key',
  'token',
  'seed',
  'recovery',
  'password',
  'pin',
  'password_hash',
  'api_key',
  'auth_token',
  'jwt',
  'bearer',
]);

// List of keys that are safe to include in error context
const SAFE_KEYS = new Set([
  'chain',
  'chainKey',
  'chain_key',
  'operation',
  'txHash',
  'tx_hash',
  'scope',
  'transaction',
  'error_code',
  'user_action',
  'screen',
  'component',
]);

/**
 * Check if a value looks like it should be redacted
 * (hex string, very long string, etc.)
 */
function shouldRedactValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  // Redact hex strings (likely keys, hashes, etc.)
  if (/^0x[0-9a-fA-F]+$/.test(value)) {
    return true;
  }

  // Redact very long strings (likely base64 or encoded keys)
  if (value.length > 256) {
    return true;
  }

  // Redact if it looks like a mnemonic (12+ space-separated words)
  const words = value.split(/\s+/);
  if (words.length >= 12 && words.every(w => /^[a-z]+$/.test(w))) {
    return true;
  }

  return false;
}

/**
 * Check if a key should be denied/redacted
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEYS.has(lowerKey);
}

/**
 * Sanitize a single value for safe reporting
 */
function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (shouldRedactValue(value)) {
      return '[REDACTED]';
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(v => sanitizeValue(v));
  }

  if (typeof value === 'object') {
    return sanitizeContextObject(value as Record<string, unknown>);
  }

  return '[UNKNOWN_TYPE]';
}

/**
 * Sanitize an object, removing sensitive keys and redacting sensitive values
 */
function sanitizeContextObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip sensitive keys entirely
    if (isSensitiveKey(key)) {
      continue;
    }

    // Check if this is a safe key (case-insensitive)
    const isSafeKey = SAFE_KEYS.has(key) || SAFE_KEYS.has(key.toLowerCase());

    // Safe keys are never redacted - sanitize and include as-is
    if (isSafeKey) {
      sanitized[key] = sanitizeValue(value);
    } else if (shouldRedactValue(value)) {
      // Non-safe keys with redactable values get redacted
      sanitized[key] = '[REDACTED]';
    } else {
      // Non-safe keys with normal values are included
      sanitized[key] = sanitizeValue(value);
    }
  }

  return sanitized;
}

/**
 * Main sanitization function - filters context for safe Sentry reporting
 *
 * @param context - The context object to sanitize
 * @returns Sanitized context with sensitive data removed/redacted
 */
export function sanitizeContextForSentry(
  context?: Record<string, unknown>
): Record<string, unknown> {
  if (!context || typeof context !== 'object') {
    return {};
  }

  return sanitizeContextObject(context);
}

/**
 * Redact a single value (used for inline redaction of error messages)
 */
export function redactSensitiveValue(value: string): string {
  if (shouldRedactValue(value)) {
    return '[REDACTED]';
  }
  return value;
}
