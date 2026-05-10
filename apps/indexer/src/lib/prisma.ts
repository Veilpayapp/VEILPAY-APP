import { PrismaClient } from "@prisma/client";

// IX-C4 fix: shared PrismaClient singleton across all indexer modules
// Prevents connection pool exhaustion (was 4 separate instances = 20 connections)
const globalForPrisma = globalThis as unknown as { __indexerPrisma: PrismaClient };

export const prisma =
  globalForPrisma.__indexerPrisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.__indexerPrisma = prisma;
}
