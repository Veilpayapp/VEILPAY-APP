import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useBalancePolling } from '../useBalancePolling';
import { useWalletStore, useWalletAddress, useActiveChain } from '../../stores/walletStore';

const mockSetBalance = jest.fn();
const mockSetLoadingBalance = jest.fn();

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: (selector: any) =>
    selector({ setBalance: mockSetBalance, setLoadingBalance: mockSetLoadingBalance }),
  useWalletAddress: jest.fn(),
  useActiveChain: jest.fn(),
}));

const mockFetchNativeBalance = jest.fn();
jest.mock('../../utils/balanceFetcher', () => ({
  fetchNativeBalance: (...args: unknown[]) => mockFetchNativeBalance(...args),
}));

const mockGetTokenMarketQuote = jest.fn();
jest.mock('../../utils/marketData', () => ({
  getTokenMarketQuote: (...args: unknown[]) => mockGetTokenMarketQuote(...args),
}));

const EVM_CHAIN: any = { key: 'ethereum', symbol: 'ETH', name: 'Ethereum', type: 'evm' };

const okResult = {
  balanceFormatted: '1.0',
  symbol: 'ETH',
  lastUpdated: 1700000000000,
  source: 'rpc' as const,
  error: null,
};

describe('useBalancePolling', () => {
  beforeAll(() => {
    // The RN jest environment leaves AppState.currentState undefined; the
    // hook only starts polling when it is 'active'.
    Object.defineProperty(AppState, 'currentState', {
      value: 'active',
      configurable: true,
      writable: true,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (useWalletAddress as unknown as jest.Mock).mockReturnValue('0x123');
    (useActiveChain as unknown as jest.Mock).mockReturnValue(EVM_CHAIN);
    mockFetchNativeBalance.mockResolvedValue(okResult);
    mockGetTokenMarketQuote.mockResolvedValue({ price: 3000 });
    // The RN jest AppState mock returns undefined from addEventListener; the
    // hook's effect cleanup calls sub.remove().
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(() => ({ remove: jest.fn() } as any));
  });

  afterEach(() => {
    (AppState.addEventListener as jest.Mock).mockRestore?.();
  });

  it('fetches the balance on mount and reports fiat value', async () => {
    const onBalanceUpdate = jest.fn();
    const { result } = renderHook(() => useBalancePolling({ onBalanceUpdate }));

    await waitFor(() => expect(result.current.balance).toBe('1.0'));
    expect(result.current.balanceUsd).toBe('3000.00');
    expect(result.current.error).toBeNull();
    expect(result.current.isStale).toBe(false);
    expect(result.current.lastUpdated).toEqual(new Date(1700000000000));
    expect(mockSetBalance).toHaveBeenCalledWith('1.0', '3000.00');
    expect(onBalanceUpdate).toHaveBeenCalledWith('1.0', '3000.00');
    expect(mockFetchNativeBalance).toHaveBeenCalledWith('0x123', 'ethereum');
  });

  it('surfaces fetch errors via status and onError', async () => {
    const onError = jest.fn();
    mockFetchNativeBalance.mockResolvedValue({ ...okResult, error: 'rpc down' });
    const { result } = renderHook(() => useBalancePolling({ onError }));

    await waitFor(() => expect(result.current.error).toBe('rpc down'));
    expect(result.current.balance).toBeNull();
    expect(result.current.isStale).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'rpc down' }));
    expect(mockSetLoadingBalance).toHaveBeenCalledWith(false);
  });

  it('falls back to 0.00 fiat when the market quote fails', async () => {
    mockGetTokenMarketQuote.mockRejectedValue(new Error('price feed down'));
    const { result } = renderHook(() => useBalancePolling());

    await waitFor(() => expect(result.current.balance).toBe('1.0'));
    expect(result.current.balanceUsd).toBe('0.00');
  });

  it('handles thrown fetch failures', async () => {
    const onError = jest.fn();
    mockFetchNativeBalance.mockRejectedValue(new Error('socket hangup'));
    const { result } = renderHook(() => useBalancePolling({ onError }));

    await waitFor(() => expect(result.current.error).toBe('socket hangup'));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'socket hangup' }));
  });

  it('normalizes non-Error throwables', async () => {
    mockFetchNativeBalance.mockRejectedValue('plain string failure');
    const { result } = renderHook(() => useBalancePolling());

    await waitFor(() => expect(result.current.error).toBe('Failed to fetch balance'));
  });

  it('marks fallback-sourced balances as stale', async () => {
    mockFetchNativeBalance.mockResolvedValue({ ...okResult, source: 'fallback' });
    const { result } = renderHook(() => useBalancePolling());

    await waitFor(() => expect(result.current.balance).toBe('1.0'));
    expect(result.current.isStale).toBe(true);
  });

  it('does not fetch without an address', async () => {
    (useWalletAddress as unknown as jest.Mock).mockReturnValue(null);
    renderHook(() => useBalancePolling());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetchNativeBalance).not.toHaveBeenCalled();
  });

  it('does not start when disabled', async () => {
    renderHook(() => useBalancePolling({ enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetchNativeBalance).not.toHaveBeenCalled();
  });

  it('polls on the configured interval and stops cleanly', async () => {
    const { result } = renderHook(() =>
      useBalancePolling({ intervalMs: 5000, initialFetch: false })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetchNativeBalance).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockFetchNativeBalance).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.stop();
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(mockFetchNativeBalance).toHaveBeenCalledTimes(1);
  });

  it('refresh() refetches on demand', async () => {
    const { result } = renderHook(() => useBalancePolling({ initialFetch: false }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockFetchNativeBalance).toHaveBeenCalledTimes(1);
  });

  it('start() is idempotent while polling', async () => {
    const { result } = renderHook(() => useBalancePolling({ intervalMs: 5000 }));
    await waitFor(() => expect(mockFetchNativeBalance).toHaveBeenCalledTimes(1));

    await act(async () => {
      result.current.start();
      result.current.start();
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    // A second interval would have fired two extra fetches.
    expect(mockFetchNativeBalance).toHaveBeenCalledTimes(2);
  });

  it('pauses in the background and resumes when active', async () => {
    let appStateHandler: ((state: string) => void) | null = null;
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event: string, handler: any) => {
        appStateHandler = handler;
        return { remove: jest.fn() } as any;
      });

    renderHook(() => useBalancePolling({ intervalMs: 5000, initialFetch: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetchNativeBalance).not.toHaveBeenCalled();
    expect(appStateHandler).not.toBeNull();

    await act(async () => {
      appStateHandler!('background');
    });
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(mockFetchNativeBalance).not.toHaveBeenCalled();

    await act(async () => {
      appStateHandler!('active');
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockFetchNativeBalance).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('ignores fetch results after unmount', async () => {
    let resolveFetch: (value: any) => void = () => {};
    mockFetchNativeBalance.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; })
    );
    const { result, unmount } = renderHook(() => useBalancePolling());

    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      resolveFetch(okResult);
      await Promise.resolve();
    });
    expect(result.current.balance).toBeNull();
    expect(mockSetBalance).not.toHaveBeenCalled();
  });
});
