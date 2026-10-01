import Redis from 'ioredis';
import { config } from '../config';

let redisInstance: Redis | null = null;
let initError: string | null = null;

// ── Bounded Redis client (request-path: rate limiting, sessions) ──────────
// The BullMQ client from getRedisClient() must keep `maxRetriesPerRequest:
// null`, which queues every command forever while Redis is down. Middleware
// on that client therefore hangs the whole API — including /health — during a
// Redis outage. This second client hard-bounds every command so request-path
// consumers fail over (memory store / failed session ops) instead of hanging.
let boundedRedisInstance: Redis | null = null;
let boundedInitError: string | null = null;

/** Give up reconnecting the bounded client after this many attempts. */
const BOUNDED_MAX_RECONNECT_ATTEMPTS = 3;

export function parseRedisUrl(rawUrl: string): { host: string; port: number; password?: string; tls?: boolean } {
  try {
    if (!rawUrl.includes('://')) {
      const [host, portStr] = rawUrl.split(':');
      return {
        host: host || 'localhost',
        port: parseInt(portStr || '6379', 10),
      };
    }

    const parsed = new URL(rawUrl);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? true : undefined,
    };
  } catch {
    console.warn(`[Redis] Failed to parse Redis URL, falling back to localhost:6379`);
    return { host: 'localhost', port: 6379 };
  }
}

export function getRedisClient(): Redis | null {
  if (redisInstance) return redisInstance;

  try {
    const parsed = parseRedisUrl(config.redisUrl);

    const redisOptions = {
      host: parsed.host,
      port: parsed.port,
      password: parsed.password || config.redisPassword || undefined,
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
      ...(parsed.tls ? { tls: {} } : {}),
    };

    redisInstance = new Redis(redisOptions);

    redisInstance.on('error', (err) => {
      initError = err instanceof Error ? err.message : 'Redis error';
      // eslint-disable-next-line no-console
      console.warn(`[Redis] Connection error: ${initError}`);
    });

    return redisInstance;
  } catch (err) {
    initError = err instanceof Error ? err.message : 'Unknown initialization error';
    // eslint-disable-next-line no-console
    console.warn(`[Redis] Failed to initialize: ${initError}`);
    redisInstance = null;
    return null;
  }
}

export function getRedisInitError(): string | null {
  return initError;
}

/**
 * Second, bounded Redis client for request-path middleware (rate limiting,
 * express-session). Every command has a hard deadline:
 * - `maxRetriesPerRequest: 2` — a command fails after 2 retries instead of
 *   queueing forever (the BullMQ client's `null` semantics).
 * - `commandTimeout` — even queued commands reject once the deadline passes.
 * - `connectTimeout` + a bounded `retryStrategy` — connection attempts stop
 *   after BOUNDED_MAX_RECONNECT_ATTEMPTS instead of retrying forever.
 * Consumers must treat a command failure as "fall back", never "wait".
 */
export function getBoundedRedisClient(): Redis | null {
  if (boundedRedisInstance) return boundedRedisInstance;

  try {
    const parsed = parseRedisUrl(config.redisUrl);

    const redisOptions = {
      host: parsed.host,
      port: parsed.port,
      password: parsed.password || config.redisPassword || undefined,
      maxRetriesPerRequest: 2,
      commandTimeout: 1000,
      connectTimeout: 2000,
      retryStrategy: (times: number) =>
        times <= BOUNDED_MAX_RECONNECT_ATTEMPTS
          ? Math.min(times * 200, 1000)
          : null,
      lazyConnect: true,
      ...(parsed.tls ? { tls: {} } : {}),
    };

    boundedRedisInstance = new Redis(redisOptions);

    boundedRedisInstance.on('error', (err) => {
      boundedInitError = err instanceof Error ? err.message : 'Redis error';
      // eslint-disable-next-line no-console
      console.warn(`[Redis] Bounded client connection error: ${boundedInitError}`);
    });

    // lazyConnect leaves the client in 'wait' until the first command; kick
    // the connection ourselves so `status` converges to 'ready' (or to 'end'
    // once the bounded retryStrategy gives up) without waiting for traffic.
    // Fire-and-forget: connection failures are captured by the error handler
    // above; consumers read `status` to decide failover.
    try {
      void boundedRedisInstance.connect().catch(() => undefined);
    } catch {
      // connect() throws synchronously when a connection attempt is already
      // in flight — harmless, `status` remains authoritative.
    }

    return boundedRedisInstance;
  } catch (err) {
    boundedInitError = err instanceof Error ? err.message : 'Unknown bounded initialization error';
    // eslint-disable-next-line no-console
    console.warn(`[Redis] Failed to initialize bounded client: ${boundedInitError}`);
    boundedRedisInstance = null;
    return null;
  }
}

export function getBoundedRedisInitError(): string | null {
  return boundedInitError;
}

export function disconnectBoundedRedis(): void {
  if (boundedRedisInstance) {
    boundedRedisInstance.disconnect();
    boundedRedisInstance = null;
  }
}

export function disconnectRedis(): void {
  if (redisInstance) {
    redisInstance.disconnect();
    redisInstance = null;
  }
  disconnectBoundedRedis();
}
