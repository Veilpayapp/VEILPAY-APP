// Feature: veilpay-privacy-stack, Task 10.5: AppState pause/resume unit test
/**
 * useStealthScanner — AppState lifecycle (Requirement 11.5).
 *
 * Property 18 (`useStealthScanner.property.test.ts`) covers the
 * cursor-advancement algorithm in the abstract. This file pins down
 * the *mechanism* by which the algorithm is driven on/off — the
 * `AppState` subscription — at the actual hook boundary.
 *
 * Specifically, Requirement 11.5:
 *
 *   "WHEN the app is in the background, THE useStealthScanner SHALL
 *    pause polling and resume when the app returns to the foreground."
 *
 * Concretely we verify, against the real hook with mocked `react-native`
 * / `expo-secure-store` / `ethers` boundaries:
 *
 *   1. With the app `'active'`, the polling timer fires every
 *      `intervalMs` (one tick per interval, plus the initial mount tick).
 *   2. On `AppState` → `'background'`, the timer is cleared: advancing
 *      time past `intervalMs` does NOT cause another tick.
 *   3. On `AppState` → `'active'` again, an immediate catch-up tick fires
 *      (per the hook's "do not wait a full minute on resume" comment) and
 *      the recurring timer is re-armed.
 *
 * Validates: Requirements 7.7, 11.5
 */

// ---------------------------------------------------------------------------
// react-native mock — replace `AppState` with a controllable stub while
// keeping the rest of the (jest-expo provided) RN surface intact, since the
// rendered hook still needs `Dimensions`, `StyleSheet`, etc. for any
// transitive imports.
//
// `__triggerChange` is the test-side handle used to simulate the OS sending
// a foreground/background notification. The hook subscribes once at mount
// via `AppState.addEventListener('change', cb)`, and we capture that `cb`
// in a module-scoped slot so the test can invoke it directly.
// ---------------------------------------------------------------------------
let appStateChangeListener: ((next: string) => void) | null = null;

import { AppState } from 'react-native';

// ---------------------------------------------------------------------------
// expo-secure-store mock — in-memory map.
//
// Returns `null` for the cursor key on first read (so the hook falls back to
// `deploymentStartBlock`) and remembers writes so subsequent reads see the
// last persisted cursor. The setItemAsync mock resolves successfully — we
// are testing AppState behaviour, not SecureStore failure modes (that is
// File 2's territory).
// ---------------------------------------------------------------------------
jest.mock('expo-secure-store', () => {
  const memory = new Map<string, string>();
  return {
    __esModule: true,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (k: string, v: string) => {
      memory.set(k, v);
    }),
    getItemAsync: jest.fn(async (k: string) =>
      memory.has(k) ? (memory.get(k) as string) : null
    ),
    deleteItemAsync: jest.fn(async (k: string) => {
      memory.delete(k);
    }),
  };
});

// ---------------------------------------------------------------------------
// ethers mock — minimal surface needed by the hook's tick body.
//
// `getBlockNumber` is a counter (incremented per call) so each successful
// tick has something fresh to scan. `queryFilter` returns `[]` because we
// are not testing match handling here; the property test covers that.
// ---------------------------------------------------------------------------
const mockGetBlockNumber = jest.fn().mockResolvedValue(100);
const mockQueryFilter = jest.fn();

jest.mock('ethers', () => ({
  __esModule: true,
  ethers: {
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getBlockNumber: mockGetBlockNumber,
    })),
    Contract: jest.fn().mockImplementation(() => ({
      filters: { Announcement: () => ({ topics: ['announcement-filter'] }) },
      queryFilter: mockQueryFilter,
    })),
  },
}));

// ---------------------------------------------------------------------------
// stealthEngine mock — never called in this test (no matches), but mocking
// it prevents the real implementation's @noble dependencies from being
// evaluated in the test environment.
// ---------------------------------------------------------------------------
jest.mock('../../utils/stealthEngine', () => ({
  __esModule: true,
  checkStealthAddressMatch: jest.fn().mockReturnValue(false),
}));

import { act, renderHook } from '@testing-library/react-native';

import { useStealthScanner } from '../useStealthScanner';

const VALID_HEX = `0x${'a'.repeat(64)}` as const;
const VALID_PUBKEY = `0x${'b'.repeat(66)}` as const;
const RPC_URL = 'https://mock-rpc.veilpay.test';
const ANNOUNCER_ADDRESS = '0x0000000000000000000000000000000000000001';
const INTERVAL_MS = 60_000;
const DEPLOYMENT_START_BLOCK = 1_000;

/**
 * Flush the chain of awaits inside one `tick()` invocation.
 *
 * The tick body awaits, in order:
 *   getBlockNumber → queryFilter → SecureStore.setItemAsync
 *
 * `advanceTimersByTimeAsync(0)` pumps the microtask queue without moving
 * fake-timer time forward, which is exactly what we need between the
 * synchronous "schedule an interval callback" point and the assertion
 * that observes the resulting RPC call counter.
 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

describe('useStealthScanner — AppState pause/resume (Requirement 11.5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appStateChangeListener = null;

    jest.spyOn(AppState, 'addEventListener').mockImplementation((event: string, cb: any) => {
      if (event === 'change') {
        appStateChangeListener = cb;
      }
      return { remove: jest.fn(() => { appStateChangeListener = null; }) } as any;
    });

    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      get: () => 'active',
    });

    // Each successful `getBlockNumber` returns a strictly increasing head,
    // so every tick has work to do (head > cursor) and the scanner does
    // not short-circuit via the `if (fromBlock > head) return` early exit.
    let blockCounter = DEPLOYMENT_START_BLOCK;
    mockGetBlockNumber.mockImplementation(async () => {
      blockCounter += 10;
      return blockCounter;
    });
    mockQueryFilter.mockResolvedValue([]);

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stops the polling timer on background and restarts on active', async () => {
    const { unmount } = renderHook(() =>
      useStealthScanner({
        rpcUrl: RPC_URL,
        announcerAddress: ANNOUNCER_ADDRESS,
        viewingPriv: VALID_HEX,
        spendingPub: VALID_PUBKEY,
        intervalMs: INTERVAL_MS,
        deploymentStartBlock: DEPLOYMENT_START_BLOCK,
      })
    );

    // ── 1. Initial mount tick ────────────────────────────────────────────
    // The hook reads SecureStore, then fires one tick before arming the interval.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockGetBlockNumber).toHaveBeenCalledTimes(1);

    // ── 2. One interval later → second tick ──────────────────────────────
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    });
    expect(mockGetBlockNumber).toHaveBeenCalledTimes(2);

    // ── 3. Background the app ────────────────────────────────────────────
    // When the app goes to the background, the polling timer is cleared.
    // We advance time by 3 intervals — if the timer was still running,
    // we'd see 3 more ticks. Because it's paused, the count should remain 2.
    act(() => {
      if (appStateChangeListener) {
        appStateChangeListener('background');
      }
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    });
    expect(mockGetBlockNumber).toHaveBeenCalledTimes(2);

    // ── 4. Foreground the app ────────────────────────────────────────────
    // Moving back to 'active' should immediately fire a resume tick and
    // re-arm the interval.
    act(() => {
      if (appStateChangeListener) {
        appStateChangeListener('active');
      }
    });

    // The immediate resume tick should fire.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockGetBlockNumber).toHaveBeenCalledTimes(3);

    // The recurring timer is back; advancing one full interval triggers
    // exactly one more tick.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    });
    expect(mockGetBlockNumber).toHaveBeenCalledTimes(4);

    unmount();
  });
});
