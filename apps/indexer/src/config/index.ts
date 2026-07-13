import { z } from "zod";

const DEV_DATABASE_URL = "postgresql://veilpay:veilpay_dev_password@localhost:5432/veilpay";
const DEV_WEBHOOK_SECRET = "veilpay_dev_webhook_secret_2026";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default(DEV_DATABASE_URL),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  WEBHOOK_SIGNING_SECRET: z.string().min(16).default(DEV_WEBHOOK_SECRET),
  INDEX_SOLANA: z.string().optional(),
});

const env = envSchema.parse(process.env);

if (env.NODE_ENV === "production") {
  if (env.DATABASE_URL === DEV_DATABASE_URL) {
    throw new Error("DATABASE_URL must not use the development default in production");
  }
  if (env.REDIS_URL === "redis://localhost:6379") {
    throw new Error("REDIS_URL must not use the localhost default in production");
  }
  if (env.WEBHOOK_SIGNING_SECRET === DEV_WEBHOOK_SECRET) {
    throw new Error("WEBHOOK_SIGNING_SECRET must not use the development default in production");
  }
}

export const config = {
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET,
  indexSolana: env.INDEX_SOLANA === "true",
};
