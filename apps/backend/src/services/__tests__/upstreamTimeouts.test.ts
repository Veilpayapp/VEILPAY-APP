/**
 * D4: upstream fetches (Horizon, GoldRush) must carry a ~10s abort deadline —
 * a hung upstream connection previously parked verifiers/indexers forever.
 *
 * AbortSignal.timeout is stubbed to an already-aborted signal and global.fetch
 * is replaced with a mock that rejects exactly the way Node's fetch rejects on
 * abort, so the abort path is exercised in milliseconds instead of 10s.
 */

import {
  fetchStellarPayments,
  verifyStellarPayment,
  StellarHorizonError,
} from '../stellarHorizon';
import { fetchGoldrushTransactions, GoldrushError } from '../goldrush';

jest.mock('../../config', () => ({
  config: {
    rpc: {
      goldrushApiKey: 'test-api-key',
    },
  },
}));

function abortedError(): Error {
  // Shape of the DOMException Node's fetch rejects with on abort.
  return Object.assign(new Error('The operation was aborted due to timeout'), {
    name: 'TimeoutError',
  });
}

describe('upstream fetch timeouts (D4)', () => {
  const originalFetch = global.fetch;
  let timeoutSpy: jest.SpyInstance;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(AbortSignal.abort());
    fetchMock = jest.fn(
      (_url: unknown, init: { signal?: AbortSignal } | undefined) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(abortedError());
            return;
          }
          signal?.addEventListener('abort', () => reject(abortedError()));
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    timeoutSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('fetchStellarPayments passes a 10s abort signal and surfaces the abort as StellarHorizonError', async () => {
    await expect(
      fetchStellarPayments('stellar-testnet', 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX')
    ).rejects.toBeInstanceOf(StellarHorizonError);

    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/payments'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('verifyStellarPayment passes a 10s abort signal and returns the existing error path on abort', async () => {
    const result = await verifyStellarPayment({
      chainKey: 'stellar-testnet',
      txHash: 'a'.repeat(64),
      paymentAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX',
      amount: '1',
      tokenSymbol: 'XLM',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Horizon network error/);
    }
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/transactions/'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('fetchGoldrushTransactions passes a 10s abort signal and surfaces the abort as GoldrushError', async () => {
    await expect(fetchGoldrushTransactions('ethereum', '0xSomeAddress')).rejects.toBeInstanceOf(
      GoldrushError
    );

    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api.covalenthq.com'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
