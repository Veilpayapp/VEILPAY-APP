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

  function loadConfig(): { config: { nodeEnv: string; databaseUrl: string; indexSolana: boolean } } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require('../index') as {
      config: { nodeEnv: string; databaseUrl: string; indexSolana: boolean };
    };
  }

  it('should use default values in development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.WEBHOOK_SIGNING_SECRET;

    const { config } = loadConfig();
    expect(config.nodeEnv).toBe('development');
    expect(config.databaseUrl).toContain('postgresql://veilpay');
  });

  it('should throw if using default DB URL in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;

    expect(() => loadConfig()).toThrow(
      'DATABASE_URL must not use the development default in production',
    );
  });

  it('should throw if using default REDIS URL in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    delete process.env.REDIS_URL;

    expect(() => loadConfig()).toThrow(
      'REDIS_URL must not use the localhost default in production',
    );
  });

  it('should throw if using default WEBHOOK_SIGNING_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    process.env.REDIS_URL = 'redis://prod:6379';
    delete process.env.WEBHOOK_SIGNING_SECRET;

    expect(() => loadConfig()).toThrow(
      'WEBHOOK_SIGNING_SECRET must not use the development default in production',
    );
  });

  it('should parse config successfully in production with valid envs', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    process.env.REDIS_URL = 'redis://prod:6379';
    process.env.WEBHOOK_SIGNING_SECRET = 'my_super_secret_webhook_key_2026';
    process.env.INDEX_SOLANA = 'true';

    const { config } = loadConfig();
    expect(config.nodeEnv).toBe('production');
    expect(config.indexSolana).toBe(true);
  });
});
