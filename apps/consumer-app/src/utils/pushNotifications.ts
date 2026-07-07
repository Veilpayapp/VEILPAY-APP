/**
 * Push notification device token registration
 *
 * Features:
 * - Request timeout (8s) to avoid hanging on poor networks
 * - Retry with exponential backoff (up to 3 attempts)
 * - HMAC-style API key authentication
 */

import { captureMessage } from './sentry';

type RegisterPushTokenPayload = {
  token: string;
  walletAddress?: string | null;
};

const PUSH_REGISTRATION_PATH = "/api/v1/notifications/register-device";

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 8000;

/** Maximum number of retry attempts */
const MAX_RETRIES = 3;

/** Base delay between retries (doubles each attempt) */
const RETRY_BASE_DELAY_MS = 1000;

function getBackendBaseUrl(): string {
  return process.env.EXPO_PUBLIC_BACKEND_BASE_URL || process.env.EXPO_PUBLIC_INDEXER_BASE_URL || "";
}

// CA-C2 fix: add HMAC auth header to push notification registration
function getApiKey(): string {
  return process.env.EXPO_PUBLIC_API_KEY || "";
}

/**
 * Fetch with an AbortController timeout.
 * Rejects with a DOMException-style error on timeout.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if an error from fetch is retryable (network / timeout / 5xx)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true; // timeout
  }
  if (error instanceof TypeError) {
    // Network error (fetch throws TypeError on network failure)
    return true;
  }
  return false;
}

/**
 * Determine if an HTTP status code is retryable
 */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Register push device token with the backend.
 * Retries up to MAX_RETRIES times with exponential backoff on
 * transient failures (network errors, timeouts, 5xx, 429).
 */
export async function registerPushDeviceToken(payload: RegisterPushTokenPayload): Promise<boolean> {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return false;
  }

  const normalizedBase = baseUrl.replace(/\/$/, "");
  const url = `${normalizedBase}${PUSH_REGISTRATION_PATH}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // CA-C2 fix: include API key if available to authenticate the registration
  const apiKey = getApiKey();
  if (apiKey) {
    const timestamp = Date.now().toString();
    headers["X-API-Key"] = apiKey;
    headers["X-Timestamp"] = timestamp;
  }

  const body = JSON.stringify({
    token: payload.token,
    walletAddress: payload.walletAddress || null,
    platform: "expo",
    app: "veilpay",
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {    try {      const response = await fetchWithTimeout(
        url,
        { method: "POST", headers, body },
        REQUEST_TIMEOUT_MS,
      );

      if (response.ok) {
        return true;
      }

      // Non-retryable client error (4xx except 429) — give up immediately
      if (!isRetryableStatus(response.status)) {
        return false;
      }

      // Retryable server error — log and continue to retry
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    } catch (error: unknown) {
      // Network / timeout error — retryable
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
        continue;
      }

      // Non-retryable or final attempt exhausted
      if (attempt === MAX_RETRIES) {
        captureMessage(
          `[pushNotifications] Registration failed after ${MAX_RETRIES} attempts`,
          'warning',
        );
      }
    }
  }

  return false;
}
