import { z } from 'zod';

const DEV_JWT_SECRET = 'veilpay_dev_jwt_secret_key_2024_production_use_random_values';
const DEV_API_KEY_SALT = 'veilpay_dev_salt_2026_secure_random';
const DEV_WEBHOOK_SECRET = 'veilpay_dev_webhook_secret_2026';

// Placeholder patterns that indicate secrets have not been configured
const PLACEHOLDER_PATTERNS = [
  'replace-with',
  'your-',
  'change-me',
  'todo',
  'placeholder',
  'example',
];

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p));
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3001'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().default(''),
  JWT_SECRET: z.string().min(32),
  API_KEY_SALT: z.string().min(16),
  // H2 fix: WEBHOOK_SIGNING_SECRET is independently required — separate from API_KEY_SALT.
  WEBHOOK_SIGNING_SECRET: z.string().min(32).default(DEV_WEBHOOK_SECRET),
  DEFAULT_MERCHANT_TIER: z.enum(['basic', 'pro', 'enterprise']).default('basic'),
  CORS_ORIGINS: z.string().default('*'),
  // RPC provider keys (required in production)
  ALCHEMY_API_KEY: z.string().default(''),
  INFURA_API_KEY: z.string().default(''),
  GOLDRUSH_API_KEY: z.string().default(''),
  // SEC-001: hard cap on upstream RPC calls per UTC day before the proxy fails
  // closed. Bounds provider-credit spend from abuse of the unauthenticated
  // proxy. Consumed in utils/rpcBudget.ts (read there via process.env so the
  // breaker has no import cycle with config).
  RPC_DAILY_BUDGET: z.coerce.number().int().positive().default(200_000),
  SENTRY_DSN: z.string().default(''),
  RELAYER_PRIVATE_KEY: z.string().optional(),
  // EVM receipt confirmation floor for pay/confirm (0 = accept in the same block).
  // Production default 1 reduces reorg/false-confirm risk; set higher for L1 if needed.
  PAYMENT_MIN_CONFIRMATIONS: z.coerce.number().int().min(0).max(64).default(1),
});

const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production') {
  // ── Hard-coded dev defaults ──────────────────────────────────────────────
  if (env.JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET must not use the development default in production');
  }
  if (env.API_KEY_SALT === DEV_API_KEY_SALT) {
    throw new Error('API_KEY_SALT must not use the development default in production');
  }
  if (env.WEBHOOK_SIGNING_SECRET === DEV_WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_SIGNING_SECRET must not use the development default in production');
  }

  // ── Placeholder values ────────────────────────────────────────────────────
  if (isPlaceholder(env.JWT_SECRET)) {
    throw new Error('JWT_SECRET contains a placeholder value. Use Doppler to inject real secrets.');
  }
  if (isPlaceholder(env.API_KEY_SALT)) {
    throw new Error('API_KEY_SALT contains a placeholder value. Use Doppler to inject real secrets.');
  }
  if (isPlaceholder(env.WEBHOOK_SIGNING_SECRET)) {
    throw new Error('WEBHOOK_SIGNING_SECRET contains a placeholder value. Use Doppler to inject real secrets.');
  }

  // ── CORS wildcard ─────────────────────────────────────────────────────────
  // A wildcard CORS origin is unsafe for a production API that proxies paid
  // RPC providers — any website could drive browser requests through the
  // backend and burn provider credits. Fail fast rather than warn.
  //
  // NOTE: the schema default for CORS_ORIGINS is '*', so this also fires when
  // the value is simply unset in production. Set an explicit origin list in
  // Doppler BEFORE deploying, or the backend will refuse to boot (fail-closed).
  const corsOrigins = env.CORS_ORIGINS.trim();
  if (corsOrigins === '*' || corsOrigins === '') {
    throw new Error(
      'CORS_ORIGINS is unset or set to "*", which is insecure for production. ' +
      'Set CORS_ORIGINS to your explicit frontend origin(s) via Doppler before deploying.'
    );
  }

  // ── RPC provider keys ─────────────────────────────────────────────────────
  if (!env.ALCHEMY_API_KEY && !env.INFURA_API_KEY) {
    throw new Error(
      'At least one of ALCHEMY_API_KEY or INFURA_API_KEY must be set in production. ' +
      'Free keys at https://www.alchemy.com and https://infura.io'
    );
  }
}

function parseCorsOrigins(value: string): string | string[] {
  const trimmed = value.trim();

  if (trimmed === '*') {
    return '*';
  }

  const origins = trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must define at least one origin');
  }

  return origins;
}

export const config = {
  nodeEnv: env.NODE_ENV,
  port: parseInt(env.PORT, 10),
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  redisPassword: env.REDIS_PASSWORD,
  jwtSecret: env.JWT_SECRET,
  apiKeySalt: env.API_KEY_SALT,
  webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET,
  defaultMerchantTier: env.DEFAULT_MERCHANT_TIER,
  rpc: {
    alchemyApiKey: env.ALCHEMY_API_KEY,
    infuraApiKey: env.INFURA_API_KEY,
    goldrushApiKey: env.GOLDRUSH_API_KEY,
  },
  paymentMinConfirmations: env.PAYMENT_MIN_CONFIRMATIONS,
  sentryDsn: env.SENTRY_DSN,
  relayerPrivateKey: env.RELAYER_PRIVATE_KEY,
  cors: {
    origin: parseCorsOrigins(env.CORS_ORIGINS),
    credentials: true,
  },
};
