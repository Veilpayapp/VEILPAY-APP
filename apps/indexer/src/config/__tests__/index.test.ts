/**
 * Config is evaluated at module load time from process.env.
 * Use require() + jest.resetModules() so each test re-parses with a fresh env
 * (dynamic import() needs --experimental-vm-modules under Jest/CJS).
 */
describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadConfig(): { config: { nodeEnv: string; databaseUrl: string; indexSolana: boolean; reconciliationDriftCheckIntervalMs: number } } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require('../index') as {
      config: { nodeEnv: string; databaseUrl: string; indexSolana: boolean; reconciliationDriftCheckIntervalMs: number };
    };
  }

  it('should use default values in development when the webhook secret is supplied', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    // IX-C5: WEBHOOK_SIGNING_SECRET is required — no committed default.
    process.env.WEBHOOK_SIGNING_SECRET = 'dev_only_webhook_signing_secret_0123456789';

    const { config } = loadConfig();
    expect(config.nodeEnv).toBe('development');
    expect(config.databaseUrl).toContain('postgresql://veilpay');
  });

  it('should throw when WEBHOOK_SIGNING_SECRET is missing in a non-test env', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.WEBHOOK_SIGNING_SECRET;

    // zod: required field with no default — boot must fail, not fall back
    // to a committed dev secret.
    expect(() => loadConfig()).toThrow();
  });

  it('should throw if using default DB URL in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    process.env.WEBHOOK_SIGNING_SECRET = 'my_super_secret_webhook_key_2026';
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/1';

    expect(() => loadConfig()).toThrow(
      'DATABASE_URL must not use the development default in production',
    );
  });

  it('should throw if using default REDIS URL in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    delete process.env.REDIS_URL;
    process.env.WEBHOOK_SIGNING_SECRET = 'my_super_secret_webhook_key_2026';
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/1';

    expect(() => loadConfig()).toThrow(
      'REDIS_URL must not use the localhost default in production',
    );
  });

  it('should throw if using default WEBHOOK_SIGNING_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    process.env.REDIS_URL = 'redis://prod:6379';
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/1';
    // The committed dev value itself (length >= 16, so zod passes; the
    // explicit dev-value rejection is what fires).
    process.env.WEBHOOK_SIGNING_SECRET = 'veilpay_dev_webhook_secret_2026';

    expect(() => loadConfig()).toThrow(
      'WEBHOOK_SIGNING_SECRET must not use the development default',
    );
  });

  it('should reject the committed dev webhook secret in ANY non-test env', () => {
    // Mirror of the backend fix: a deployment that booted without NODE_ENV
    // silently defaults to 'development' and must not run on the committed
    // secret either.
    process.env.NODE_ENV = 'development';
    process.env.WEBHOOK_SIGNING_SECRET = 'veilpay_dev_webhook_secret_2026';

    expect(() => loadConfig()).toThrow(
      'WEBHOOK_SIGNING_SECRET must not use the development default',
    );
  });

  it('should throw in production without SENTRY_DSN', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    process.env.REDIS_URL = 'redis://prod:6379';
    process.env.WEBHOOK_SIGNING_SECRET = 'my_super_secret_webhook_key_2026';
    delete process.env.SENTRY_DSN;

    expect(() => loadConfig()).toThrow(
      'SENTRY_DSN must be set in production so indexer failures are reported',
    );
  });

  it('should parse config successfully in production with valid envs', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    process.env.REDIS_URL = 'redis://prod:6379';
    process.env.WEBHOOK_SIGNING_SECRET = 'my_super_secret_webhook_key_2026';
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/1';
    process.env.INDEX_SOLANA = 'true';

    const { config } = loadConfig();
    expect(config.nodeEnv).toBe('production');
    expect(config.indexSolana).toBe(true);
  });

  // (b) drift-check interval flag — default OFF (0), parsed from a string env var
  it('drift check interval defaults to 0 (disabled) when unset', () => {
    process.env.NODE_ENV = 'development';
    process.env.WEBHOOK_SIGNING_SECRET = 'dev_only_webhook_signing_secret_0123456789';
    delete process.env.RECONCILIATION_DRIFT_CHECK_INTERVAL_MS;

    const { config } = loadConfig();
    expect(config.reconciliationDriftCheckIntervalMs).toBe(0);
  });

  it('drift check interval parses a string env var into a number', () => {
    process.env.NODE_ENV = 'development';
    process.env.WEBHOOK_SIGNING_SECRET = 'dev_only_webhook_signing_secret_0123456789';
    process.env.RECONCILIATION_DRIFT_CHECK_INTERVAL_MS = '300000';

    const { config } = loadConfig();
    expect(config.reconciliationDriftCheckIntervalMs).toBe(300000);
  });

  it('rejects a negative drift check interval', () => {
    process.env.NODE_ENV = 'development';
    process.env.WEBHOOK_SIGNING_SECRET = 'dev_only_webhook_signing_secret_0123456789';
    process.env.RECONCILIATION_DRIFT_CHECK_INTERVAL_MS = '-5';

    expect(() => loadConfig()).toThrow();
  });
});
