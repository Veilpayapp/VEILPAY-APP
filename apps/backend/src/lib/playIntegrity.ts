/**
 * Play Integrity (app attestation) — Hardening #2.
 *
 * Closes the anonymous-internet hole on the onramp (/url, /quotes) and RPC-proxy
 * routes. Callers must present a Google Play Integrity attestation token minted
 * against a backend-issued nonce; this module verifies it server-side via
 * Google's `decodeIntegrityToken` endpoint (the recommended production path —
 * Google decodes + verifies the token and returns a structured verdict JSON we
 * then assert on).
 *
 * Two stateful pieces the operator supplies (cannot be synthesized in-repo):
 *   - PLAY_INTEGRITY_PACKAGE_NAME + PLAY_INTEGRITY_APP_CERT_SHA256 from Play Console
 *   - a Google Cloud service-account JSON key (base64) for the Cloud project
 *     linked to the Play Console app
 *
 * Nonce flow (replay protection):
 *   1. Client asks `POST /api/v1/attestation/nonce` → signed, short-TTL nonce.
 *   2. App requests an integrity token FROM PLAY INTEGRITY WITH THAT NONCE,
 *      and sends token + nonce back on the attested request.
 *   3. This module verifies the nonce signature/TTL, then checks that the
 *      nonce Play echoed inside the decoded verdict equals the issued nonce,
 *      the package + cert digest match our App, and the device verdict clears
 *      the configured floor. Play only mints tokens carrying the caller's
 *      nonce, so a token minted for someone else's nonce fails parity and a
 *      replayed token fails the freshness window.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { config } from '../config';
import { logger } from './logger';
import { getRedisClient } from './redis';

const OAUTH_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const PLAY_INTEGRITY_DECODE_BASE = 'https://playintegrity.googleapis.com/v1';

/** Half-life of an issued nonce — long enough to mint an attestation, short
 *  enough that a leaked nonce cannot be replayed against a stale attestation. */
const NONCE_TTL_MS = 2 * 60 * 1000;

const OAUTH_TIMEOUT_MS = 5_000;
const DECODE_TIMEOUT_MS = 5_000;

export type IntegrityErrorCode =
  | 'ATTESTATION_NOT_CONFIGURED'
  | 'NONCE_MISSING'
  | 'NONCE_INVALID'
  | 'NONCE_EXPIRED'
  | 'TOKEN_MISSING'
  | 'TOKEN_INVALID'
  | 'TOKEN_VERIFICATION_UNAVAILABLE'
  | 'PACKAGE_MISMATCH'
  | 'CERT_MISMATCH'
  | 'NONCE_MISMATCH'
  | 'DEVICE_INTEGRITY_FAILED'
  | 'ATTESTATION_STALE';

/** HTTP status + JSON body shape the middleware returns for a given code. */
export type AttestationError = {
  status: number;
  code: IntegrityErrorCode;
  detail?: string;
  retryAfter?: number;
};

class IntegrityVerificationError extends Error {
  readonly code: IntegrityErrorCode;
  readonly httpStatus: number;
  constructor(code: IntegrityErrorCode, httpStatus = 401, detail?: string) {
    super(`Play Integrity verification failed: ${code}`);
    this.code = code;
    this.httpStatus = httpStatus;
    this.name = 'IntegrityVerificationError';
    if (detail) (this as { detail?: string }).detail = detail;
  }
}

/** True when attestation is enabled AND all required config is present. */
export function isPlayIntegrityConfigured(): boolean {
  const pi = config.playIntegrity;
  return Boolean(
    pi.enabled &&
      pi.packageName &&
      pi.appCertSha256 &&
      pi.serviceAccountB64
  );
}

// ─── Nonce (HMAC-signed + Redis single-use) ──────────────────────────────────

function hmacSha256(value: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

/**
 * Issues a self-verifying nonce: `claims.signature` where claims carry a random
 * value and an expiry. Validation is stateless (HMAC + TTL) so any instance can
 * verify it, but `verifyAttestation` additionally marks each raw nonce used via
 * Redis SET-NX (`consumeAttestationNonce`), so a verified nonce cannot be
 * replayed within its TTL even across instances.
 */
export function issueAttestationNonce(): string {
  const n = randomBytes(16).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({ n, exp: Date.now() + NONCE_TTL_MS }),
    'utf8'
  ).toString('base64url');
  const sig = hmacSha256(claims, config.jwtSecret).toString('base64url');
  return `${claims}.${sig}`;
}

