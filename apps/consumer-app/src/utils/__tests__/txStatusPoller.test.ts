/**
 * Andrej Karpathy first-principles style unit tests for txStatusPoller.ts
 * Thoroughly covers instant pending state registration, exponential polling loop, abort signal triggers, and timeouts.
 */

const mockAddTransaction = jest.fn();

jest.mock('../../stores/transactionStore', () => ({
  useTransactionStore: {
    getState: () => ({
      addTransaction: mockAddTransaction,
    }),
  },
}));

jest.mock('../transactions', () => ({
  waitForTransaction: jest.fn(),
}));

jest.mock('../sentry', () => ({
  captureError: jest.fn(),
  captureMessage: jest.fn(),
}));

import { waitForTransaction } from '../transactions';
import { captureMessage } from '../sentry';
import { pollTransactionStatus, createPollAbortController } from '../txStatusPoller';

describe('txStatusPoller utility tests', () => {
  const defaultOpts = {
    chainKey: 'ethereum',
    txHash: '0x1234567890abcdef',
    fromAddress: '0xsender',
    toAddress: '0xrecipient',
    amountEth: '0.5',
    tokenSymbol: 'ETH',
    networkName: 'Ethereum',
    privacyLevel: 'standard' as const,
    feeEth: '0.001',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('immediately registers a pending transaction record and polls for success', async () => {
    (waitForTransaction as jest.Mock).mockResolvedValueOnce({
      status: 'confirmed',
      gasUsed: '0.00085',
    });

    const statusChangeMock = jest.fn();
    const pollPromise = pollTransactionStatus({
      ...defaultOpts,
      onStatusChange: statusChangeMock,
    });

    // Verify pending transaction was added immediately before any timer runs
    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: defaultOpts.txHash,
        status: 'pending',
        amount: '0.5',
        tokenSymbol: 'ETH',
        network: 'Ethereum',
      })
    );

    // Advance timer past the first poll interval (2000ms) to trigger first check
    await jest.advanceTimersByTimeAsync(2000);

    const result = await pollPromise;

    // Verify final states
    expect(result.status).toBe('completed');
    expect(result.record.status).toBe('completed');
    expect(result.record.fee).toBe('0.00085'); // updated with actual gas fee
    expect(result.timedOut).toBe(false);

    expect(statusChangeMock).toHaveBeenCalledWith('completed', result.record);
    expect(mockAddTransaction).toHaveBeenLastCalledWith(result.record);
  });

  it('correctly handles transaction failure on-chain', async () => {
    (waitForTransaction as jest.Mock).mockResolvedValueOnce({
      status: 'failed',
      gasUsed: '0.001',
    });

    const pollPromise = pollTransactionStatus(defaultOpts);

    await jest.advanceTimersByTimeAsync(2000);

    const result = await pollPromise;

    expect(result.status).toBe('failed');
    expect(result.record.status).toBe('failed');
    expect(result.timedOut).toBe(false);
  });

  it('backs off exponentially and retries on transient RPC failures', async () => {
    (waitForTransaction as jest.Mock)
      .mockRejectedValueOnce(new Error('RPC Timeout')) // attempt 1: fails
      .mockResolvedValueOnce({
        status: 'confirmed',
        gasUsed: '0.00085',
      }); // attempt 2: succeeds

    const pollPromise = pollTransactionStatus(defaultOpts);

    // Initial poll runs after 2000ms
    await jest.advanceTimersByTimeAsync(2000);

    // Should have logged a warning message to Sentry
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('[tx-poller] RPC error'),
      'warning'
    );

    // Backoff multiplier is 1.5x, so next delay is 3000ms
    await jest.advanceTimersByTimeAsync(3000);

    const result = await pollPromise;
    expect(result.status).toBe('completed');
    expect(waitForTransaction).toHaveBeenCalledTimes(2);
  });

  it('respects AbortSignal cancellation during sleep or wait loops', async () => {
    const controller = createPollAbortController();
    const pollPromise = pollTransactionStatus({
      ...defaultOpts,
      signal: controller.signal,
    });

    // Abort before the first poll interval executes
    controller.abort();

    await jest.advanceTimersByTimeAsync(2000);

    const result = await pollPromise;

    expect(result.status).toBe('pending');
    expect(result.timedOut).toBe(true);
    expect(waitForTransaction).not.toHaveBeenCalled();
  });

  it('times out safely after MAX_POLL_DURATION_MS (120s) returning pending status', async () => {
    // Keep returning null/not-confirmed status to force a timeout
    (waitForTransaction as jest.Mock).mockResolvedValue({
      status: 'pending',
    });

    const pollPromise = pollTransactionStatus(defaultOpts);

    // Walk forward in time to hit the 120s mark.
    // Delays will cap at MAX_POLL_INTERVAL_MS (8000ms).
    for (let i = 0; i < 20; i++) {
      await jest.advanceTimersByTimeAsync(8000);
    }

    const result = await pollPromise;

    expect(result.status).toBe('pending');
    expect(result.timedOut).toBe(true);
    expect(captureMessage).toHaveBeenLastCalledWith(
      expect.stringContaining('[tx-poller] Timeout polling'),
      'warning'
    );
  });
});
