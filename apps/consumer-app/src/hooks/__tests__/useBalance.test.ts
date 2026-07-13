/**
 * useBalance — locks the balance-card flicker regression and refresh guards.
 *
 * The card used to flash a skeleton on every 30s background poll because
 * `refresh()` always set `isLoading=true`. Silent refreshes must update data
 * without flipping the loading skeleton; only first load / chain switch should.
 */

const mockSetBalance = jest.fn();
const mockSetLoadingBalance = jest.fn();
const mockFetchNativeBalance = jest.fn();
const mockFetchTokenBalancesForChain = jest.fn();
const mockGetTokenMarketQuote = jest.fn();
const mockGetFiatExchangeRate = jest.fn();

let mockAddress: string | null = '0x1111111111111111111111111111111111111111';
let mockActiveChain: { key: string; type: string; symbol: string } | null = {
  key: 'ethereum',
  type: 'evm',
  symbol: 'ETH',
};

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: (selector: any) => {
    const state = {
      address: mockAddress,
      activeChain: mockActiveChain,
      setBalance: mockSetBalance,
      setLoadingBalance: mockSetLoadingBalance,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (selector: any) => {
    const state = { nativeCurrency: 'USD' };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('../../utils/balanceFetcher', () => ({
  fetchNativeBalance: (...args: unknown[]) => mockFetchNativeBalance(...args),
  fetchTokenBalancesForChain: (...args: unknown[]) =>
    mockFetchTokenBalancesForChain(...args),
}));

jest.mock('../../utils/marketData', () => ({
  getTokenMarketQuote: (...args: unknown[]) => mockGetTokenMarketQuote(...args),
}));

jest.mock('../../utils/priceFeed', () => ({
  getFiatExchangeRate: (...args: unknown[]) => mockGetFiatExchangeRate(...args),
}));

jest.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}));

import { act, renderHook } from '@testing-library/react-native';
import { useBalance } from '../useBalance';

describe('useBalance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddress = '0x1111111111111111111111111111111111111111';
    mockActiveChain = { key: 'ethereum', type: 'evm', symbol: 'ETH' };
    mockFetchNativeBalance.mockResolvedValue({
      balance: '1000000000000000000',
      balanceFormatted: '1.0',
      symbol: 'ETH',
      decimals: 18,
      lastUpdated: Date.now(),
      source: 'rpc',
    });
    mockFetchTokenBalancesForChain.mockResolvedValue([]);
    mockGetTokenMarketQuote.mockResolvedValue({ price: 2000, source: 'mock', isStale: false });
    mockGetFiatExchangeRate.mockResolvedValue(1);
  });

  it('shows loading skeleton on initial fetch, then clears it', async () => {
    const { result } = renderHook(() => useBalance(false));

    // Initial effect kicks off a non-silent refresh
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // After settle, loading is false and balance is populated
    expect(result.current.isLoading).toBe(false);
    expect(result.current.nativeBalance?.balanceFormatted).toBe('1.0');
    expect(mockSetLoadingBalance).toHaveBeenCalledWith(true);
    expect(mockSetLoadingBalance).toHaveBeenCalledWith(false);
  });

  it('silent refresh does not flip isLoading / setLoadingBalance (no flicker)', async () => {
    const { result } = renderHook(() => useBalance(false));

    // Wait for initial load
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    mockSetLoadingBalance.mockClear();

    // Advance past MIN_REFRESH_INTERVAL_MS (5s) so the throttle does not no-op
    jest.useFakeTimers({ advanceTimers: true });
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });

    mockFetchNativeBalance.mockResolvedValueOnce({
      balance: '2000000000000000000',
      balanceFormatted: '2.0',
      symbol: 'ETH',
      decimals: 18,
      lastUpdated: Date.now(),
      source: 'rpc',
    });

    await act(async () => {
      await result.current.refresh({ silent: true });
    });

    // Data updated…
    expect(result.current.nativeBalance?.balanceFormatted).toBe('2.0');
    // …but skeleton never re-armed (the flicker regression).
    expect(mockSetLoadingBalance).not.toHaveBeenCalledWith(true);
    expect(result.current.isLoading).toBe(false);

    jest.useRealTimers();
  });

  it('throttles non-context refreshes under 5s', async () => {
    const { result } = renderHook(() => useBalance(false));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const callsAfterInitial = mockFetchNativeBalance.mock.calls.length;

    await act(async () => {
      await result.current.refresh({ silent: true });
    });

    // Same context, under 5s → no second fetch
    expect(mockFetchNativeBalance.mock.calls.length).toBe(callsAfterInitial);
  });
});
