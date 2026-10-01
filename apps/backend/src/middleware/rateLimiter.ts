import rateLimit, {
  MemoryStore,
  type IncrementResponse,
  type Options,
  type RateLimitRequestHandler,
  type Store,
} from "express-rate-limit";
import type Redis from "ioredis";
import { prisma } from "../lib/prisma";
import { config } from "../config";
import { getBoundedRedisClient } from "../lib/redis";
import RedisStore from "rate-limit-redis";

/**
 * Hard ceiling on a single rate-limit store round-trip. The bounded Redis
 * client already rejects commands via `commandTimeout`, but the store races
 * its own deadline as defense in depth so a misconfigured client can never
 * hang a request.
 */
const STORE_COMMAND_TIMEOUT_MS = 1000;

/**
 * D1: fail-over store. `getStore` used to hand the BullMQ Redis client
 * (maxRetriesPerRequest: null) to rate-limit-redis — with Redis down every
 * increment queued forever and every rate-limited route (including /health,
 * pre-D2) hung. Worse, the documented "null client → memory store" fallback
 * was unreachable: with lazyConnect the client object is non-null even while
 * Redis is down, so `if (!client) return undefined` never fired.
 *
 * This wrapper keeps the RedisStore for the healthy path and degrades to the
 * in-process MemoryStore when the bounded client is not `ready` or when a
 * command misses its deadline. The health check itself is a synchronous
 * status read, so it cannot hang.
 */
class FailoverRateLimitStore implements Store {
  private readonly redisStore: RedisStore;
  private readonly memoryStore = new MemoryStore();
  private readonly client: Redis;
  /**
   * True while increments are being served by Redis. Guards decrement/reset
   * routing: RedisStore.decrement is a plain DECR, so decrementing a key that
   * was never incremented (counters live in memory) would drive it to -1 and
   * trip express-rate-limit's positive-hits validation on the next increment.
   */
  private redisCountersLive = false;
  private fallbackWarned = false;

  constructor(redisStore: RedisStore, client: Redis) {
    this.redisStore = redisStore;
    this.client = client;
  }

  init(options: Options): void {
    this.memoryStore.init(options);
    // Script pre-load is best-effort: when Redis is down the loads reject and
    // increments fall back to memory (see increment). Never surface an
    // unhandled rejection from this fire-and-forget init.
    void this.redisStore.init(options)?.catch(() => undefined);
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (this.client.status === "ready") {
      try {
        const redisIncrement = this.redisStore.increment(key);
        // The losing side of the race below must not become an unhandled
        // rejection when it eventually settles.
        redisIncrement.catch(() => undefined);
        const result = await raceStoreTimeout(redisIncrement);
        this.redisCountersLive = true;
        return result;
      } catch {
        this.warnFallbackOnce();
      }
    }
    this.redisCountersLive = false;
    return this.memoryStore.increment(key);
  }

  async decrement(key: string): Promise<void> {
    // MemoryStore.decrement is a no-op for unknown keys, so applying it
    // unconditionally is safe.
    await this.memoryStore.decrement(key);
    if (this.redisCountersLive) {
      await this.redisStore.decrement(key).catch(() => undefined);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.memoryStore.resetKey(key);
    if (this.redisCountersLive) {
      await this.redisStore.resetKey(key).catch(() => undefined);
    }
  }

  private warnFallbackOnce(): void {
    if (this.fallbackWarned) return;
    this.fallbackWarned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[RateLimiter] Redis store unavailable — serving rate limits from the in-process memory store (limits are per-instance until Redis recovers)"
    );
  }
}

function raceStoreTimeout(storeIncrement: Promise<IncrementResponse>): Promise<IncrementResponse> {
  return new Promise<IncrementResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`rate-limit store timed out after ${STORE_COMMAND_TIMEOUT_MS}ms`));
    }, STORE_COMMAND_TIMEOUT_MS);
    storeIncrement.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function getStore(prefix: string): Store | undefined {
  // D1: request-path middleware uses the bounded client. The BullMQ client
  // (maxRetriesPerRequest: null) would queue every command forever while
  // Redis is down and hang the request.
  const client = getBoundedRedisClient();
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
  const redisStore = new RedisStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    sendCommand: sendCommand as any,
    prefix: `rl:${prefix}:`,
  });
  // D1: the null check above still never fires while Redis is merely down
  // (lazyConnect keeps the client object non-null), so wrap the store with
  // the health-aware fail-over above instead.
  return new FailoverRateLimitStore(redisStore, client);
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

// SEC-002: merchant registration is unauthenticated and returns a distinct
// 409 on duplicate email, which is an account-enumeration oracle. Full
// non-enumeration requires an async email-verification flow; until then this
// IP-anchored limiter bounds enumeration throughput (and abuse of the
// unauthenticated create path generally). Low ceiling: registration is rare.
export const registrationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('merchant_registration'),
  message: {
    error: "Too many registration attempts, please try again later.",
    code: "REGISTRATION_RATE_LIMIT",
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

/**
 * Tight per-IP limiter for the unauthenticated onramp order-creation endpoint.
 * Every call writes a persistent FiatOrder row, so bound it well below the
 * global 1000/min to stop table-bloat / provider-URL minting abuse.
 */
export const onrampCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('onramp_create'),
  message: {
    error: 'Too many onramp order creations. Please slow down.',
    code: 'ONRAMP_CREATE_RATE_LIMIT',
  },
});

/**
 * Per-IP limiter for the unauthenticated quotes endpoint. Bounds upstream
 * Binance fetches triggered by caller-supplied symbols.
 */
export const onrampQuotesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('onramp_quotes'),
  message: {
    error: 'Too many quote requests. Please slow down.',
    code: 'ONRAMP_QUOTES_RATE_LIMIT',
  },
});

/**
 * Light limiter on the public nonce-minting endpoint. Cheap to serve, but each
 * nonce is a hook for an app attestation attempt, so bound minting per-IP.
 */
export const attestationNonceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: getStore('attestation_nonce'),
  message: {
    error: 'Too many nonce requests. Please slow down.',
    code: 'ATTESTATION_NONCE_RATE_LIMIT',
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
 * Keying: the key is the resolved client IP (see `trust proxy` in index.ts),
 * which is the true per-client IP behind the reverse proxy. The former
 * `x-veilpay-device-id` sub-key is deliberately NOT used: it is a
 * client-controlled header, and sub-keying on it let an attacker rotate the
 * header to mint a fresh bucket per request, defeating the per-caller quota.
 * IP-only keying is not rotatable.
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
  // Key on the resolved client IP only. The x-veilpay-device-id header is
  // client-controlled, so sub-keying on it let an attacker rotate the header
  // to mint a fresh (ip, device) bucket per request and bypass the 120/min
  // quota. `trust proxy` (index.ts) makes req.ip the true per-client IP, so
  // IP-only keying is both correct and not rotatable.
  keyGenerator: (req) => req.ip || 'unknown',
  handler: (_req, res) => {
    res.status(429).json({
      error: 'RPC rate limit exceeded. Please slow down.',
      code: 'RPC_RATE_LIMIT',
      retryAfter: 60,
    });
  },
});
