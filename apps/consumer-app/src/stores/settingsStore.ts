import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureStateStorage } from '../utils/secureStateStorage';

/**
 * Privacy level for outgoing payments.
 *
 * - `'standard'` — direct token transfer; no announcer, no pool. Always available.
 * - `'stealth'` — funds a one-time stealth address derived from the recipient's
 *   meta-address; followed by a `StealthAnnouncer.announce` call so the
 *   recipient can scan and discover the payment. Requires the privacy stack to
 *   be configured on Sepolia (`useNetworkPrivacySupport()` reports supported).
 * - `'max'` — deposit → ZK proof → relayer-broadcast withdraw via `VeilPool`.
 *   Requires the privacy stack to be configured on Sepolia.
 * - `'private'` — Stellar Private Payments (SPP) shielded transfer. Enabled on
 *   `stellar-testnet` when SPP is configured; mainnet fail-closed.
 *
 * @see ../hooks/useNetworkPrivacySupport for EVM gating
 * @see ../constants/privacyAssets for SPP home surface
 * @see ../screens/PrivacyLevelScreen for UI selection
 * @see Requirements 12.1, 12.2, 12.3
 */
export type PrivacyLevel = 'standard' | 'stealth' | 'max' | 'private';


export interface SettingsState {
  theme: 'dark' | 'light';
  biometricsEnabled: boolean;
  notificationsEnabled: boolean;
  analyticsEnabled: boolean;
  defaultPrivacyLevel: PrivacyLevel;
  pushToken: string | null;
  hasAppPassword: boolean;
  nativeCurrency: string;
  /**
   * When set, Home shows the privacy-pool surface for this catalog id
   * (e.g. `spp-xlm-testnet`) instead of public native balance.
   * `null` = public chain home (default).
   */
  selectedPrivacyAssetId: string | null;

  setTheme: (theme: 'dark' | 'light') => void;
  setBiometricsEnabled: (enabled: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setAnalyticsEnabled: (enabled: boolean) => void;
  setPrivacyLevel: (level: PrivacyLevel) => void;
  setPushToken: (token: string | null) => void;
  setHasAppPassword: (hasPassword: boolean) => void;
  setNativeCurrency: (currency: string) => void;
  setSelectedPrivacyAssetId: (id: string | null) => void;
}


export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      biometricsEnabled: false,
      notificationsEnabled: false,
      analyticsEnabled: false,
      defaultPrivacyLevel: 'standard',
      pushToken: null,
      hasAppPassword: false,
      nativeCurrency: 'USD',
      selectedPrivacyAssetId: null,

      setTheme: (theme) => set({ theme }),
      setBiometricsEnabled: (enabled) => set({ biometricsEnabled: enabled }),
      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
      setAnalyticsEnabled: (enabled) => set({ analyticsEnabled: enabled }),
      setPrivacyLevel: (level) => set({ defaultPrivacyLevel: level }),
      setPushToken: (token) => set({ pushToken: token }),
      setHasAppPassword: (hasPassword) => set({ hasAppPassword: hasPassword }),
      setNativeCurrency: (currency) => set({ nativeCurrency: currency }),
      setSelectedPrivacyAssetId: (id) => set({ selectedPrivacyAssetId: id }),
    }),
    {
      name: 'veilpay-settings-storage',
      storage: createJSONStorage(() => secureStateStorage),
      // Only persist the non-sensitive configuration settings
      partialize: (state) => ({
        theme: state.theme,
        biometricsEnabled: state.biometricsEnabled,
        notificationsEnabled: state.notificationsEnabled,
        analyticsEnabled: state.analyticsEnabled,
        defaultPrivacyLevel: state.defaultPrivacyLevel,
        hasAppPassword: state.hasAppPassword,
        nativeCurrency: state.nativeCurrency,
        selectedPrivacyAssetId: state.selectedPrivacyAssetId,
      }),
    }
  )
);

// Helper hooks
export const useThemeState = () => useSettingsStore((state) => state.theme);
export const usePrivacyLevel = () => useSettingsStore((state) => state.defaultPrivacyLevel);
export const useNativeCurrency = () => useSettingsStore((state) => state.nativeCurrency);
