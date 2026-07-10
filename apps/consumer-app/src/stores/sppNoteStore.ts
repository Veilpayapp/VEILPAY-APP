/**
 * Local note / UTXO secrets for Stellar Private Payments.
 *
 * Mirrors the security model of `commitmentStore.ts`:
 * - Secrets live in SecureStore only (device-bound, unlocked).
 * - Never log, analytics, or AsyncStorage.
 * - Losing these records without a re-derive path can lose access to pooled funds.
 *
 * Phase 1 stores the app-visible note summary; full SPP note material
 * (encrypted outputs, nullifiers) will expand as native ops land.
 */

import * as SecureStore from 'expo-secure-store';

/** 0x-prefixed hex field element or key material. */
export type SppHex = `0x${string}`;

/**
 * One shielded note owned by this device for a given pool + account.
 * Round-trip safe under JSON (amounts as decimal strings).
 */
export interface SppNoteRecord {
  /** Stable local id (hash of commitment or random UUID). */
  id: string;
  /** App chain key, e.g. `stellar-testnet`. */
  chainKey: string;
  /** Pool contract id (C…). */
  poolId: string;
  /** Stellar account (G…) that owns the note secrets. */
  ownerAddress: string;
  /** Commitment leaf / note id as hex when known. */
  commitmentHex?: SppHex;
  /** Leaf index in the pool Merkle tree when known. */
  leafIndex?: number;
  /** Amount in whole XLM (or token units), decimal string — not float. */
  amount: string;
  /** Unix ms when recorded. */
  createdAt: number;
  /** True after a confirmed spend (transfer/withdraw). */
  spent: boolean;
  /** Last related tx hash if any. */
  lastTxHash?: string;
}

const INDEX_KEY = 'veilpay.spp.notes.index';
const KEY_PREFIX = 'veilpay.spp.note.';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function noteStorageKey(id: string): string {
  // SecureStore keys: [A-Za-z0-9._-] — strip non-allowed chars from ids.
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_').toLowerCase();
  return `${KEY_PREFIX}${safe}`;
}

async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY, SECURE_STORE_OPTIONS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids), SECURE_STORE_OPTIONS);
}

/**
 * Persist a note record and ensure its id is listed in the index.
 */
export async function saveSppNote(record: SppNoteRecord): Promise<void> {
  const key = noteStorageKey(record.id);
  await SecureStore.setItemAsync(key, JSON.stringify(record), SECURE_STORE_OPTIONS);
  const index = await readIndex();
  if (!index.includes(record.id)) {
    index.push(record.id);
    await writeIndex(index);
  }
}

/**
 * Load one note by id, or null if missing / corrupt.
 */
export async function getSppNote(id: string): Promise<SppNoteRecord | null> {
  const raw = await SecureStore.getItemAsync(noteStorageKey(id), SECURE_STORE_OPTIONS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SppNoteRecord;
  } catch {
    return null;
  }
}

/**
 * List notes, optionally filtered by owner / pool / unspent.
 */
export async function listSppNotes(filter?: {
  ownerAddress?: string;
  poolId?: string;
  unspentOnly?: boolean;
}): Promise<SppNoteRecord[]> {
  const ids = await readIndex();
  const out: SppNoteRecord[] = [];
  for (const id of ids) {
    const note = await getSppNote(id);
    if (!note) continue;
    if (filter?.ownerAddress && note.ownerAddress !== filter.ownerAddress) continue;
    if (filter?.poolId && note.poolId !== filter.poolId) continue;
    if (filter?.unspentOnly && note.spent) continue;
    out.push(note);
  }
  // Newest first
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/**
 * Mark a note spent after a confirmed transfer/withdraw.
 */
export async function markSppNoteSpent(id: string, lastTxHash?: string): Promise<void> {
  const note = await getSppNote(id);
  if (!note) return;
  note.spent = true;
  if (lastTxHash) note.lastTxHash = lastTxHash;
  await saveSppNote(note);
}

/**
 * Sum unspent note amounts as a decimal string (XLM-scale display helper).
 * Uses integer stroops when amounts look like fixed 7-decimal strings.
 */
export function sumSppNoteAmounts(notes: SppNoteRecord[]): string {
  const DECIMALS = 7;
  let stroops = 0n;
  for (const n of notes) {
    if (n.spent) continue;
    const parts = n.amount.trim().split('.');
    const whole = parts[0] || '0';
    const frac = (parts[1] || '').padEnd(DECIMALS, '0').slice(0, DECIMALS);
    if (!/^-?\d+$/.test(whole) || !/^\d*$/.test(frac)) continue;
    const sign = whole.startsWith('-') ? -1n : 1n;
    const w = BigInt(whole.replace('-', '') || '0');
    const f = BigInt(frac || '0');
    stroops += sign * (w * 10n ** BigInt(DECIMALS) + f);
  }
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / 10n ** BigInt(DECIMALS);
  const frac = (abs % 10n ** BigInt(DECIMALS)).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  const body = frac.length ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${body}` : body;
}
