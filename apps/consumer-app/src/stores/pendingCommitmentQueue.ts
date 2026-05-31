/**
 * In-memory queue of `CommitmentRecord`s whose SecureStore write has
 * not yet succeeded.
 *
 * This queue is the load-bearing piece of Requirement 7.7 — a deposit
 * that confirmed on-chain but whose record could not be persisted is
 * unrecoverable money. The mitigation is twofold:
 *
 *   1. Render a persistent banner (`CommitmentSaveBanner`) for as long
 *      as the queue is non-empty, so the user is aware their funds are
 *      at risk and can avoid uninstalling / clearing storage before
 *      the save succeeds.
 *   2. Retry every queued save whenever the app mounts (handled by
 *      `useDepositPersistenceRecovery`).
 *
 * The queue is intentionally **in-memory only**. The records contain
 * `nullifier` and `secret` field elements (Requirement 7.6) which must
 * never touch `AsyncStorage` or any non-SecureStore-backed store. We
 * could in principle mirror the queue to SecureStore, but the queue
 * exists precisely *because* SecureStore writes are failing, so a
 * SecureStore-backed queue would race the same failure mode.
 *
 * Process kill before a successful retry therefore loses the record;
 * the design (`design.md` §Failure Mode Matrix) accepts this as the
 * worst-case outcome and documents it loudly via the persistent
 * banner.
 *
 * See:
 *   - requirements.md Requirement 7.7
 *   - design.md §Failure Mode Matrix
 *   - tasks.md task 7.4
 */

import { create } from 'zustand';

import type { CommitmentRecord } from './commitmentStore';

/**
 * The reason the most recent enqueue happened, surfaced to the banner
 * for diagnostic copy. We deliberately store the message string, not
 * the raw `Error` instance, so the queue stays serialisation-friendly
 * and selector-comparable.
 */
export interface PendingCommitmentEntry {
  record: CommitmentRecord;
  /** Unix ms when the entry was enqueued (last failure time). */
  enqueuedAt: number;
  /** Stringified error from the most recent SecureStore failure. */
  lastError: string;
  /** How many retries have been attempted so far. */
  attemptCount: number;
}

interface PendingCommitmentQueueState {
  pending: readonly PendingCommitmentEntry[];

  /**
   * Enqueue a record (or update its entry if the same
   * `commitmentHash` is already queued). The queue is keyed by
   * `commitmentHash`, so enqueuing the same record twice replaces
   * the earlier entry rather than producing duplicates.
   */
  enqueue: (record: CommitmentRecord, error: unknown) => void;

  /**
   * Increment the `attemptCount` for an existing entry without
   * reordering the queue. Called by the recovery hook before each
   * retry so the banner can reflect activity.
   */
  markAttempt: (commitmentHash: CommitmentRecord['commitmentHash']) => void;

  /**
   * Remove a record from the queue. Called once the SecureStore
   * write finally succeeds.
   */
  dequeue: (commitmentHash: CommitmentRecord['commitmentHash']) => void;

  /** Clear the entire queue. Test-only. */
  clear: () => void;
}

/**
 * Coerce an unknown thrown value to a stable, human-readable string.
 *
 * SecureStore can throw a variety of shapes (Keychain `Error`,
 * platform `string`, native `{code, message}` object). This collapses
 * them so the banner has something to show.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || 'Unknown error';
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

export const usePendingCommitmentQueue = create<PendingCommitmentQueueState>((set) => ({
  pending: [],

  enqueue: (record, error) => set((state) => {
    const lastError = describeError(error);
    const now = Date.now();

    const existingIdx = state.pending.findIndex(
      (entry) => entry.record.commitmentHash === record.commitmentHash
    );

    if (existingIdx >= 0) {
      const next = [...state.pending];
      const existing = next[existingIdx];
      next[existingIdx] = {
        record,
        enqueuedAt: now,
        lastError,
        attemptCount: existing.attemptCount,
      };
      return { pending: next };
    }

    return {
      pending: [
        ...state.pending,
        {
          record,
          enqueuedAt: now,
          lastError,
          attemptCount: 0,
        },
      ],
    };
  }),

  markAttempt: (commitmentHash) => set((state) => ({
    pending: state.pending.map((entry) =>
      entry.record.commitmentHash === commitmentHash
        ? { ...entry, attemptCount: entry.attemptCount + 1 }
        : entry
    ),
  })),

  dequeue: (commitmentHash) => set((state) => ({
    pending: state.pending.filter(
      (entry) => entry.record.commitmentHash !== commitmentHash
    ),
  })),

  clear: () => set({ pending: [] }),
}));

/**
 * Selector: are there any records waiting to be saved? Components
 * that gate UI on the persistence state (e.g. the banner, the privacy
 * flow availability) should read this rather than the raw `pending`
 * array so they only re-render when the boolean flips.
 */
export const selectHasPendingCommitments = (
  state: PendingCommitmentQueueState
): boolean => state.pending.length > 0;
