/**
 * SEC-006: in-memory (and Redis-backed when available) quotas for the
 * unauthenticated relayer gas-sponsorship surface.
 *
 * Limits:
 *  - one in-flight / recent spend per nullifierHash (24h)
 *  - per-recipient withdraw count (rolling window)
 *  - per-IP withdraw count (rolling window)
 *  - optional operator balance floor before broadcast
 */

import { getRedisClient } from '../lib/redis';

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const NULLIFIER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_PER_RECIPIENT = 10;
const MAX_PER_IP = 30;

/** Minimum relayer ETH balance (wei) before accepting new sponsorships. */
export const RELAYER_MIN_BALANCE_WEI = BigInt(
  process.env.RELAYER_MIN_BALANCE_WEI?.trim() || '10000000000000000' // 0.01 ETH
);

type Bucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, Bucket>();
const spentNullifiers = new Map<string, number>();

function memTake(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = memoryBuckets.get(key);
  if (!cur || cur.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (cur.count >= max) return false;
  cur.count += 1;
  return true;
}

async function redisIncr(key: string, max: number, ttlSec: number): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return memTake(key, max, ttlSec * 1000);
  try {
    const n = await redis.incr(key);
    if (n === 1) {
      await redis.expire(key, ttlSec);
    }
    return n <= max;
  } catch {
    return memTake(key, max, ttlSec * 1000);
  }
}

export async function assertNullifierNotSpent(nullifierHash: string): Promise<boolean> {
  const key = `relayer:nullifier:${nullifierHash.toLowerCase()}`;
  const redis = getRedisClient();
  if (redis) {
    try {
      const exists = await redis.exists(key);
      return exists === 0;
    } catch {
      /* fall through */
    }
  }
  const until = spentNullifiers.get(key) ?? 0;
  if (until > Date.now()) return false;
  spentNullifiers.delete(key);
  return true;
}

export async function markNullifierSpent(nullifierHash: string): Promise<void> {
  const key = `relayer:nullifier:${nullifierHash.toLowerCase()}`;
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(key, '1', 'PX', NULLIFIER_TTL_MS);
      return;
    } catch {
      /* fall through */
    }
  }
  spentNullifiers.set(key, Date.now() + NULLIFIER_TTL_MS);
}

export type RelayerQuotaResult =
  | { ok: true }
  | { ok: false; status: 429 | 503; error: string; code: string };

export async function checkRelayerQuotas(opts: {
  nullifierHash: string;
  recipient: string;
  clientIp: string;
}): Promise<RelayerQuotaResult> {
  const free = await assertNullifierNotSpent(opts.nullifierHash);
  if (!free) {
    return {
      ok: false,
      status: 429,
      error: 'Nullifier already sponsored or in cooldown',
      code: 'RELAYER_NULLIFIER_QUOTA',
    };
  }

  const recipOk = await redisIncr(
    `relayer:recipient:${opts.recipient.toLowerCase()}`,
    MAX_PER_RECIPIENT,
    Math.floor(WINDOW_MS / 1000)
  );
  if (!recipOk) {
    return {
      ok: false,
      status: 429,
      error: 'Recipient withdraw quota exceeded',
      code: 'RELAYER_RECIPIENT_QUOTA',
    };
  }

  const ipOk = await redisIncr(
    `relayer:ip:${opts.clientIp || 'unknown'}`,
    MAX_PER_IP,
    Math.floor(WINDOW_MS / 1000)
  );
  if (!ipOk) {
    return {
      ok: false,
      status: 429,
      error: 'IP withdraw quota exceeded',
      code: 'RELAYER_IP_QUOTA',
    };
  }

  return { ok: true };
}

/** Circuit breaker: trip when consecutive failures exceed threshold. */
let consecutiveFailures = 0;
const CIRCUIT_TRIP_AT = 20;
let circuitOpenUntil = 0;

export function noteRelayerSuccess(): void {
  consecutiveFailures = 0;
}

export function noteRelayerFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_TRIP_AT) {
    circuitOpenUntil = Date.now() + 5 * 60 * 1000;
    consecutiveFailures = 0;
  }
}

export function isRelayerCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

/** Test helpers */
export const __test = {
  reset() {
    memoryBuckets.clear();
    spentNullifiers.clear();
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
  },
  MAX_PER_RECIPIENT,
  MAX_PER_IP,
};
