/**
 * App attestation (Google Play Integrity) request helper — Hardening #2.
 *
 * When EXPO_PUBLIC_PLAY_INTEGRITY_ENABLED=true, HTTP calls to the backend's
 * attested endpoints (/api/v1/onramp/url, /api/v1/onramp/quotes, /api/v1/rpc)
 * must carry a Play Integrity token minted against a backend-issued nonce.
 *
 * Flow per request:
 *   1. POST /api/v1/attestation/nonce            → fresh, signed nonce
 *   2. native `requestIntegrityToken(nonce)`     → Google Play Integrity token
 *   3. attach { X-Veilpay-Nonce, X-Play-Integrity } headers to the call
 *
 * When disabled (the default, during rollout) this returns {} and the app
 * behaves exactly as before the attestation gate exists. When enabled but a
 * token cannot be obtained we return {} too — the backend then rejects the
 * request (fail-closed), which is the correct outcome rather than silently
 * sending an unattested call that might be accepted.
 */

const ENABLED = process.env.EXPO_PUBLIC_PLAY_INTEGRITY_ENABLED === 'true';
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

export interface IntegrityNative {
  requestIntegrityToken(nonce: string): Promise<string>;
}

// Lazily resolved so this module imports cleanly in Jest / Expo Go where the
// native module is absent; the app degrades to "no attestation headers".
let cachedNative: IntegrityNative | null | undefined;

async function getIntegrityModule(): Promise<IntegrityNative | null> {
  if (cachedNative !== undefined) return cachedNative;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@veilpay/expo-integrity-native') as Partial<IntegrityNative>;
    cachedNative =
      typeof mod.requestIntegrityToken === 'function' ? (mod as IntegrityNative) : null;
  } catch {
    cachedNative = null;
  }
  return cachedNative;
}

export type AttestationHeaders = Record<string, string>;

/**
 * Returns the attestation headers to merge into an HTTP call, or {} when
 * disabled or when a token cannot be produced.
 */
export async function getAttestationHeaders(): Promise<AttestationHeaders> {
  if (!ENABLED) return {};
  if (!BACKEND_URL) return {};

  try {
    const nonceRes = await fetch(`${BACKEND_URL}/api/v1/attestation/nonce`, {
      method: 'POST',
    });
    if (!nonceRes.ok) {
      console.warn('[attestation] nonce endpoint rejected', nonceRes.status);
      return {};
    }
    const parsed = (await nonceRes.json()) as { nonce?: unknown };
    if (typeof parsed.nonce !== 'string' || parsed.nonce.length === 0) {
      console.warn('[attestation] nonce missing from response');
      return {};
    }

    const mod = await getIntegrityModule();
    if (!mod) {
      console.warn(
        '[attestation] integrity-native module not linked (see modules/integrity-native README)'
      );
      return {};
    }

    const token = await mod.requestIntegrityToken(parsed.nonce);
    if (typeof token !== 'string' || token.length === 0) {
      console.warn('[attestation] empty integrity token from native');
      return {};
    }

    return { 'X-Veilpay-Nonce': parsed.nonce, 'X-Play-Integrity': token };
  } catch (err) {
    // Attestation became temporarily unavailable → backend fail-closes. Log and
    // return {} so the caller sends the request and lets the backend decide.
    console.warn('[attestation] could not obtain integrity token', err);
    return {};
  }
}

export const __attestationTest = { ENABLED, getIntegrityModule };
