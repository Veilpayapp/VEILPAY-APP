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
  // Number of trusted reverse-proxy hops in front of the app. Applies
  // `app.set('trust proxy', ...)` so req.ip resolves the real client IP behind
  // the LB/ALB - otherwise every IP-keyed rate-limit bucket collapses to the
  // load balancer's IP.
  // DEFAULTS TO 0 (no trusted proxy): we do NOT trust a client-supplied
  // `X-Forwarded-For` unless the deployment explicitly opts in. A hostile
  // client can otherwise spoof X-Forwarded-For to bypass every IP-keyed
  // rate limit (rpc, onramp, attestation-nonce, global). Proxy-hosted
  // deployments MUST set TRUST_PROXY_HOPS to the number of hops their LB /
  // ALB sits in front of the app (1 for a single LB, more if nested).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  REDIS_PASSWORD: z.string().default(''),
  JWT_SECRET: z.string().min(32),
  API_KEY_SALT: z.string().min(16),
  // H2 fix: WEBHOOK_SIGNING_SECRET is independently required — separate from
  // API_KEY_SALT. No committed dev-secret default: unlike JWT_SECRET/API_KEY_SALT
  // this previously fell back to a public constant whenever NODE_ENV wasn't
  // 'production', silently running signing on a known key. Now it must always
  // be supplied by the environment (tests inject a dummy; local dev via .env).
  WEBHOOK_SIGNING_SECRET: z.string().min(32),
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
  // ── Play Integrity (app attestation) — Hardening #2 ────────────────────
  // When enabled, the onramp (/url, /quotes) and RPC-proxy routes require a
  // Google Play Integrity attestation token minted with a backend-issued nonce,
  // verified server-side via Google's decodeIntegrityToken endpoint. This
  // closes the anonymous-internet hole on those three endpoints.
  PLAY_INTEGRITY_ENABLED: z.enum(['true', 'false']).default('false'),
  // Android package name allowed to call the attested endpoints.
  PLAY_INTEGRITY_PACKAGE_NAME: z.string().default(''),
  // SHA-256 of the app's Play signing certificate, upper-hex, colon-separated
  // (Play reports this as appIntegrity.appCertSha256). Guards against an
  // attacker sideloading their own build signed with a different key.
  PLAY_INTEGRITY_APP_CERT_SHA256: z.string().default(''),
  // Base64 of the Google service-account JSON key (the Cloud project linked to
  // the Play Console app) used to call Google's decodeIntegrityToken endpoint.
  PLAY_INTEGRITY_SERVICE_ACCOUNT_B64: z.string().default(''),
  // Floor device-integrity verdict required (defaults to Google's recommended
  // baseline; MEETS_STRONG_INTEGRITY is stricter, MEETS_VIRTUAL_INTEGRITY is
  // more permissive).
  PLAY_INTEGRITY_MIN_DEVICE_VERDICT: z
    .enum(['MEETS_STRONG_INTEGRITY', 'MEETS_DEVICE_INTEGRITY', 'MEETS_VIRTUAL_INTEGRITY'])
    .default('MEETS_DEVICE_INTEGRITY'),
  // Max age of an attestation (ms). Older tokens are rejected as possible replays.
  PLAY_INTEGRITY_MAX_AGE_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
});

const env = envSchema.parse(process.env);

if (env.NODE_ENV !== 'test') {
  // ── Committed dev defaults are rejected in ANY real environment ────────────
  // Previously these checks only ran when NODE_ENV === 'production', so a
  // deployment that booted without NODE_ENV (silently defaulted to
  // 'development') ran on publicly-committed signing secrets. The test suite
  // is exempt (it injects its own dummy values via tests/setup.ts).
  if (env.JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET must not use the development default');
  }
  if (env.API_KEY_SALT === DEV_API_KEY_SALT) {
    throw new Error('API_KEY_SALT must not use the development default');
  }
  if (env.WEBHOOK_SIGNING_SECRET === DEV_WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_SIGNING_SECRET must not use the development default');
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
}

if (env.NODE_ENV === 'production') {
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

  // ── Play Integrity (Hardening #2) ────────────────────────────────────────
  // When enabled in production it MUST be fully wired. Partial config is a
  // misconfig that would either silently open the attested endpoints or
  // brick them — fail fast instead.
  if (env.PLAY_INTEGRITY_ENABLED === 'true') {
    const missing: string[] = [];
    if (!env.PLAY_INTEGRITY_PACKAGE_NAME) missing.push('PLAY_INTEGRITY_PACKAGE_NAME');
    if (!env.PLAY_INTEGRITY_APP_CERT_SHA256) missing.push('PLAY_INTEGRITY_APP_CERT_SHA256');
    if (!env.PLAY_INTEGRITY_SERVICE_ACCOUNT_B64) missing.push('PLAY_INTEGRITY_SERVICE_ACCOUNT_B64');
    if (missing.length > 0) {
      throw new Error(
        `PLAY_INTEGRITY_ENABLED=true requires ${missing.join(', ')}. ` +
        'These come from Play Console (package, app cert fingerprint) and the ' +
        'linked Google Cloud project (service account). Refusing to boot.'
      );
    }
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
  trustProxyHops: env.TRUST_PROXY_HOPS,
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
  playIntegrity: {
    enabled: env.PLAY_INTEGRITY_ENABLED === 'true',
    packageName: env.PLAY_INTEGRITY_PACKAGE_NAME,
    appCertSha256: env.PLAY_INTEGRITY_APP_CERT_SHA256,
    serviceAccountB64: env.PLAY_INTEGRITY_SERVICE_ACCOUNT_B64,
    minDeviceVerdict: env.PLAY_INTEGRITY_MIN_DEVICE_VERDICT,
    maxAgeMs: env.PLAY_INTEGRITY_MAX_AGE_MS,
  },
  cors: {
    origin: parseCorsOrigins(env.CORS_ORIGINS),
    credentials: true,
  },
};
