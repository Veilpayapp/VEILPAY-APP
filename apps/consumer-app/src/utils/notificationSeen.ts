/**
 * Per-address "seen received tx" bookkeeping for
 * `useIncomingPaymentNotifications`.
 *
 * The actual seen-hash set is persisted to SecureStore (as the hook has
 * always done — it is device-bound de-dup state). Because SecureStore has no
 * key enumeration API, we keep a small index of the addresses that have a seen
 * slot in AsyncStorage so a full account wipe (PRIV-203/PRIV-211) can
 * enumerate and delete every `veilpay.notifications.seen*` key instead of
 * leaking orphaned slots.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** SecureStore prefix for the per-address seen-hash sets. */
export const NOTIFICATIONS_SEEN_PREFIX = 'veilpay.notifications.seenReceivedTx.';

/** AsyncStorage index of addresses that hold a seen slot. */
const SEEN_ADDRESSES_INDEX_KEY = '@veilpay_notifications_seen_addresses';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Compute the SecureStore seen-slot key for a given address. */
export function seenStorageKey(address: string): string {
  return `${NOTIFICATIONS_SEEN_PREFIX}${address.toLowerCase()}`;
}

/** Load the set of addresses that currently hold a seen slot. */
export async function listNotificationSeenAddresses(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_ADDRESSES_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Record that an address now owns a SecureStore seen slot, so the wipe can
 * find and delete it later. Best-effort — a failure here only means an
 * orphaned slot could survive a wipe, never that the watcher is harmed.
 */
export async function registerNotificationSeenAddress(address: string): Promise<void> {
  const normalized = address.toLowerCase();
  if (!normalized) return;
  try {
    const addresses = await listNotificationSeenAddresses();
    if (!addresses.includes(normalized)) {
      addresses.push(normalized);
      await AsyncStorage.setItem(SEEN_ADDRESSES_INDEX_KEY, JSON.stringify(addresses));
    }
  } catch {
    // Best-effort; the SecureStore slot itself is unaffected.
  }
}

/**
 * Delete every per-address seen slot plus the address index. Used by the
 * account wipe so no local notification de-dup state survives erasure.
 */
export async function clearAllNotificationSeen(): Promise<void> {
  const addresses = await listNotificationSeenAddresses();
  for (const address of addresses) {
    const key = seenStorageKey(address);
    await SecureStore.deleteItemAsync(key, SECURE_OPTS).catch(() => undefined);
  }
  await AsyncStorage.removeItem(SEEN_ADDRESSES_INDEX_KEY).catch(() => undefined);
}
