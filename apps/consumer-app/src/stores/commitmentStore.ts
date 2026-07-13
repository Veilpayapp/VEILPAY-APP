import * as SecureStore from 'expo-secure-store';

/**
 * 0x-prefixed hex string. Used for 32-byte field elements
 * (`nullifier`, `secret`, `commitmentHash`, `merkleRoot`) and for
 * arbitrary-length hex payloads.
 */
export type Hex = `0x${string}`;

/**
 * 0x-prefixed 20-byte EVM address.
 */
export type Address = `0x${string}`;

/**
 * Persisted record describing a single VeilPool deposit owned by this
 * device. The pre-image (`nullifier`, `secret`) is required to later
 * generate a withdraw proof, so this struct must live in SecureStore
 * (hardware-backed Keychain / Keystore where available) and never in
 * AsyncStorage, transactionStore, logs, or analytics payloads.
 *
 * Round-trip invariant: `JSON.parse(JSON.stringify(r))` deep-equals `r`
 * for all fields. `amount` is a decimal string (not bigint, not number)
 * deliberately so the value survives JSON without precision loss.
 *
 * See design.md §Data Models > CommitmentRecord.
 */
export interface CommitmentRecord {
  /** 32-byte field element (random). Private. */
  nullifier: Hex;
  /** 32-byte field element (random). Private. */
  secret: Hex;
  /** Poseidon(nullifier, secret). Public; identifies the leaf. */
  commitmentHash: Hex;
  /** Position in the pool's Merkle tree at time of insertion. */
  leafIndex: number;
  /** Pool root *after* this leaf was inserted; used for proof. */
  merkleRoot: Hex;
  /** Deposit amount in the token's smallest unit, as decimal string. */
  amount: string;
  /** ERC-20 token address (or sentinel 0xeeee...eeee for native ETH). */
  token: Address;
  /** e.g. `'evm-sepolia'`. Distinguishes pools across networks. */
  chainKey: string;
  /** Unix ms when the record was written. */
  timestamp: number;
  /** True after the corresponding withdraw is confirmed on-chain. */
  spent: boolean;
  /**
   * DATA-002 (forward-compat): Merkle path + nullifier hash for max withdraw.
   * Optional until deposit-time capture + indexer reconstruction land.
   * `EVM_MAX_PRIVACY_WITHDRAW_READY` stays false until these are populated e2e.
   */
  pathElements?: Hex[];
  pathIndices?: number[];
  nullifierHash?: Hex;
}

/**
 * SecureStore key prefix. The full key is
 * `veilpay.commitment.<commitmentHash without 0x, lowercased>`.
 *
 * Lowercasing the hash portion keeps keys deterministic regardless of
 * how the caller cased the input. SecureStore restricts keys to
 * `[A-Za-z0-9._-]`, so the `0x` prefix must be stripped — `x` is
 * permitted by the regex but we strip it for cleanliness and to make
 * keys mechanically derivable from the raw hash bytes.
 */
const KEY_PREFIX = 'veilpay.commitment.';

/**
 * Compute the SecureStore key for a given commitment hash.
 *
 * The `0x` prefix is stripped and the remainder lowercased so that
 * `0xABC...` and `0xabc...` map to the same storage slot. Stored
 * *values* (the JSON blob) preserve whatever casing the caller passed.
 */
const storageKey = (commitmentHash: Hex): string =>
  `${KEY_PREFIX}${commitmentHash.slice(2).toLowerCase()}`;

/**
 * SecureStore options used for every write. `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
 * pins the entry to this physical device — it is never synced to iCloud
 * Keychain or restored to a different device — and only readable while
 * the device is unlocked.
 */
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * Persist a `CommitmentRecord` to SecureStore.
 *
 * The entire record is stored as a single JSON blob under the key
 * derived from `r.commitmentHash`. Any error thrown by SecureStore
 * (e.g. Keychain unavailable, hardware locked) propagates to the
 * caller. The persistent-banner-and-retry policy described in
 * task 7.4 is the caller's responsibility — this module simply
 * surfaces failures so the UI knows the write did not land.
 *
 * @param r The record to persist. Must include a `commitmentHash`.
 */
export async function saveCommitmentRecord(r: CommitmentRecord): Promise<void> {
  const value = JSON.stringify(r);
  await SecureStore.setItemAsync(storageKey(r.commitmentHash), value, SECURE_STORE_OPTIONS);
}

/**
 * Load a `CommitmentRecord` from SecureStore by its commitment hash.
 *
 * Returns `null` if no record exists for the given hash. Any error
 * thrown by SecureStore propagates; callers should distinguish "no
 * record" (return value `null`) from "storage failed" (thrown error).
 *
 * @param commitmentHash The Poseidon(nullifier, secret) hash that
 *   identifies the deposit on-chain.
 */
export async function loadCommitmentRecord(commitmentHash: Hex): Promise<CommitmentRecord | null> {
  const raw = await SecureStore.getItemAsync(storageKey(commitmentHash));
  if (raw == null) {
    return null;
  }
  return JSON.parse(raw) as CommitmentRecord;
}

/**
 * Mark a previously-saved `CommitmentRecord` as spent.
 *
 * Loads the record, flips `spent` to `true`, and writes it back. If
 * no record exists for the given hash this returns silently — the
 * common case is a withdraw confirming for a record that was already
 * cleaned up, and reverting that with an exception would force the
 * caller into defensive try/catch on the happy path.
 *
 * Errors from the underlying SecureStore reads/writes still propagate.
 *
 * @param commitmentHash The hash of the deposit whose withdraw just
 *   confirmed on-chain.
 */
export async function markSpent(commitmentHash: Hex): Promise<void> {
  const record = await loadCommitmentRecord(commitmentHash);
  if (record == null) {
    return;
  }
  record.spent = true;
  await saveCommitmentRecord(record);
}
