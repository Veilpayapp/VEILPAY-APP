/**
 * Retry queued commitment saves on app launch.
 *
 * Mounted exactly once at the app root. On mount, it walks the
 * in-memory pending queue (`usePendingCommitmentQueue`) and retries
 * `saveCommitmentRecord` for every entry. Successful retries are
 * dequeued; failed retries stay in the queue, the persistent banner
 * stays visible, and the retry will run again on the next mount.
 *
 * Why "on next launch" maps to "on every mount":
 *
 *   - The pending queue is in-memory only (Requirement 7.6 forbids
 *     persisting `nullifier` / `secret` outside SecureStore, and the
 *     queue exists precisely because SecureStore is misbehaving).
 *   - Therefore any process kill empties the queue. The "retry on
 *     next launch" wording in Requirement 7.7 is best-effort: it
 *     means "before the user can act on the privacy flow again, the
 *     app should re-attempt any pending writes that survived". Mount
 *     is the right hook because it fires on cold launch *and* on
 *     every fresh `App` mount within a session (e.g. after fast
 *     refresh, navigation back to root).
 *
 * The privacy-flow gate (Requirement 7.7 "before the privacy flow
 * becomes available") is enforced by call sites that read
 * `selectHasPendingCommitments` and refuse to start a new max-privacy
 * flow while pending writes exist; this hook only handles the retry
 * itself.
 *
 * See:
 *   - requirements.md Requirement 7.7
 *   - tasks.md task 7.4
 */

import { useEffect } from 'react';

import { saveCommitmentRecord } from '../stores/commitmentStore';
import { usePendingCommitmentQueue } from '../stores/pendingCommitmentQueue';
import { captureMessage } from '../utils/sentry';

export function useDepositPersistenceRecovery(): void {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Snapshot the queue *at mount time*. New entries enqueued
      // mid-flight will be picked up by the next mount; we don't
      // want this loop to retry infinitely against a queue that
      // keeps growing.
      const snapshot = usePendingCommitmentQueue.getState().pending;

      for (const entry of snapshot) {
        if (cancelled) {
          return;
        }

        const { record } = entry;
        usePendingCommitmentQueue.getState().markAttempt(record.commitmentHash);

        try {
          // Process the queue one record at a time: each iteration mutates the
          // shared pending-commitment store (markAttempt/dequeue) and honours the
          // `cancelled` flag, so parallelizing would race on that store.
          // eslint-disable-next-line react-doctor/async-await-in-loop
          await saveCommitmentRecord(record);
          if (cancelled) {
            return;
          }
          usePendingCommitmentQueue.getState().dequeue(record.commitmentHash);
          captureMessage(
            `[depositPersistence] Recovered queued commitment ${record.commitmentHash.slice(0, 10)}… on launch retry`,
            'info'
          );
        } catch (rawError) {
          // Leave the entry in the queue. The banner stays visible
          // and the next mount will try again. We refresh the
          // entry's `lastError` so the diagnostic message is current.
          const message = rawError instanceof Error
            ? rawError.message
            : typeof rawError === 'string'
              ? rawError
              : 'SecureStore write failed';
          usePendingCommitmentQueue.getState().enqueue(record, new Error(message));
          captureMessage(
            `[depositPersistence] Retry failed for commitment ${record.commitmentHash.slice(0, 10)}…: ${message}`,
            'warning'
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount-only: we deliberately want this to run once per app
    // mount, not on every queue change. New entries are handled by
    // the next mount.  }, []);
}