export type NonceCheck =
  | { ok: true; nonce: string }
  | { ok: false; code: IntegrityErrorCode };

export function verifyAttestationNonce(raw: unknown): NonceCheck {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, code: 'NONCE_MISSING' };
  }
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) {
    return { ok: false, code: 'NONCE_INVALID' };
  }
  const claimsB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);

  const expectedSig = hmacSha256(claimsB64, config.jwtSecret);
  let provided: Buffer;
  try {
    provided = Buffer.from(sigB64, 'base64url');
  } catch {
    return { ok: false, code: 'NONCE_INVALID' };
  }
  if (
    provided.length !== expectedSig.length ||
    !timingSafeEqual(provided, expectedSig)
  ) {
    return { ok: false, code: 'NONCE_INVALID' };
  }

  let claims: { n?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(
      Buffer.from(claimsB64, 'base64url').toString('utf8')
    ) as { n?: unknown; exp?: unknown };
  } catch {
    return { ok: false, code: 'NONCE_INVALID' };
  }
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    return { ok: false, code: 'NONCE_INVALID' };
  }
  if (Date.now() > claims.exp) {
    return { ok: false, code: 'NONCE_EXPIRED' };
  }
  if (typeof claims.n !== 'string' || claims.n.length === 0) {
    return { ok: false, code: 'NONCE_INVALID' };
  }
  return { ok: true, nonce: claims.n };
}

/**
 * Marks a verified nonce as consumed so it cannot be replayed within its TTL.
 *
 * Uses Redis SET NX (set-if-not-exists) keyed on the full raw nonce
 * (claims.signature) with the same TTL as the nonce expiry, so a genuine first
 * use atomically wins the key and a second use sees it already present. The
 * check is purely best-effort / fail-safe:
 *   - Redis unavailable (null client / connection error)  -> returns ok:true;
 *     we still verify the attestation rather than breaking the happy path on a
 *     Redis blip. This matches the existing onramp/limiter convention of
 *     gracefully falling back to in-process behavior when Redis is down.
 *   - SET returns non-'OK' (key already set by an earlier use) -> replay.
 */
export async function consumeAttestationNonce(
  raw: string
): Promise<{ ok: boolean; replay?: boolean }> {
  const client = getRedisClient();
  if (!client) return { ok: true };
  try {
    const ttlSeconds = Math.ceil(NONCE_TTL_MS / 1000);
    const res = await client.set(
      `nonce:used:${raw}`,
      '1',
      'EX',
      ttlSeconds,
      'NX'
    );
    if (res !== 'OK') {
      return { ok: false, replay: true };
    }
    return { ok: true };
  } catch {
    // Redis blip — don't fail the request; the HMAC signature + short TTL and
    // the Play verdict freshness window remain as the primary replay controls.
    return { ok: true };
  }
}

// ─── Service-account OAuth ───────────────────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function getServiceAccount(): ServiceAccount | null {
  const b64 = config.playIntegrity.serviceAccountB64;
  if (!b64) return null;
  try {
    const json = JSON.parse(
      Buffer.from(b64, 'base64').toString('utf8')
    ) as {
      client_email?: unknown;
      private_key?: unknown;
      token_uri?: unknown;
    };
    if (
      typeof json.client_email === 'string' &&
      json.client_email.length > 0 &&
      typeof json.private_key === 'string' &&
      json.private_key.length > 0
    ) {
      return {
        client_email: json.client_email,
        private_key: json.private_key,
        token_uri:
          typeof json.token_uri === 'string' && json.token_uri.length > 0
            ? json.token_uri
            : OAUTH_TOKEN_URI,
      };
    }
  } catch {
    /* malformed base64 / JSON — treated as not configured */
  }
  return null;
}

