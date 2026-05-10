import { Router } from "express";
import { prisma } from "../lib/prisma";
import { config } from "../config";

const router = Router();

router.get("/", async (_req, res) => {
  const dbOk = await checkDatabase();
  const redisOk = await checkRedis();

  const allOk = dbOk && redisOk;

  res.json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    services: {
      database: dbOk ? "connected" : "disconnected",
      // BE-H7 fix: actually check Redis instead of hardcoding "not_checked"
      redis: redisOk ? "connected" : "disconnected",
    },
  });
});

router.get("/ready", async (_req, res) => {
  const dbOk = await checkDatabase();

  if (dbOk) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ ready: false, reason: "Database not available" });
  }
});

router.get("/live", (_req, res) => {
  res.status(200).json({ alive: true });
});

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// BE-H7 fix: actual Redis health check
async function checkRedis(): Promise<boolean> {
  try {
    // Use ioredis (already a project dependency) instead of the `redis` package
    const IORedis = (await import("ioredis")).default;
    const url = config.redisPassword
      ? `redis://:${config.redisPassword}@${config.redisUrl.replace("redis://", "")}`
      : config.redisUrl;
    const client = new IORedis(url);
    const pong = await client.ping();
    await client.quit();
    return pong === "PONG";
  } catch {
    return false;
  }
}

export { router as healthRoutes };
