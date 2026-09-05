/**
 * Play Integrity auth middleware — Hardening #2.
 *
 * Applies to the formerly unauthenticated onramp (/url, /quotes) and RPC-proxy
 * routes. Behaviour:
 *   - ATTESTATION ENABLED  → every request must carry a valid
 *     `X-Play-Integrity` token + `X-Veilpay-Nonce`; verified server-side via
 *     Google. Any missing/invalid/bad-verdict token is rejected (401/502/503).
 *   - ATTESTATION DISABLED:
 *       - development / test → pass (rollout; the app has not shipped the
 *         attestation yet).
 *       - production         → 503 `ATTESTATION_NOT_CONFIGURED` (fail closed).
 *         The team opted into app attestation; a production deploy without it
 *         wired must NOT silently leave these three endpoints open to the
 *         internet. Refuse loudly until Play Integral config is supplied.
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import {
  verifyAttestation,
  errorToHttp,
  isPlayIntegrityConfigured,
} from '../lib/playIntegrity';

const NONCE_HEADER = 'x-veilpay-nonce';
const TOKEN_HEADER = 'x-play-integrity';

export function playIntegrityAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!config.playIntegrity.enabled) {
    // Fail closed when NODE_ENV is unset: an unspecified environment must not
    // auto-open the formerly-unauthenticated onramp/RPC surface just because
    // the config schema defaults NODE_ENV to 'development'. Only an explicit
    // development/test value opens it (mirrors relayerAuth). Read process.env
    // directly so the config default cannot leak in.
    const nodeEnv = process.env.NODE_ENV; // no default
    if (nodeEnv !== 'development' && nodeEnv !== 'test') {
      res.status(503).json({
        error: 'Play Integrity attestation is not configured for this endpoint.',
        code: 'ATTESTATION_NOT_CONFIGURED',
      });
      return;
    }
    // Rollout: attestation not yet enabled in dev/test — keep the app working.
    next();
    return;
  }

  // Enabled but incomplete config — refuse rather than silently allow.
  if (!isPlayIntegrityConfigured()) {
    res.status(503).json({
      error: 'Play Integrity attestation is misconfigured.',
      code: 'ATTESTATION_NOT_CONFIGURED',
    });
    return;
  }

  const rawToken = req.get(TOKEN_HEADER);
  const nonceRaw = req.get(NONCE_HEADER);

  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    res.status(401).json({ error: 'Missing app attestation', code: 'TOKEN_MISSING' });
    return;
  }

  void verifyAttestation({ token: rawToken, nonceRaw: nonceRaw ?? '' }).then(
    (result) => {
      if (result.ok) {
        next();
        return;
      }
      const err = errorToHttp(result.code);
      res.status(err.status).json({
        error: 'App attestation failed',
        code: err.code,
        ...(result.detail ? { detail: result.detail } : {}),
        ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}),
      });
    }
  );
}
