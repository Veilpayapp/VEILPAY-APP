/**
 * SPP account onboarding state (device-local SecureStore).
 *
 * Holds public identifiers + ASP membership status. Never stores raw wallet
 * seed here (seed remains in the existing wallet secure path).
 *
 * Private note spending keys land when native derive FFI is linked; until
 * then we persist the derivation signature hash + optional leaf decimal.
 */

import * as SecureStore from 'expo-secure-store';

export type SppAccountRecord = {
  chainKey: string;
  ownerAddress: string;
  /** SHA-256 hex of the 64-byte SEP-53 derivation signature (not the signature). */
  derivationSigHashHex?: string;
  /** Note public key hex (32 bytes) when native derive is available. */
  notePublicKeyHex?: string;
  /** Encryption public key hex (32 bytes) when available. */
  encryptionPublicKeyHex?: string;
  /** Membership blinding field hex when available (secret-ish — SecureStore only). */
  membershipBlindingHex?: string;
  /** ASP membership leaf as decimal string for insert_leaf (U256). */
  aspLeafDecimal?: string;
  /** True after a successful on-chain insert_leaf for this account. */
  aspInserted: boolean;
  /** Horizon/Soroban tx hash of insert_leaf when known. */
  aspInsertTxHash?: string;
  updatedAt: number;
};

const KEY_PREFIX = 'veilpay.spp.account.';
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function storageKey(chainKey: string, ownerAddress: string): string {
  const safe = `${chainKey}.${ownerAddress}`.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${KEY_PREFIX}${safe}`;
}

export async function getSppAccount(
  chainKey: string,
  ownerAddress: string
): Promise<SppAccountRecord | null> {
  const raw = await SecureStore.getItemAsync(storageKey(chainKey, ownerAddress), SECURE_OPTS);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SppAccountRecord;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSppAccount(record: SppAccountRecord): Promise<void> {
  await SecureStore.setItemAsync(
    storageKey(record.chainKey, record.ownerAddress),
    JSON.stringify(record),
    SECURE_OPTS
  );
}

export async function markAspInserted(
  chainKey: string,
  ownerAddress: string,
  txHash: string
): Promise<SppAccountRecord | null> {
  const existing = await getSppAccount(chainKey, ownerAddress);
  if (!existing) return null;
  const next: SppAccountRecord = {
    ...existing,
    aspInserted: true,
    aspInsertTxHash: txHash,
    updatedAt: Date.now(),
  };
  await saveSppAccount(next);
  return next;
}
