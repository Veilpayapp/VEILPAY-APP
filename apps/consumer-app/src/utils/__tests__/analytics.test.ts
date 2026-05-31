import { trackEvent, initAnalytics, setAnalyticsConsent, trackScreenView, identifyUser, resetAnalyticsUser } from '../analytics';

describe('analytics', () => {
  it('should not throw on initialization', async () => {
    setAnalyticsConsent(true);
    await initAnalytics();
    trackEvent('APP_LAUNCHED' as any);
    trackScreenView('Home');
    identifyUser('0x123', {});
    resetAnalyticsUser();
    expect(true).toBe(true);
  });
});