async function fetchAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: PLAY_INTEGRITY_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(sa.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);
  try {
    const res = await fetch(sa.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(
        { event: 'play_integrity_oauth_failed', status: res.status },
        'Play Integrity OAuth token exchange failed'
      );
      throw new IntegrityVerificationError('TOKEN_VERIFICATION_UNAVAILABLE', 502);
    }
    const data = (await res.json()) as { access_token?: unknown };
    if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
      throw new IntegrityVerificationError('TOKEN_VERIFICATION_UNAVAILABLE', 502);
    }
    return data.access_token;
  } catch (err) {
    if (err instanceof IntegrityVerificationError) throw err;
    logger.warn(
      { event: 'play_integrity_oauth_network_failed', err },
      'Play Integrity OAuth network failure'
    );
    throw new IntegrityVerificationError('TOKEN_VERIFICATION_UNAVAILABLE', 502);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Decode + consensus checks ───────────────────────────────────────────────

export interface DecodedIntegrityVerdict {
  requestDetails?: {
    requestPackageName?: string;
    nonce?: string;
    timestampMillis?: number;
  };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    packageName?: string;
    appCertSha256?: string[];
  };
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string;
  };
  accountDetails?: unknown;
  testingDetails?: unknown;
}

async function fetchDecodedVerdict(
  rawToken: string
): Promise<DecodedIntegrityVerdict> {
  const sa = getServiceAccount();
  if (!sa) {
    throw new IntegrityVerificationError('ATTESTATION_NOT_CONFIGURED', 503);
  }
  const accessToken = await fetchAccessToken(sa);
  const pkg = config.playIntegrity.packageName;
  const url = `${PLAY_INTEGRITY_DECODE_BASE}/${encodeURIComponent(pkg)}:decodeIntegrityToken`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECODE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ integrityToken: rawToken }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // 400 means Google could not decode/verify the token → invalid input.
      const code =
        res.status === 400 ? 'TOKEN_INVALID' : 'TOKEN_VERIFICATION_UNAVAILABLE';
      throw new IntegrityVerificationError(
        code,
        res.status === 400 ? 401 : 502
      );
    }
    const data = (await res.json()) as {
      tokenPayloadExternal?: DecodedIntegrityVerdict;
    };
    if (!data.tokenPayloadExternal) {
      throw new IntegrityVerificationError('TOKEN_INVALID', 401);
    }
    return data.tokenPayloadExternal;
  } catch (err) {
    if (err instanceof IntegrityVerificationError) throw err;
    logger.warn(
      { event: 'play_integrity_decode_network_failed', err },
      'Play Integrity decode network failure'
    );
    throw new IntegrityVerificationError('TOKEN_VERIFICATION_UNAVAILABLE', 502);
  } finally {
    clearTimeout(timer);
  }
}

const DEVICE_VERDICT_RANK: Record<string, number> = {
  MEETS_STRONG_INTEGRITY: 4,
  MEETS_DEVICE_INTEGRITY: 3,
  MEETS_VIRTUAL_INTEGRITY: 2,
  MEETS_BASIC_INTEGRITY: 1,
  UNAVAILABLE: 0,
};

/** Compares a returned device verdict against the configured floor. */
function meetsMinDeviceVerdict(
  verdict: string | undefined,
  floor: string
): boolean {
  if (!verdict) return false;
  const floorRank = DEVICE_VERDICT_RANK[floor] ?? 0;
  const got = DEVICE_VERDICT_RANK[verdict] ?? -1;
  return got >= floorRank && got > 0;
}

/** Expected values a verdict must match (passed in so the function is pure). */
export interface VerdictExpectations {
  requestPackageName: string;
  appCertSha256: string;
  minDeviceVerdict: string;
  /** 0 disables the freshness window. */
  maxAgeMs?: number;
}

/**
 * Pure consensus check over an already-decoded/verified verdict. No I/O, no
 * import-time config reads, so it is exhaustively unit-testable without
 * touching Google.
 */
