import { z } from "zod";

const DEV_DATABASE_URL = "postgresql://veilpay:veilpay_dev_password@localhost:5432/veilpay";
// IX-C5: kept ONLY to reject the committed dev value at boot. It is no
// longer a schema default — WEBHOOK_SIGNING_SECRET must come from the env.
const DEV_WEBHOOK_SECRET = "veilpay_dev_webhook_secret_2026";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default(DEV_DATABASE_URL),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  // IX-C5: required with NO default. A committed dev-secret default meant any
  // deployment that booted without the env var silently signed webhooks with
  // a publicly-known key. Tests inject a dummy via src/__tests__/setup.ts.
  WEBHOOK_SIGNING_SECRET: z.string().min(16),
  INDEX_SOLANA: z.string().optional(),
  // IX-C4: Sentry DSN — empty disables Sentry outside production; required
  // in production (fail-closed, mirrors the backend's prod config block).
  SENTRY_DSN: z.string().default(""),
});

const env = envSchema.parse(process.env);

if (env.NODE_ENV !== "test") {
  // ── Committed dev values are rejected in ANY real environment ───────────
  // Mirrors apps/backend/src/config/index.ts: the check must not be gated on
  // NODE_ENV === 'production', because a deployment that booted without
  // NODE_ENV silently defaults to 'development' and would otherwise run on
  // the publicly-committed secret.
  if (env.WEBHOOK_SIGNING_SECRET === DEV_WEBHOOK_SECRET) {
    throw new Error("WEBHOOK_SIGNING_SECRET must not use the development default");
  }
}

if (env.NODE_ENV === "production") {
  if (env.DATABASE_URL === DEV_DATABASE_URL) {
    throw new Error("DATABASE_URL must not use the development default in production");
  }
  if (env.REDIS_URL === "redis://localhost:6379") {
    throw new Error("REDIS_URL must not use the localhost default in production");
  }
  // IX-C4: fail-closed — an indexer silently running without error reporting
  // is exactly how the reconnect-exhaustion zombie went unnoticed.
  if (!env.SENTRY_DSN) {
    throw new Error("SENTRY_DSN must be set in production so indexer failures are reported");
  }
}

export const config = {
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET,
  sentryDsn: env.SENTRY_DSN,
  indexSolana: env.INDEX_SOLANA === "true",
};
