/**
 * PRIV-002: local DSAR / account-wipe.
 *
 * Erases device-local account data so a user can exercise a right-to-erasure
 * request against *this install*. It does NOT contact Mixpanel/Sentry servers —
 * operators must still process cloud DSAR tickets (see docs/consumer-app/dsar.md).
 *
 * Order matters: secrets first, then session state, then telemetry identity.
 * Failures on secret clear are fatal (we refuse a partial wipe that leaves a
 * mnemonic on disk while the UI thinks the wallet is gone).
 *
 * PRIV-203/PRIV-211 (wipe completeness): every device-local namespace must be
 * deleted, including private commitment records, SPP notes/accounts, onramp
 * status tokens, the notifications seen-set, the stealth scanner cursor, the
 * app password, and the AsyncStorage caches.
 */

import { clearStoredMnemonic } from './transactions';
import { deleteAnalyticsData } from './analytics';
import { clearAllNotificationSeen } from './notificationSeen';
import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore, clearAllOnrampTokens } from '../stores/transactionStore';
import { useAddressBookStore } from '../stores/addressBookStore';
import { clearAllCommitmentRecords } from '../stores/commitmentStore';
import { clearAllSppNotes } from '../stores/sppNoteStore';
import { clearAllSppAccounts } from '../stores/sppAccountStore';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AccountWipeResult {
  ok: true;
  steps: string[];
}

export interface AccountWipeFailure {
  ok: false;
  failedStep: string;
  error: unknown;
  completedSteps: string[];
}

export type AccountWipeOutcome = AccountWipeResult | AccountWipeFailure;

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * Fixed SecureStore keys that do not have their own namespaced store but must
 * still be removed. Keep these in sync with the writers:
 *   - 'veilpay_app_password'                    — legacy: SetPasswordScreen used
 *                                                 to store the plaintext password;
 *                                                 the key STAYS in the wipe even
 *                                                 with no writer left, because
 *                                                 old installs still carry the
 *                                                 plaintext value on disk.
 *   - 'veilpay.stealth.lastScannedBlock'        — hooks/useStealthScanner.ts
 *   - 'veilpay-wallet-storage'                  — stores/walletStore.ts (persist key)
 *   - 'veilpay-settings-storage'                — stores/settingsStore.ts (persist key)
 *   - 'veilpay-wallet-mnemonic'                 — cleared via clearStoredMnemonic below
 */
const EXTRA_SECURE_KEYS: string[] = [
  'veilpay_app_password',
  'veilpay.stealth.lastScannedBlock',
  'veilpay-wallet-storage',
  'veilpay-settings-storage',
];

/** AsyncStorage keys that hold caches / diagnostics and must be removed. */
const ASYNC_CACHE_KEYS: string[] = [
  '@veilpay_spp_diagnostics_v1',
  '@veilpay_spp_prove_ready_v1',
  '@veilpay_market_data_cache_v1',
  '@veilpay_notifications_seen_addresses', // managed by notificationSeen.ts
  '@veilpay_price_', // prefix-matching handled below via getAllKeys
];

/**
 * Wipe local wallet secrets + session + analytics identity + all device-local
 * namespaces. Call only after explicit user confirmation (and preferably
 * biometric auth).
 */
export async function wipeLocalAccountData(): Promise<AccountWipeOutcome> {
  const completed: string[] = [];

  try {
    await clearStoredMnemonic();
    completed.push('mnemonic');
  } catch (error) {
    return { ok: false, failedStep: 'mnemonic', error, completedSteps: completed };
  }

  try {
    useWalletStore.getState().clearWallet();
    useWalletStore.getState().disconnect();
    completed.push('wallet_session');
  } catch (error) {
    return { ok: false, failedStep: 'wallet_session', error, completedSteps: completed };
  }

  try {
    // PRIV-203: full removal of the persisted transaction slice — the
    // plaintext AsyncStorage key 'veilpay-transaction-storage' must not
    // survive a wipe (clearTransactions() deliberately KEEPS private SPP
    // activity rows and the persisted onramp metadata; see
    // transactionStore.wipePersistedState).
    await useTransactionStore.getState().wipePersistedState();
    completed.push('transactions');
  } catch (error) {
    return { ok: false, failedStep: 'transactions', error, completedSteps: completed };
  }

  try {
    useAddressBookStore.getState().clearAddresses();
    completed.push('address_book');
  } catch (error) {
    return { ok: false, failedStep: 'address_book', error, completedSteps: completed };
  }

  try {
    deleteAnalyticsData();
    completed.push('analytics');
  } catch (error) {
    return { ok: false, failedStep: 'analytics', error, completedSteps: completed };
  }

  // Private pre-images / shielded-note material — these must be treated as
  // secrets (fail-closed) just like the mnemonic.
  try {
    await clearAllCommitmentRecords();
    completed.push('commitment_records');
  } catch (error) {
    return { ok: false, failedStep: 'commitment_records', error, completedSteps: completed };
  }

  try {
    await clearAllSppNotes();
    completed.push('spp_notes');
  } catch (error) {
    return { ok: false, failedStep: 'spp_notes', error, completedSteps: completed };
  }

  try {
    await clearAllSppAccounts();
    completed.push('spp_accounts');
  } catch (error) {
    return { ok: false, failedStep: 'spp_accounts', error, completedSteps: completed };
  }

  // Onramp status tokens are access credentials; deleting them is mandatory.
  try {
    await clearAllOnrampTokens();
    completed.push('onramp_tokens');
  } catch (error) {
    return { ok: false, failedStep: 'onramp_tokens', error, completedSteps: completed };
  }

  // Notifications seen-set (per-address SecureStore slots + the AsyncStorage
  // address index, enumerated through notificationSeen.ts).
  try {
    await clearAllNotificationSeen();
    completed.push('notification_seen');
  } catch (error) {
    return { ok: false, failedStep: 'notification_seen', error, completedSteps: completed };
  }

  // Fixed SecureStore keys.
  for (const key of EXTRA_SECURE_KEYS) {
    try {
      // The settings/wallet persist keys can ALSO exist in AsyncStorage when
      // SecureStore was unavailable at write time (secureStateStorage's
      // plaintext fallback) — remove them from both backends. Removing a
      // missing AsyncStorage key is a no-op.
      await AsyncStorage.removeItem(key);
      await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
      completed.push(`secure:${key}`);
    } catch (error) {
      return { ok: false, failedStep: `secure:${key}`, error, completedSteps: completed };
    }
  }

  // AsyncStorage caches — remove known keys plus every '@veilpay_price_*' key.
  try {
    for (const key of ASYNC_CACHE_KEYS) {
      if (!key.endsWith('_')) {
        await AsyncStorage.removeItem(key);
      }
    }
    const allKeys = await AsyncStorage.getAllKeys();
    const priceKeys = allKeys.filter((k) => k.startsWith('@veilpay_price_'));
    if (priceKeys.length > 0) {
      await AsyncStorage.multiRemove(priceKeys);
    }
    completed.push('async_storage_caches');
  } catch (error) {
    return { ok: false, failedStep: 'async_storage_caches', error, completedSteps: completed };
  }

  return { ok: true, steps: completed };
}
