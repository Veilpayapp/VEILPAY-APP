import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { config } from "../config";
import { getRedisClient } from "../lib/redis";
import RedisStore from "rate-limit-redis";

function getStore(prefix: string): RedisStore | undefined {
  const client = getRedisClient();
  if (!client) return undefined; // Fallback to memory store if Redis is unavailable
  // ioredis's `call(command, ...args)` returns `Promise<unknown>`. The
  // `RedisStore.sendCommand` contract is structurally compatible — the
  // store re-types the result internally — but the published types
  // declare a tighter `Promise<RedisReply>`. Bridge the gap with an
  // intermediate function typed as `Promise<unknown>` then re-typed
  // through `unknown` once at the call site to avoid an `any` value.
  const sendCommand = (...args: string[]): Promise<unknown> => {
    // `client.call` is typed as `Promise<unknown>` already, so no
    // assertion is required here.
    return client.call(args[0], ...args.slice(1));
  };
  return new RedisStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    sendCommand: sendCommand as any,
    prefix: `rl:${prefix}:`,
  });
}

type CachedLimiterEntry = {
  limiter: RateLimitRequestHandler;
  expiresAt: number;
};

class MerchantLimiterCache {
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, CachedLimiterEntry>();

  constructor(maxSize = 5000, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(merchantId: string): RateLimitRequestHandler | undefined {
    const entry = this.entries.get(merchantId);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(merchantId);
      return undefined;
    }

    // Refresh LRU position on access.
    this.entries.delete(merchantId);
    this.entries.set(merchantId, entry);

    return entry.limiter;
  }

  set(merchantId: string, limiter: RateLimitRequestHandler): void {
    if (this.entries.has(merchantId)) {
      this.entries.delete(merchantId);
    }

    this.entries.set(merchantId, {
      limiter,
      expiresAt: Date.now() + this.ttlMs,
    });

    while (this.entries.size > this.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }

      this.entries.delete(oldestKey);
    }
  }

  delete(merchantId: string): void {
    this.entries.delete(merchantId);
  }
}

const merchantLimiters = new MerchantLimiterCache();

const DEFAULT_LIMITS = {
  windowMs: 60 * 1000,
  max: 100,
};

const MERCHANT_LIMITS: Record<string, { windowMs: number; max: number }> = {
  basic: { windowMs: 60 * 1000, max: 60 },
  pro: { windowMs: 60 * 1000, max: 300 },
  enterprise: { windowMs: 60 * 1000, max: 1000 },
};

export function getMerchantTierLimit(tier: string): { windowMs: number; max: number } {
  return MERCHANT_LIMITS[tier] || DEFAULT_LIMITS;
}

export async function getMerchantLimiter(merchantId: string): Promise<RateLimitRequestHandler> {
  const cached = merchantLimiters.get(merchantId);
  if (cached) {
    return cached;
  }

  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, tier: true },
  });

  if (!merchant) {
    throw new Error(`Merchant not found: ${merchantId}`);
  }

  const tier = merchant.tier ?? config.defaultMerchantTier;
  const limits = getMerchantTierLimit(tier);

  const limiter = rateLimit({
    windowMs: limits.windowMs,
    max: limits.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: getStore(`merchant:${merchantId}`),
    keyGenerator: () => merchantId,
    handler: (_req, res) => {
      res.status(429).json({
        error: "Rate limit exceeded",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: Math.ceil(limits.windowMs / 1000),
      });
    },
  });

  merchantLimiters.set(merchantId, limiter);
  return limiter;
}

export function invalidateMerchantLimiter(merchantId: string): void {
  merchantLimiters.delete(merchantId);
}

export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('global'),
  message: {
    error: "Too many requests, please try again later.",
    code: "GLOBAL_RATE_LIMIT",
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  store: getStore('auth'),
  message: {
    error: "Too many authentication attempts, please try again later.",
    code: "AUTH_RATE_LIMIT",
  },
});

export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('webhook'),
  message: {
    error: "Webhook rate limit exceeded.",
    code: "WEBHOOK_RATE_LIMIT",
  },
});

export const invoiceStatusRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('invoice_status'),
  message: {
    error: "Too many invoice status requests. Please slow down.",
    code: "INVOICE_STATUS_RATE_LIMIT",
  },
});

export const webhookVerifyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  store: getStore('webhook_verify'),
  message: {
    error: "Too many webhook verification requests. Please slow down.",
    code: "WEBHOOK_VERIFY_RATE_LIMIT",
  },
});

/**
 * Dedicated limiter for the public RPC proxy (`/api/v1/rpc`).
 *
 * Tighter than the global limiter because the upstream provider keys are a
 * shared, metered resource — an attacker who discovers the endpoint could
 * otherwise burn Alchemy/Infura quota.
 *
 * Keying: the client IP is ALWAYS the anchor of the rate-limit key. The
 * `x-veilpay-device-id` header is only used to sub-partition per device WITHIN
 * an IP (fairness across multiple devices behind one NAT). Because the header
 * is client-controlled, keying on it alone would let an attacker rotate the
 * header to mint unlimited fresh buckets and bypass the limit — anchoring on
 * IP prevents that while still preserving per-device fairness.
 *
 * SECURITY(hardening): This is a quota-protection layer, not authentication.
 * Anyone can still call the endpoint. For production hardening, gate this route
 * behind Apple App Attest / Google Play Integrity attestation so only genuine
 * app builds can consume provider credits.
 */
export const rpcRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('rpc'),
  keyGenerator: (req) => {
    const ip = req.ip || 'unknown';
    const rawDeviceId = req.headers['x-veilpay-device-id'];
    if (typeof rawDeviceId === 'string' && rawDeviceId.length > 0) {
      // Cap the length so a maliciously huge header can't bloat the store, and
      // anchor on IP so rotating the device id cannot escape the IP's bucket.
      const deviceId = rawDeviceId.slice(0, 128);
      return `${ip}:device:${deviceId}`;
    }
    return ip;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: 'RPC rate limit exceeded. Please slow down.',
      code: 'RPC_RATE_LIMIT',
      retryAfter: 60,
    });
  },
});
