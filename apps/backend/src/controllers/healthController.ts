import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getRedisClient } from "../lib/redis";

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// PERF-001: reuse the shared, lazily-connected Redis singleton instead of
// opening (and, on the error path, leaking) a fresh IORedis connection on
// every health probe. The singleton connects on first ping and is reused.
async function checkRedis(): Promise<boolean> {
  try {
    const client = getRedisClient();
    if (!client) return false;
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

export const getHealth = async (_req: Request, res: Response): Promise<void> => {
  const dbOk = await checkDatabase();
  const redisOk = await checkRedis();

  const allOk = dbOk && redisOk;

  res.json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    services: {
      database: dbOk ? "connected" : "disconnected",
      redis: redisOk ? "connected" : "disconnected",
    },
  });
};

export const getReady = async (_req: Request, res: Response): Promise<void> => {
  const dbOk = await checkDatabase();

  if (dbOk) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ ready: false, reason: "Database not available" });
  }
};

export const getLive = (_req: Request, res: Response): void => {
  res.status(200).json({ alive: true });
};
