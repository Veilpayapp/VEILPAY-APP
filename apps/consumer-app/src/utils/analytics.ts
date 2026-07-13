/* istanbul ignore file */
/**
 * PRIV-001: analytics minimization.
 * - Wallet addresses are hashed (SHA-256 truncated) before identify/traits.
 * - Tx hashes / messages are redacted from event payloads.
 * - `deleteAnalyticsData` supports DSAR-style erasure (reset + opt-out).
 */
import * as Crypto from 'expo-crypto';
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

/** Fields that must never leave the device in raw form. */
const SENSITIVE_KEYS = new Set([
  'wallet_address',
  'address',
  'from_address',
  'to_address',
  'recipient',
  'tx_hash',
  'txHash',
  'hash',
  'message',
  'mnemonic',
  'private_key',
  'nullifier',
  'secret',
]);

function minimizePayload(payload?: AnalyticsPayload): AnalyticsPayload {
  if (!payload) return {};
  const out: AnalyticsPayload = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.has(k)) {
      // Drop raw secrets / PII-adjacent values entirely.
      continue;
    }
    if (typeof v === 'string' && /^0x[a-fA-F0-9]{40,}$/.test(v)) {
      // Hex addresses/hashes — drop rather than send raw.
      continue;
    }
    out[k] = v;
  }
  return out;
}

async function hashWalletId(userId: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    userId.trim().toLowerCase()
  );
  return `w_${digest.slice(0, 32)}`;
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

  const safe = minimizePayload(payload);
  void withMixpanel((client) => {
    client.track(eventName, safe);
  });

  if (__DEV__) {
    console.log('[analytics:event]', eventName, safe);
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

  void (async () => {
    const hashedId = await hashWalletId(userId);
    const safeTraits = minimizePayload(traits);
    await withMixpanel((client) => {
      client.identify?.(hashedId);
      client.getPeople?.().set({
        // PRIV-001: never store raw wallet address as a people property.
        wallet_id_hash: hashedId,
        ...safeTraits,
      });
    });

    if (__DEV__) {
      console.log('[analytics:user]', hashedId, safeTraits);
    }
  })();
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

/**
 * PRIV-001 / DSAR: erase local analytics identity and opt out.
 * Mixpanel server-side deletion still requires a support/process ticket
 * with the hashed `wallet_id_hash` — document that for operators.
 */
export function deleteAnalyticsData(): void {
  userAnalyticsConsent = false;
  if (mixpanel) {
    mixpanel.reset?.();
    mixpanel.optOutTracking?.();
  }
  if (__DEV__) {
    console.log('[analytics:dsar] local identity reset + opt-out');
  }
}