export function checkDecodedVerdict(
  decoded: DecodedIntegrityVerdict,
  expectedNonce: string,
  expected: VerdictExpectations
):
  | { ok: true }
  | { ok: false; code: IntegrityErrorCode; detail?: string } {
  const pkg = expected.requestPackageName;
  const cert = expected.appCertSha256;
  const maxAgeMs = expected.maxAgeMs ?? 0;

  const rd = decoded.requestDetails;
  if (!rd || rd.requestPackageName !== pkg) {
    return { ok: false, code: 'PACKAGE_MISMATCH' };
  }
  if (expectedNonce && rd.nonce !== expectedNonce) {
    return { ok: false, code: 'NONCE_MISMATCH' };
  }
  if (
    maxAgeMs > 0 &&
    typeof rd.timestampMillis === 'number' &&
    Date.now() - rd.timestampMillis > maxAgeMs
  ) {
    return { ok: false, code: 'ATTESTATION_STALE' };
  }

  const ai = decoded.appIntegrity;
  if (!ai) {
    return { ok: false, code: 'DEVICE_INTEGRITY_FAILED' };
  }
  if (ai.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
    return { ok: false, code: 'PACKAGE_MISMATCH' };
  }
  if (ai.packageName && ai.packageName !== pkg) {
    return { ok: false, code: 'PACKAGE_MISMATCH' };
  }
  if (
    Array.isArray(ai.appCertSha256) &&
    ai.appCertSha256.length > 0 &&
    !ai.appCertSha256.some((c) => c === cert)
  ) {
    return { ok: false, code: 'CERT_MISMATCH' };
  }

  const dv = decoded.deviceIntegrity?.deviceRecognitionVerdict;
  if (!meetsMinDeviceVerdict(dv, expected.minDeviceVerdict)) {
    return { ok: false, code: 'DEVICE_INTEGRITY_FAILED', detail: dv };
  }

  return { ok: true };
}

/**
 * Full verification path used by the middleware: verify the nonce, decode the
 * attestation via Google, then run the consensus checks.
 */
export async function verifyAttestation(opts: {
  token: string;
  nonceRaw: string;
}):
  | Promise<
      | { ok: true }
      | { ok: false; code: IntegrityErrorCode; detail?: string }
    > {
  const nonceCheck = verifyAttestationNonce(opts.nonceRaw);
  if (!nonceCheck.ok) return nonceCheck;

  // Single-use: consume the nonce so a verified nonce cannot be replayed
  // within its TTL. Fail-safe (still verify) if Redis is unavailable.
  const consumed = await consumeAttestationNonce(opts.nonceRaw);
  if (!consumed.ok) {
    return { ok: false, code: 'NONCE_INVALID', detail: 'NONCE_REUSED' };
  }

  let decoded: DecodedIntegrityVerdict;
  try {
    decoded = await fetchDecodedVerdict(opts.token);
  } catch (err) {
    if (err instanceof IntegrityVerificationError) {
      return {
        ok: false,
        code: err.code,
        detail: (err as { detail?: string }).detail,
      };
    }
    return { ok: false, code: 'TOKEN_VERIFICATION_UNAVAILABLE' };
  }

  return checkDecodedVerdict(decoded, nonceCheck.nonce, {
    requestPackageName: config.playIntegrity.packageName,
    appCertSha256: config.playIntegrity.appCertSha256,
    minDeviceVerdict: config.playIntegrity.minDeviceVerdict,
    maxAgeMs: config.playIntegrity.maxAgeMs,
  });
}

export function errorToHttp(code: IntegrityErrorCode): AttestationError {
  switch (code) {
    case 'ATTESTATION_NOT_CONFIGURED':
      return { status: 503, code, retryAfter: 3600 };
    case 'TOKEN_VERIFICATION_UNAVAILABLE':
      return { status: 502, code };
    case 'NONCE_MISSING':
    case 'TOKEN_MISSING':
    case 'NONCE_INVALID':
    case 'NONCE_EXPIRED':
    case 'TOKEN_INVALID':
    case 'PACKAGE_MISMATCH':
    case 'CERT_MISMATCH':
    case 'NONCE_MISMATCH':
    case 'DEVICE_INTEGRITY_FAILED':
    case 'ATTESTATION_STALE':
      return { status: 401, code };
    default:
      return { status: 401, code: 'TOKEN_INVALID' };
  }
}

export const __playIntegrityTest = {
  hmacSha256,
  NONCE_TTL_MS,
  getServiceAccount,
  IntegrityVerificationError,
};
