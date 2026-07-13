import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

/**
 * SEC-005 fix: signed opaque status token for fiat onramp orders.
 *
 * Previously `GET /api/v1/onramp/status/:id` accepted the raw order UUID and
 * returned the entire `FiatOrder` row — including `userAddress`, fiat/crypto
 * amounts, chain, and txHash — to anyone who could guess or obtain the order
 * ID (which leaks via URLs, logs, and shared screens).
 *
 * The token format is `orderId.signature` where:
 *   - `orderId` is the FiatOrder primary key (UUID);
 *   - `signature = HMAC-SHA256(webhookSigningSecret, orderId)` (hex).
 *
 * The status endpoint requires the token, splits on `.`, re-computes the
 * HMAC, and compares in constant time before looking up the order. An
 * attacker who only has the order UUID cannot forge the signature.
 *
 * The token is returned once from `POST /api/v1/onramp/url` and held by the
 * consumer-app; it never appears in the create-order response body alongside
 * sensitive fields and is not logged.
 */

const TOKEN_SEPARATOR = '.';

function signatureFor(orderId: string): string {
  return createHmac('sha256', config.webhookSigningSecret)
    .update(orderId)
    .digest('hex');
}

export function createStatusToken(orderId: string): string {
  return `${orderId}${TOKEN_SEPARATOR}${signatureFor(orderId)}`;
}

export class InvalidStatusTokenError extends Error {
  constructor() {
    super('Invalid or expired status token');
    this.name = 'InvalidStatusTokenError';
  }
}

/**
 * Verify a status token and return the embedded order ID. Throws
 * `InvalidStatusTokenError` if the token is malformed or the signature does
 * not match.
 */
export function verifyStatusToken(token: string): string {
  const sepIndex = token.lastIndexOf(TOKEN_SEPARATOR);
  if (sepIndex <= 0 || sepIndex >= token.length - 1) {
    throw new InvalidStatusTokenError();
  }
  const orderId = token.slice(0, sepIndex);
  const signature = token.slice(sepIndex + 1);

  const expected = signatureFor(orderId);

  // Constant-time comparison to prevent signature oracle timing attacks.
  if (signature.length !== expected.length || !/^[0-9a-f]+$/.test(signature)) {
    throw new InvalidStatusTokenError();
  }
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new InvalidStatusTokenError();
  }

  return orderId;
}
