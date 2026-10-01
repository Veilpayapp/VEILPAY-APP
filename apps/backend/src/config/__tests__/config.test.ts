/**
 * D6: SENTRY_DSN is required in production (empty → boot fails closed) and
 * stays optional in development/test.
 */

describe('config SENTRY_DSN (D6)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_SENTRY_DSN = process.env.SENTRY_DSN;
  const ORIGINAL_CORS = process.env.CORS_ORIGINS;
  const ORIGINAL_ALCHEMY = process.env.ALCHEMY_API_KEY;

  // The production block also enforces CORS/RPC keys — set those so the
  // SENTRY_DSN check is what fires (or passes) in these tests.
  const PRODUCTION_ENV = {
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.veilpay.test',
    ALCHEMY_API_KEY: 'prod-alchemy-key',
  };

  function loadConfig(env: Record<string, string | undefined>): { config?: unknown; error?: Error } {
    const saved: Record<string, string | undefined> = {};
    const keys = ['NODE_ENV', 'SENTRY_DSN', 'CORS_ORIGINS', 'ALCHEMY_API_KEY'];
    for (const key of keys) {
      saved[key] = process.env[key];
      if (env[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = env[key] as string;
      }
    }
    try {
      // Fresh module registry: config parses process.env at import time.
      jest.resetModules();
      const configModule = require('../index');
      return { config: configModule.config };
    } catch (error) {
      return { error: error as Error };
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key] as string;
        }
      }
    }
  }

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_SENTRY_DSN === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = ORIGINAL_SENTRY_DSN;
    if (ORIGINAL_CORS === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = ORIGINAL_CORS;
    if (ORIGINAL_ALCHEMY === undefined) delete process.env.ALCHEMY_API_KEY;
    else process.env.ALCHEMY_API_KEY = ORIGINAL_ALCHEMY;
  });

  it('refuses to boot in production when SENTRY_DSN is empty', () => {
    const { error } = loadConfig({ ...PRODUCTION_ENV, SENTRY_DSN: '' });

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/SENTRY_DSN must be set in production/);
  });

  it('refuses to boot in production when SENTRY_DSN is only whitespace', () => {
    const { error } = loadConfig({ ...PRODUCTION_ENV, SENTRY_DSN: '   ' });

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/SENTRY_DSN must be set in production/);
  });

  it('boots in production when SENTRY_DSN is set', () => {
    const dsn = 'https://public@sentry.veilpay.test/1';
    const { config, error } = loadConfig({ ...PRODUCTION_ENV, SENTRY_DSN: dsn });

    expect(error).toBeUndefined();
    expect((config as { sentryDsn: string }).sentryDsn).toBe(dsn);
  });

  it('stays optional outside production', () => {
    const { config, error } = loadConfig({ NODE_ENV: 'development' });

    expect(error).toBeUndefined();
    expect((config as { sentryDsn: string }).sentryDsn).toBe('');
  });
});
