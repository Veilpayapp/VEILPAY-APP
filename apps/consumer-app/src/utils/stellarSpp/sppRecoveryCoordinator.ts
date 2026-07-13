/**
 * Session-level coordination for SPP note recovery.
 *
 * Home focus, pXLM select, pull-to-refresh, and background setup used to each
 * call recoverSppNotesFromChain (pool_open + double pool_sync). That stampeded
 * native work, froze the UI, and left the balance card in a loading loop.
 *
 * Rules:
 * - One full recover in flight at a time (shared promise).
 * - Light path = local SecureStore notes only (no native sync).
 * - Full recover at most once per (chain, owner) per JS session unless forced.
 * - Never re-full-sync just because local amount is 0 after a session attempt.
 * - Last-known amount survives Home unmount (Settings → back).
 */

import {
  getLocalPrivateBalance,
  recoverSppNotesFromChain,
  type SppNoteRecoveryResult,
} from './sppClient';

function sessionKey(chainKey: string, ownerAddress: string): string {
  return `${chainKey}:${ownerAddress.toUpperCase()}`;
}

/** Keys that completed a full recover attempt this process lifetime. */
const recoveredThisSession = new Set<string>();

/** Shared in-flight recoveries keyed by session key. */
const inFlight = new Map<string, Promise<SppNoteRecoveryResult>>();

/** Survives HomeDashboard unmount so the card doesn't flash 0 → skeleton. */
const lastKnownAmount = new Map<string, string>();

export type CoordinatedRecoverOptions = {
  /**
   * Bypass the "once per session" gate (pull-to-refresh, after shield/unshield,
   * explicit restore). Still de-dupes concurrent callers via the shared promise.
   */
  force?: boolean;
};

export function hasRecoveredThisSession(
  chainKey: string,
  ownerAddress: string
): boolean {
  return recoveredThisSession.has(sessionKey(chainKey, ownerAddress));
}

export function getLastKnownPrivateAmount(
  chainKey: string,
  ownerAddress: string
): string | null {
  return lastKnownAmount.get(sessionKey(chainKey, ownerAddress)) ?? null;
}

export function setLastKnownPrivateAmount(
  chainKey: string,
  ownerAddress: string,
  amount: string
): void {
  lastKnownAmount.set(sessionKey(chainKey, ownerAddress), amount);
}

/** Test / logout helper. */
export function resetSppRecoverySession(chainKey?: string, ownerAddress?: string): void {
  if (chainKey && ownerAddress) {
    const key = sessionKey(chainKey, ownerAddress);
    recoveredThisSession.delete(key);
    inFlight.delete(key);
    lastKnownAmount.delete(key);
    return;
  }
  recoveredThisSession.clear();
  inFlight.clear();
  lastKnownAmount.clear();
}

/**
 * Fast local read only — never opens a native pool session.
 */
export async function readLocalPrivateBalanceLight(
  chainKey: string,
  ownerAddress: string
): Promise<{ amount: string; notes: Awaited<ReturnType<typeof getLocalPrivateBalance>>['notes'] }> {
  const local = await getLocalPrivateBalance(chainKey, ownerAddress);
  if (local.amount != null) {
    setLastKnownPrivateAmount(chainKey, ownerAddress, local.amount);
  }
  return local;
}

/**
 * Coordinated full chain recovery (native pool_sync + balance).
 * Concurrent callers for the same key share one promise.
 * After any completed attempt (ok or hard fail), further calls use local unless `force`.
 */
export async function recoverSppNotesCoordinated(
  chainKey: string,
  ownerAddress: string,
  opts: CoordinatedRecoverOptions = {}
): Promise<SppNoteRecoveryResult> {
  const key = sessionKey(chainKey, ownerAddress);
  const force = opts.force === true;

  if (!force && recoveredThisSession.has(key)) {
    const local = await getLocalPrivateBalance(chainKey, ownerAddress);
    const amount =
      local.amount || getLastKnownPrivateAmount(chainKey, ownerAddress) || '0';
    return {
      recovered: true,
      amount,
      notes: local.notes,
      message: 'Using session-cached private balance',
    };
  }

  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<SppNoteRecoveryResult> => {
    try {
      const result = await recoverSppNotesFromChain(chainKey, ownerAddress);
      // Always mark attempted so we never thrash native on every focus / remount.
      recoveredThisSession.add(key);
      const amount =
        result.amount ||
        result.nativeAmount ||
        getLastKnownPrivateAmount(chainKey, ownerAddress) ||
        '0';
      setLastKnownPrivateAmount(chainKey, ownerAddress, amount);
      return { ...result, amount };
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/**
 * Prefer local / session cache; full recover only when forced or first session attempt.
 *
 * IMPORTANT: do NOT full-recover merely because amount is 0 after a prior attempt —
 * that was re-running pool_sync on every Home focus when notes were empty or partial.
 */
export async function refreshPrivateBalanceSmart(
  chainKey: string,
  ownerAddress: string,
  opts: CoordinatedRecoverOptions & { preferLocal?: boolean } = {}
): Promise<SppNoteRecoveryResult> {
  const force = opts.force === true;
  const key = sessionKey(chainKey, ownerAddress);

  if (!force && recoveredThisSession.has(key)) {
    const local = await getLocalPrivateBalance(chainKey, ownerAddress);
    const amount =
      local.amount || getLastKnownPrivateAmount(chainKey, ownerAddress) || '0';
    setLastKnownPrivateAmount(chainKey, ownerAddress, amount);
    return {
      recovered: true,
      amount,
      notes: local.notes,
      message: 'Local private notes',
    };
  }

  // First paint this session with local notes — skip native until user forces
  // or local is empty AND we have never attempted recover.
  if (!force) {
    const local = await getLocalPrivateBalance(chainKey, ownerAddress);
    const localNum = Number.parseFloat(local.amount || '0');
    if (localNum > 0) {
      // Trust local notes for display; mark session so focus stays light.
      recoveredThisSession.add(key);
      setLastKnownPrivateAmount(chainKey, ownerAddress, local.amount);
      return {
        recovered: true,
        amount: local.amount,
        notes: local.notes,
        message: 'Local private notes',
      };
    }
  }

  return recoverSppNotesCoordinated(chainKey, ownerAddress, { force });
}
