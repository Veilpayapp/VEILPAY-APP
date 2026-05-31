// Feature: veilpay-privacy-stack, Task 10.5: post-deposit banner unit test
/**
 * Post-deposit error banner — SecureStore failure & launch retry.
 *
 * Pins down Requirement 7.7:
 *
 *   "IF the SecureStore write operation fails after a deposit is
 *    confirmed on-chain, THEN THE Mobile_App SHALL display a persistent
 *    error warning the user that their commitment data was not saved
 *    and that funds may be at risk, and SHALL retry the write on the
 *    next app launch."
 *
 * Both halves of that requirement live in three pieces of code:
 *   - `services/depositPersistence.ts` — does the initial save and
 *     enqueues on failure.
 *   - `stores/pendingCommitmentQueue.ts` — the in-memory queue that
 *     drives the banner's visibility.
 *   - `hooks/useDepositPersistenceRecovery.ts` — runs on every app
 *     mount (which is "next launch" for in-memory state) and retries
 *     each queued save.
 *
 * This test exercises all three together, using the actual zustand
 * store and the actual recovery hook against a mocked SecureStore so
 * we can simulate a transient failure followed by a successful retry.
 *
 * Validates: Requirements 7.7
 */

// ---------------------------------------------------------------------------
// expo-secure-store mock — the only piece we actually need to control.
//
// `setItemAsync` is a `jest.fn()` so each test case can stage:
//   - first call rejects (simulated keychain failure on the deposit)
//   - second call resolves (simulated keychain recovery on next mount)
//
// `getItemAsync` returns `null` because the recovery hook does not read
// from SecureStore on its own; it walks the in-memory queue.
// ---------------------------------------------------------------------------
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn(),
}));

// Silence the captureMessage console output the depositPersistence and
// recovery code emit on the failure / retry branches — keeps test logs
// clean without interfering with the assertions.
jest.mock('../../utils/sentry', () => ({
  __esModule: true,
  captureMessage: jest.fn(),
  captureError: jest.fn(),
  initSentry: jest.fn(),
  setUserContext: jest.fn(),
  addBreadcrumb: jest.fn(),
  withPerformanceSpan: <T,>(_n: string, _o: string, fn: () => T): T => fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { renderHook, waitFor } from '@testing-library/react-native';

import { persistCommitmentAfterDeposit } from '../depositPersistence';
import { useDepositPersistenceRecovery } from '../../hooks/useDepositPersistenceRecovery';
import { usePendingCommitmentQueue } from '../../stores/pendingCommitmentQueue';
import type { CommitmentRecord } from '../../stores/commitmentStore';

const setItemAsyncMock = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;

/**
 * Build a `CommitmentRecord` with placeholder field elements that satisfy
 * the type contract. We do not need crypto-meaningful values here — the
 * test only round-trips the record through SecureStore and the queue.
 */
function makeRecord(overrides: Partial<CommitmentRecord> = {}): CommitmentRecord {
  return {
    nullifier: `0x${'1'.repeat(64)}`,
    secret: `0x${'2'.repeat(64)}`,
    commitmentHash: `0x${'3'.repeat(64)}`,
    leafIndex: 0,
    merkleRoot: `0x${'4'.repeat(64)}`,
    amount: '1000000000000000000',
    token: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    chainKey: 'evm-sepolia',
    timestamp: 1_700_000_000_000,
    spent: false,
    ...overrides,
  };
}

describe('post-deposit error banner — SecureStore failure + launch retry (Req 7.7)', () => {
  beforeEach(() => {
    // Fresh queue per test so leftover entries from a previous case can't
    // leak. The store is module-scoped, so an explicit `clear()` is
    // necessary before every test.
    usePendingCommitmentQueue.getState().clear();
    setItemAsyncMock.mockReset();
  });

  it('queues the failed save and the recovery hook retries on next mount', async () => {
    const record = makeRecord();

    // ── Phase 1: simulated post-deposit save fails ─────────────────────
    // First write rejects, mimicking a transient keychain lock.
    setItemAsyncMock.mockRejectedValueOnce(new Error('keychain locked'));

    const result = await persistCommitmentAfterDeposit(record);

    // The service must NOT throw on a SecureStore failure — it returns
    // `{ saved: false }` and routes the record into the queue so the
    // banner can render.
    expect(result.saved).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('keychain locked');

    // The pending queue is now non-empty: the banner reads
    // `selectHasPendingCommitments` (queue.length > 0) and renders.
    const afterFailure = usePendingCommitmentQueue.getState().pending;
    expect(afterFailure).toHaveLength(1);
    expect(afterFailure[0].record).toEqual(record);
    expect(afterFailure[0].lastError).toBe('keychain locked');
    expect(afterFailure[0].attemptCount).toBe(0);

    // ── Phase 2: simulated next launch — retry succeeds ────────────────
    // Stage SecureStore for a successful retry, then mount the recovery
    // hook (which is what `App.tsx` does on every cold launch).
    setItemAsyncMock.mockResolvedValueOnce(undefined);

    const { unmount } = renderHook(() => useDepositPersistenceRecovery());

    // The recovery loop is async (it `await`s `saveCommitmentRecord` per
    // entry). `waitFor` gives the microtask queue a chance to drain.
    await waitFor(() => {
      expect(usePendingCommitmentQueue.getState().pending).toHaveLength(0);
    });

    // SecureStore was hit twice in total: once on the failing initial
    // save, once on the successful retry. Distinguishes a real retry from
    // a "queue cleared without writing" bug.
    expect(setItemAsyncMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('keeps the banner visible when the retry also fails', async () => {
    const record = makeRecord({ commitmentHash: `0x${'5'.repeat(64)}` });

    // First call (initial save) and second call (retry) both reject.
    setItemAsyncMock
      .mockRejectedValueOnce(new Error('keychain locked'))
      .mockRejectedValueOnce(new Error('still locked'));

    const result = await persistCommitmentAfterDeposit(record);
    expect(result.saved).toBe(false);
    expect(usePendingCommitmentQueue.getState().pending).toHaveLength(1);

    const { unmount } = renderHook(() => useDepositPersistenceRecovery());

    // The retry's failure path re-enqueues with an updated `lastError`
    // and bumps `attemptCount` via `markAttempt`. We wait until the
    // recovery loop has processed the snapshot (attemptCount > 0).
    await waitFor(() => {
      const entries = usePendingCommitmentQueue.getState().pending;
      expect(entries).toHaveLength(1);
      expect(entries[0].attemptCount).toBeGreaterThanOrEqual(1);
      expect(entries[0].lastError).toBe('still locked');
    });

    // Both writes were attempted; the queue is still non-empty so the
    // banner stays mounted.
    expect(setItemAsyncMock).toHaveBeenCalledTimes(2);
    expect(usePendingCommitmentQueue.getState().pending).toHaveLength(1);

    unmount();
  });
});
