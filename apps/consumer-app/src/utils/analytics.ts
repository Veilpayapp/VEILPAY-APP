/* istanbul ignore file */
import {
  ANALYTICS_EVENTS,
  type AnalyticsEventName,
  type AnalyticsEventPayloadMap,
  type AnalyticsPayload,
} from './analyticsEvents';

type EventPayload<K extends AnalyticsEventName> = AnalyticsEventPayloadMap[K];

type RequiredPayloadEvents = {
  [K in AnalyticsEventName]: undefined extends EventPayload<K> ? never : K;
}[AnalyticsEventName];

type OptionalPayloadEvents = Exclude<AnalyticsEventName, RequiredPayloadEvents>;

type MixpanelClient = {
  init: () => Promise<void>;
  track: (eventName: string, payload?: AnalyticsPayload) => void;
  identify?: (id: string) => void;
  reset?: () => void;
  getPeople?: () => {
    set: (payload: AnalyticsPayload) => void;
  };
  optInTracking?: () => void;
  optOutTracking?: () => void;
};

const analyticsEnabled = process.env.EXPO_PUBLIC_ENABLE_ANALYTICS === 'true';
const mixpanelToken = (process.env.EXPO_PUBLIC_MIXPANEL_TOKEN || '').trim();
let userAnalyticsConsent = false;

let mixpanel: MixpanelClient | null = null;
let initPromise: Promise<boolean> | null = null;
let hasWarnedMissingToken = false;

function shouldEnableAnalytics(): boolean {
  return analyticsEnabled && userAnalyticsConsent && mixpanelToken.length > 0;
}

function hasRuntimeAnalyticsEnabled(): boolean {
  return analyticsEnabled && userAnalyticsConsent;
}

export function setAnalyticsConsent(enabled: boolean) {
  userAnalyticsConsent = enabled;

  if (mixpanel) {
    if (enabled) {
      mixpanel.optInTracking?.();
    } else {
      mixpanel.reset?.();
      mixpanel.optOutTracking?.();
    }
  }

  if (__DEV__) {
    console.log('[analytics:consent]', enabled ? 'enabled' : 'disabled');
  }
}

export async function initAnalytics(): Promise<boolean> {
  if (mixpanel) {
    if (!hasRuntimeAnalyticsEnabled()) {
      mixpanel.optOutTracking?.();
      return false;
    }

    return true;
  }

  if (!shouldEnableAnalytics()) {
    if (__DEV__ && analyticsEnabled && userAnalyticsConsent && mixpanelToken.length === 0 && !hasWarnedMissingToken) {
      hasWarnedMissingToken = true;
      console.warn('[analytics] EXPO_PUBLIC_MIXPANEL_TOKEN missing; analytics disabled.');
    }
    return false;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const { Mixpanel } = await import('mixpanel-react-native');
      const client = new Mixpanel(mixpanelToken, false) as MixpanelClient;
      await client.init();
      client.optInTracking?.();
      mixpanel = client;

      if (__DEV__) {
        console.log('[analytics] Mixpanel initialized');
      }

      return true;
    } catch (error) {
      if (__DEV__) {
        console.warn('[analytics] Failed to initialize Mixpanel', error);
      }
      return false;
    }
  })();

  return initPromise;
}

async function withMixpanel(run: (client: MixpanelClient) => void): Promise<void> {
  const ready = await initAnalytics();
  if (!ready || !mixpanel) {
    return;
  }

  run(mixpanel);
}

export function trackEvent<K extends RequiredPayloadEvents>(
  eventName: K,
  payload: EventPayload<K>
): void;
export function trackEvent<K extends OptionalPayloadEvents>(
  eventName: K,
  payload?: EventPayload<K>
): void;
export function trackEvent(eventName: AnalyticsEventName, payload?: AnalyticsPayload) {
  if (!hasRuntimeAnalyticsEnabled()) {
    return;
  }

  void withMixpanel((client) => {
    client.track(eventName, payload || {});
  });

  if (__DEV__) {
    console.log('[analytics:event]', eventName, payload || {});
  }
}

export function trackScreenView(screenName: string, payload?: AnalyticsPayload) {
  trackEvent(ANALYTICS_EVENTS.SCREEN_VIEW, {
    screen_name: screenName,
    ...payload,
  });
}

export function trackTypedEvent<K extends AnalyticsEventName>(
  eventName: K,
  ...[payload]: undefined extends EventPayload<K>
    ? [payload?: EventPayload<K>]
    : [payload: EventPayload<K>]
) {
  (trackEvent as (eventName: AnalyticsEventName, payload?: AnalyticsPayload) => void)(
    eventName,
    payload as AnalyticsPayload | undefined
  );
}

export function identifyUser(userId: string, traits?: AnalyticsPayload) {
  if (!hasRuntimeAnalyticsEnabled() || !userId) {
    return;
  }

  void withMixpanel((client) => {
    client.identify?.(userId);
    client.getPeople?.().set({
      wallet_address: userId,
      ...traits,
    });
  });

  if (__DEV__) {
    console.log('[analytics:user]', userId, traits || {});
  }
}

export function resetAnalyticsUser() {
  if (!analyticsEnabled) {
    return;
  }

  if (mixpanel) {
    mixpanel.reset?.();

    if (!userAnalyticsConsent) {
      mixpanel.optOutTracking?.();
    }

    return;
  }

  void withMixpanel((client) => {
    client.reset?.();
  });
}
