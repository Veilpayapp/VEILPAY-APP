import Redis from 'ioredis';
import { config } from '../config';

let redisInstance: Redis | null = null;
let initError: string | null = null;

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

export function disconnectRedis(): void {
  if (redisInstance) {
    redisInstance.disconnect();
    redisInstance = null;
  }
}
