/**
 * SEC-006 residual: optional shared-secret gate for the relayer withdraw surface.
 *
 * When `RELAYER_SHARED_SECRET` is set, callers must send matching
 * `X-Relayer-Secret` (timing-safe). When unset:
 *   - development / test: open (local e2e)
 *   - production: reject 503 unless `RELAYER_ALLOW_UNAUTHENTICATED=true`
 *     (explicit opt-out for emergency only — not recommended)
 *
 * Quotas / circuit breaker remain the primary cost controls; this stops
 * anonymous internet callers from burning relayer gas when secret is configured.
 */

import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still run a comparison to reduce trivial length leaks.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function relayerCallerAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = (process.env.RELAYER_SHARED_SECRET || '').trim();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const allowUnauth =
    process.env.RELAYER_ALLOW_UNAUTHENTICATED === 'true' ||
    nodeEnv === 'test' ||
    nodeEnv === 'development';

  if (!expected) {
    if (!allowUnauth && nodeEnv === 'production') {
      res.status(503).json({
        error: 'Relayer caller auth not configured',
        code: 'RELAYER_AUTH_NOT_CONFIGURED',
      });
      return;
    }
    next();
    return;
  }

  const provided =
    (req.headers['x-relayer-secret'] as string | undefined)?.trim() ||
    (req.headers['authorization'] as string | undefined)?.replace(
      /^Bearer\s+/i,
      ''
    ).trim() ||
    '';

  if (!provided || !secretsEqual(provided, expected)) {
    res.status(401).json({
      error: 'Invalid or missing relayer credentials',
      code: 'RELAYER_UNAUTHORIZED',
    });
    return;
  }

  next();
}
