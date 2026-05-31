import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { getRedisClient } from '../lib/redis';
import { asyncHandler } from '../utils/asyncHandler';

export interface AuthenticatedRequest extends Request {
  merchantId?: string;
  merchant?: {
    id: string;
    businessName: string;
    email: string;
  };
}

export function generateSignature(payload: string, apiKey: string): string {
  return createHmac('sha256', apiKey).update(payload).digest('hex');
}

export function hashApiKey(apiKey: string): string {
  return createHmac('sha256', config.apiKeySalt).update(apiKey).digest('hex');
}

export function buildSignedPayload(req: Request, timestamp: string): string {
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
  const path = req.originalUrl.split('?')[0];

  return [req.method.toUpperCase(), path, timestamp, rawBody].join('\n');
}

export function validateSignature(
  payload: string,
  signature: string,
  apiKey: string
): boolean {
  const expected = generateSignature(payload, apiKey);

  if (signature.length !== expected.length) {
    return false;
  }

  if (!/^[0-9a-fA-F]+$/.test(signature)) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export const authMiddleware = asyncHandler(async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const apiKey = req.headers['x-api-key'] as string;
  const signature = req.headers['x-signature'] as string;
  const timestamp = req.headers['x-timestamp'] as string;

  if (!apiKey) {
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  if (!signature) {
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  if (!timestamp) {
    res.status(401).json({ error: 'Missing timestamp' });
    return;
  }

  const timestampNum = parseInt(timestamp, 10);
  if (isNaN(timestampNum) || Math.abs(Date.now() - timestampNum) > 300000) {
    res.status(401).json({ error: 'Invalid or expired timestamp' });
    return;
  }

  const redis = getRedisClient();
  if (redis) {
    const replayKey = `auth:nonce:${signature}`;
    const exists = await redis.exists(replayKey);
    if (exists) {
      res.status(401).json({ error: 'Replay attack detected: signature already used' });
      return;
    }
  }

  try {
    const merchant = await prisma.merchant.findFirst({
      where: {
        apiKeyHash: hashApiKey(apiKey),
        status: 'active',
      },
    });

    if (!merchant) {
      res.status(401).json({ error: 'Invalid API key or signature' });
      return;
    }

    const payload = buildSignedPayload(req, timestamp);
    const isValid = validateSignature(payload, signature, apiKey);

    if (!isValid) {
      res.status(401).json({ error: 'Invalid API key or signature' });
      return;
    }

    if (redis) {
      const replayKey = `auth:nonce:${signature}`;
      await redis.setex(replayKey, 300, '1'); // 5 minute TTL
    }

    req.merchantId = merchant.id;
    req.merchant = {
      id: merchant.id,
      businessName: merchant.businessName,
      email: merchant.email,
    };

    next();
  } catch (error) {
    console.error('[Auth] Error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * requireAuth — validates that authMiddleware has already populated req.merchantId.
 * Always pair with authMiddleware; never use standalone.
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.merchantId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}
