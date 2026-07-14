describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should use default values in development', async () => {
    process.env.NODE_ENV = 'development';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { config } = await import('../index');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(config.nodeEnv).toBe('development');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(config.databaseUrl).toContain('postgresql://veilpay');
  });

  it('should throw if using default DB URL in production', async () => {
    process.env.NODE_ENV = 'production';
    // default database url
    await expect(import('../index')).rejects.toThrow('DATABASE_URL must not use the development default in production');
  });

  it('should throw if using default REDIS URL in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    // default redis url
    await expect(import('../index')).rejects.toThrow('REDIS_URL must not use the localhost default in production');
  });

  it('should throw if using default WEBHOOK_SIGNING_SECRET in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    process.env.REDIS_URL = 'redis://prod:6379';
    // default webhook secret
    await expect(import('../index')).rejects.toThrow('WEBHOOK_SIGNING_SECRET must not use the development default in production');
  });

  it('should parse config successfully in production with valid envs', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://veilpay:prod_pass@prod:5432/db';
    process.env.REDIS_URL = 'redis://prod:6379';
    process.env.WEBHOOK_SIGNING_SECRET = 'my_super_secret_webhook_key_2026';
    process.env.INDEX_SOLANA = 'true';

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { config } = await import('../index');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(config.nodeEnv).toBe('production');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(config.indexSolana).toBe(true);
  });
});
