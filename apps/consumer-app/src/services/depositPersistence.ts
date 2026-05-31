/**
 * Post-deposit commitment persistence helper.
 *
 * Purpose: this is the single function callers should use after a
 * `VeilPool.deposit` transaction has confirmed on-chain. It tries to
 * persist the `CommitmentRecord` to SecureStore and, on failure,
 * enqueues the record for retry-on-launch and surfaces the failure to
 * the persistent banner via the in-memory pending queue.
 *
 * Centralising this logic prevents the failure-handling policy from
 * being re-implemented (and forgotten) at every deposit call site.
 *
 * The function does not throw. The return value tells the caller
 * whether the save landed; either way, the user's commitment data is
 * accounted for (saved, or queued + banner). On a queued failure the
 * caller should still treat the deposit as successful — the on-chain
 * leaf is in the tree regardless of local persistence state — and
 * trust the banner + retry to reconcile state on the next launch.
 *
 * See:
 *   - requirements.md Requirement 7.7
 *   - design.md §Failure Mode Matrix (post-deposit `SecureStore` row)
 *   - tasks.md task 7.4
 */

import { saveCommitmentRecord, type CommitmentRecord } from '../stores/commitmentStore';
import { usePendingCommitmentQueue } from '../stores/pendingCommitmentQueue';
import { captureMessage } from '../utils/sentry';

export interface PersistCommitmentResult {
  /** True when the SecureStore write succeeded immediately. */
  saved: boolean;
  /** Populated only when `saved === false`; the underlying error. */
  error?: Error;
}

/**
 * Attempt to persist a freshly-confirmed deposit's `CommitmentRecord`.
 *
 * On success: returns `{ saved: true }`.
 *
 * On failure: enqueues the record into the in-memory pending queue
 * (which drives the persistent banner) and returns
 * `{ saved: false, error }`. The error is also reported to Sentry as
 * a warning so the persistence failure shows up in observability
 * even though the user-facing surface is the banner.
 */
export async function persistCommitmentAfterDeposit(
  record: CommitmentRecord
): Promise<PersistCommitmentResult> {
  try {
    await saveCommitmentRecord(record);
    return { saved: true };
  } catch (rawError) {
    const error = rawError instanceof Error
      ? rawError
      : new Error(typeof rawError === 'string' ? rawError : 'SecureStore write failed');

    // Enqueue first so the banner appears even if Sentry capture is slow.
    usePendingCommitmentQueue.getState().enqueue(record, error);

    // Sentry copy is intentionally non-PII: log only the commitmentHash
    // (a public value) and the error message — never `nullifier` or
    // `secret` (Requirement 7.6).
    captureMessage(
      `[depositPersistence] SecureStore write failed for commitment ${record.commitmentHash.slice(0, 10)}…: ${error.message}`,
      'error'
    );

    return { saved: false, error };
  }
}
