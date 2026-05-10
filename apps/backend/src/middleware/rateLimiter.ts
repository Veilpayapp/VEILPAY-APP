import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { config } from "../config";

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

  // H4 fix: select the merchant's actual tier from the DB
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, tier: true },
  });

  if (!merchant) {
    throw new Error(`Merchant not found: ${merchantId}`);
  }

  // BE-M10 fix: merchant.tier now exists in schema — no more `as any` cast
  const tier = merchant.tier ?? config.defaultMerchantTier;
  const limits = getMerchantTierLimit(tier);

  const limiter = rateLimit({
    windowMs: limits.windowMs,
    max: limits.max,
    standardHeaders: true,
    legacyHeaders: false,
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

/**
 * Invalidate a merchant's cached rate limiter.
 * Call this after a merchant's tier changes.
 */
export function invalidateMerchantLimiter(merchantId: string): void {
  merchantLimiters.delete(merchantId);
}

export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
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
  message: {
    error: "Webhook rate limit exceeded.",
    code: "WEBHOOK_RATE_LIMIT",
  },
});

/** M7 fix: tighter rate limit on the public invoice status endpoint */
export const invoiceStatusRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many invoice status requests. Please slow down.",
    code: "INVOICE_STATUS_RATE_LIMIT",
  },
});

/** Rate limit on the webhook verification endpoint */
export const webhookVerifyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: {
    error: "Too many webhook verification requests. Please slow down.",
    code: "WEBHOOK_VERIFY_RATE_LIMIT",
  },
});
