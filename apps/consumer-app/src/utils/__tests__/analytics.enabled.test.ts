/**
 * analytics.ts enabled-runtime coverage (round-5: the file's
 * `istanbul ignore file` directive was removed). The module reads env vars and
 * caches a Mixpanel client at module scope, so each test reloads it fresh via
 * jest.resetModules + controlled env.
 */

import { waitFor } from '@testing-library/react-native';

let mockInitFails = false;
const mockMixpanelInstances: any[] = [];

jest.mock('mixpanel-react-native', () => ({
  __esModule: true,
  Mixpanel: jest.fn().mockImplementation(() => {
    const people = { set: jest.fn() };
    const inst = {
      init: mockInitFails
        ? jest.fn().mockRejectedValue(new Error('mixpanel init failed'))
        : jest.fn().mockResolvedValue(undefined),
      track: jest.fn(),
      identify: jest.fn(),
      reset: jest.fn(),
      optInTracking: jest.fn(),
      optOutTracking: jest.fn(),
      getPeople: jest.fn(() => people),
      __people: people,
    };
    mockMixpanelInstances.push(inst);
    return inst;
  }),
}));

const loadAnalytics = (enabled = 'true', token = 'tok-123') => {
  jest.resetModules();
  process.env.EXPO_PUBLIC_ENABLE_ANALYTICS = enabled;
  process.env.EXPO_PUBLIC_MIXPANEL_TOKEN = token;
  return require('../analytics') as typeof import('../analytics');
};

const lastInstance = () => {
  const inst = mockMixpanelInstances[mockMixpanelInstances.length - 1];
  if (!inst) throw new Error('Mixpanel was never constructed');
  return inst;
};

