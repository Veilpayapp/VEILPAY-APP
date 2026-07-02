jest.mock('expo-constants', () => ({
  expoConfig: { extra: {} },
}));

import { validateEnvironment, getEnvValidationSummary } from '../envValidation';

describe('envValidation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails when EXPO_PUBLIC_BACKEND_BASE_URL is missing', () => {
    delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

    const result = validateEnvironment();

    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.key === 'EXPO_PUBLIC_BACKEND_BASE_URL')).toBe(true);
  });

  it('passes when EXPO_PUBLIC_BACKEND_BASE_URL is valid', () => {
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.veilpay.app';

    const result = validateEnvironment();

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('warns when important but non-critical vars are missing', () => {
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.veilpay.app';
    delete process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;

    const result = validateEnvironment();

    expect(result.isValid).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid URL format for EXPO_PUBLIC_BACKEND_BASE_URL', () => {
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'not-a-url';

    const result = validateEnvironment();

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.key === 'EXPO_PUBLIC_BACKEND_BASE_URL')).toBe(true);
  });

  it('generates user-friendly summary', () => {
    delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

    const result = validateEnvironment();
    const summary = getEnvValidationSummary(result);

    expect(summary).toContain('Configuration Issues');
    expect(summary).toContain('Backend server URL');
  });


});
