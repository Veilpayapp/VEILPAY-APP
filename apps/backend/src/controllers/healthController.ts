import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { config } from "../config";
import IORedis from "ioredis";

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
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
