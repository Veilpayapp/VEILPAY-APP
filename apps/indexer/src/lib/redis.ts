import Redis from "ioredis";
import { config } from "../config";

const redisUrl = config.redisUrl || "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("error", (err) => {
  console.error("[Redis Error]", err);
});

redis.on("connect", () => {
  console.warn("[Redis] Connected to caching layer");
});