describe('analytics — enabled runtime', () => {
  beforeEach(() => {
    mockMixpanelInstances.length = 0;
    mockInitFails = false;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_ENABLE_ANALYTICS;
    delete process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
    (console.log as jest.Mock).mockRestore();
    (console.warn as jest.Mock).mockRestore();
  });

  it('initializes Mixpanel with the token and opts in', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);

    await expect(analytics.initAnalytics()).resolves.toBe(true);
    const inst = lastInstance();
    expect(inst.init).toHaveBeenCalled();
    expect(inst.optInTracking).toHaveBeenCalled();

    // Already initialized + runtime enabled → true without re-init.
    await expect(analytics.initAnalytics()).resolves.toBe(true);
    expect(inst.init).toHaveBeenCalledTimes(1);
  });

  it('reuses the in-flight init promise', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    const [a, b] = await Promise.all([analytics.initAnalytics(), analytics.initAnalytics()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(lastInstance().init).toHaveBeenCalledTimes(1);
  });

  it('returns false when Mixpanel init fails', async () => {
    mockInitFails = true;
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await expect(analytics.initAnalytics()).resolves.toBe(false);
  });

  it('warns once about a missing token and stays disabled', async () => {
    const analytics = loadAnalytics('true', '');
    analytics.setAnalyticsConsent(true);
    await expect(analytics.initAnalytics()).resolves.toBe(false);
    await expect(analytics.initAnalytics()).resolves.toBe(false);
    const warns = (console.warn as jest.Mock).mock.calls.filter((c) =>
      String(c[0]).includes('MIXPANEL_TOKEN')
    );
    expect(warns.length).toBe(1);
    expect(mockMixpanelInstances.length).toBe(0);
  });

  it('drops sensitive keys and raw hex addresses from tracked payloads', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await analytics.initAnalytics();

    analytics.trackEvent('SEND_PAYMENT_VIEWED' as any, {
      wallet_address: '0xABCDEF0123456789abcdef0123456789abcdef01',
      tx_hash: `0x${'f'.repeat(64)}`,
      recipient: 'GABCDEF',
      chain_key: 'ethereum',
      note: 'keep me',
    });

    const inst = lastInstance();
    jest.runOnlyPendingTimers(); await Promise.resolve();
    expect(inst.track).toHaveBeenCalledWith('SEND_PAYMENT_VIEWED', {
      chain_key: 'ethereum',
      note: 'keep me',
    });
  });

  it('tracks payload-less events with an empty payload', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await analytics.initAnalytics();

    analytics.trackEvent('APP_LAUNCHED' as any);
    jest.runOnlyPendingTimers(); await Promise.resolve();
    expect(lastInstance().track).toHaveBeenCalledWith('APP_LAUNCHED', {});
  });

  it('does not track without consent', async () => {
    const analytics = loadAnalytics();
    await analytics.initAnalytics();
    analytics.trackEvent('APP_LAUNCHED' as any, { chain_key: 'ethereum' });
    jest.runOnlyPendingTimers(); await Promise.resolve();
    expect(mockMixpanelInstances.length).toBe(0);
  });

  it('trackScreenView wraps trackEvent with the screen name', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await analytics.initAnalytics();

    analytics.trackScreenView('Home', { from: 'test' });
    jest.runOnlyPendingTimers(); await Promise.resolve();
    expect(lastInstance().track).toHaveBeenCalledWith(
      'screen_view',
      expect.objectContaining({ screen_name: 'Home', from: 'test' })
    );
  });

  it('trackTypedEvent delegates to trackEvent', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await analytics.initAnalytics();

    analytics.trackTypedEvent('APP_LAUNCHED' as any);
    jest.runOnlyPendingTimers(); await Promise.resolve();
    expect(lastInstance().track).toHaveBeenCalledWith('APP_LAUNCHED', {});
  });

  it('identifies users by hashed wallet id with minimized traits', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await analytics.initAnalytics();

    analytics.identifyUser('  0xABCDEF0123456789abcdef0123456789abcdef01  ', {
      plan: 'pro',
      private_key: 'never-send-this',
    });

    const inst = lastInstance();
    await waitFor(() =>
      expect(inst.identify).toHaveBeenCalledWith(expect.stringMatching(/^w_[0-9a-f]{32}$/))
    );
    const peopleSet = inst.__people.set;
    expect(peopleSet).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', wallet_id_hash: expect.stringMatching(/^w_/) })
    );
    expect(peopleSet.mock.calls[0][0].private_key).toBeUndefined();
  });

  it('skips identify for empty user ids', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await analytics.initAnalytics();

    analytics.identifyUser('');
    jest.runOnlyPendingTimers(); await Promise.resolve();
    expect(lastInstance().identify).not.toHaveBeenCalled();
  });

  it('opts in/out on consent change once initialized', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await analytics.initAnalytics();
    const inst = lastInstance();
    inst.optInTracking.mockClear();

    analytics.setAnalyticsConsent(false);
    expect(inst.reset).toHaveBeenCalled();
    expect(inst.optOutTracking).toHaveBeenCalled();

    analytics.setAnalyticsConsent(true);
    expect(inst.optInTracking).toHaveBeenCalled();
  });

  it('resetAnalyticsUser resets, and opts out when consent is withdrawn', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await analytics.initAnalytics();
    const inst = lastInstance();

    analytics.resetAnalyticsUser();
    expect(inst.reset).toHaveBeenCalledTimes(1);
    expect(inst.optOutTracking).not.toHaveBeenCalled();

    analytics.setAnalyticsConsent(false);
    inst.reset.mockClear();
    inst.optOutTracking.mockClear();

    analytics.resetAnalyticsUser();
    expect(inst.reset).toHaveBeenCalledTimes(1);
    expect(inst.optOutTracking).toHaveBeenCalledTimes(1);
  });

  it('deleteAnalyticsData resets locally and forces opt-out on later init', async () => {
    const analytics = loadAnalytics();
    analytics.setAnalyticsConsent(true);
    await analytics.initAnalytics();
    const inst = lastInstance();
    inst.reset.mockClear();
    inst.optOutTracking.mockClear();

    analytics.deleteAnalyticsData();
    expect(inst.reset).toHaveBeenCalled();
    expect(inst.optOutTracking).toHaveBeenCalled();

    // Consent withdrawn: initAnalytics now opts out and reports disabled.
    await expect(analytics.initAnalytics()).resolves.toBe(false);
    expect(inst.optOutTracking).toHaveBeenCalledTimes(2);
  });
});

describe('analytics — disabled runtime', () => {
  beforeEach(() => {
    mockMixpanelInstances.length = 0;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_ENABLE_ANALYTICS;
    delete process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
    (console.log as jest.Mock).mockRestore();
    (console.warn as jest.Mock).mockRestore();
  });

  it('no-ops every surface when the feature flag is off', async () => {
    const analytics = loadAnalytics('false', '');
    analytics.setAnalyticsConsent(true);
    await expect(analytics.initAnalytics()).resolves.toBe(false);

    analytics.trackEvent('APP_LAUNCHED' as any, { chain_key: 'ethereum' });
    analytics.trackScreenView('Home');
    analytics.identifyUser('0xabc', {});
    analytics.resetAnalyticsUser();
    analytics.deleteAnalyticsData();

    expect(mockMixpanelInstances.length).toBe(0);
  });
});
