import { logger } from '../logger';
import { resolveWebhookSigningSecret, __testing__ } from '../webhookSecret';

jest.mock('../../config', () => ({
  config: {
    webhookSigningSecret: 'global-test-secret',
  },
}));

const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

describe('lib/webhookSecret — resolveWebhookSigningSecret', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __testing__.resetGlobalFallbackWarning();
  });

  it('returns the per-merchant secret and never warns', () => {
    expect(resolveWebhookSigningSecret('whsec_merchant_private')).toBe(
      'whsec_merchant_private'
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the global env secret when the merchant has none', () => {
    expect(resolveWebhookSigningSecret(null)).toBe('global-test-secret');
    expect(resolveWebhookSigningSecret(undefined)).toBe('global-test-secret');
  });

  it('logs the deprecation warning exactly once per process on fallback', () => {
    resolveWebhookSigningSecret(null);
    resolveWebhookSigningSecret(null);
    resolveWebhookSigningSecret(undefined);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0])).toContain('DEPRECATED');
  });

  it('does not warn again after the once-per-process flag is consumed', () => {
    resolveWebhookSigningSecret(null); // consumes the warning
    expect(warnSpy).toHaveBeenCalledTimes(1);

    resolveWebhookSigningSecret(null); // flag already set — silent
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('still resolves the global secret after the warning flag is consumed', () => {
    resolveWebhookSigningSecret(null);
    resolveWebhookSigningSecret(null);
    expect(resolveWebhookSigningSecret(null)).toBe('global-test-secret');
  });

  it('a per-merchant secret after fallbacks does not re-warn', () => {
    resolveWebhookSigningSecret(null); // warns once
    expect(warnSpy).toHaveBeenCalledTimes(1);

    expect(resolveWebhookSigningSecret('whsec_late_rotated')).toBe(
      'whsec_late_rotated'
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

afterAll(() => {
  warnSpy.mockRestore();
});
