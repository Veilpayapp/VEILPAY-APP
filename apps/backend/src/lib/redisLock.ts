import { getRedisClient } from './redis';

/**
 * Acquires a distributed lock using Redis `SET key value NX PX ttl`
 * If the lock is acquired, executes the provided function and releases the lock afterward.
 * If the lock is already held by another instance, the function is skipped.
 *
 * @param key The unique key for the lock
 * @param ttlMs Time-to-live for the lock in milliseconds (to prevent deadlocks if the instance crashes)
 * @param fn The function to execute if the lock is acquired
 */
export async function withRedisLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T | null> {
  const redis = getRedisClient();
  
  if (!redis) {
    // If Redis is not available, default to running the function (local only)
    console.warn(`[RedisLock] Redis not available, running ${key} locally.`);
    return fn();
  }

  const lockKey = `lock:${key}`;
  // Use a random value to ensure we only delete OUR lock, not someone else's who acquired it after ours expired
  const lockValue = Math.random().toString(36).substring(2, 15);

  try {
    // Attempt to acquire the lock
    const acquired = await redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');

    if (acquired !== 'OK') {
      // Lock is held by someone else, skip execution
      return null;
    }

    // Execute the critical section
    const result = await fn();
    return result;
  } finally {
    // Release the lock using a Lua script to ensure we only delete it if the value matches
    // This prevents deleting a lock that expired and was re-acquired by another instance
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await redis.eval(script, 1, lockKey, lockValue);
    } catch (error) {
      console.error(`[RedisLock] Error releasing lock for ${key}:`, error);
    }
  }
}
