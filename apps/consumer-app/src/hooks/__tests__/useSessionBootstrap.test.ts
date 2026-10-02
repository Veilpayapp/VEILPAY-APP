import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useSessionBootstrap } from '../useSessionBootstrap';
import { useWalletStore } from '../../stores/walletStore';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockWalletState: any = {
  hasHydrated: false,
  isConnected: false,
  address: null,
  chainType: null,
  addresses: {},
  activeChain: null,
  connect: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: Object.assign(
    (selector?: any) => (typeof selector === 'function' ? selector(mockWalletState) : mockWalletState),
    { getState: () => mockWalletState }
  ),
  validateAddress: (address: string, chainType: string) =>
    chainType === 'xlm' ? /^G[A-Z2-7]{55}$/.test(address) : /^0x[0-9a-fA-F]{40}$/.test(address),
}));

jest.mock('../../stores/transactionStore', () => ({
  useTransactionStore: Object.assign((selector?: any) => selector?.({}) ?? {}, {
    getState: () => ({}),
  }),
  useTransactions: () => [],
}));

const mockIsWalletInitialized = jest.fn();
const mockGetStoredMnemonic = jest.fn();
jest.mock('../../utils/transactions', () => ({
  isWalletInitialized: (...args: unknown[]) => mockIsWalletInitialized(...args),
  getStoredMnemonic: (...args: unknown[]) => mockGetStoredMnemonic(...args),
}));

const mockDeriveAddresses = jest.fn();
jest.mock('../../utils/multiChainDerivation', () => ({
  deriveAddressesForAllChains: (...args: unknown[]) => mockDeriveAddresses(...args),
}));

const mockCaptureError = jest.fn();
const mockCaptureMessage = jest.fn();
jest.mock('../../utils/sentry', () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));

const mockGetActiveSessions = jest.fn();
jest.mock('../../utils/walletConnectSession', () => ({
  getActiveSessions: (...args: unknown[]) => mockGetActiveSessions(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
const EVM_ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const XLM_ADDR = `G${'A'.repeat(55)}`;

const resetState = (over: Record<string, unknown> = {}) => {
  Object.assign(mockWalletState, {
    hasHydrated: false,
    isConnected: false,
    address: null,
    chainType: null,
    addresses: {},
    activeChain: null,
    ...over,
  });
};

const connectMock = () => mockWalletState.connect as jest.Mock;
const disconnectMock = () => mockWalletState.disconnect as jest.Mock;

describe('useSessionBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetState();
    mockIsWalletInitialized.mockResolvedValue(true);
    mockGetStoredMnemonic.mockResolvedValue(null);
    mockDeriveAddresses.mockResolvedValue({});
    mockGetActiveSessions.mockResolvedValue([]);
  });

  it('stays idle until the wallet store hydrates', async () => {
    const { result } = renderHook(() => useSessionBootstrap());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isSessionReady).toBe(false);
    expect(mockIsWalletInitialized).not.toHaveBeenCalled();
  });

  it('fast-paths a valid connected session when the wallet is initialized', async () => {
    resetState({
      hasHydrated: true,
      isConnected: true,
      address: EVM_ADDR,
      chainType: 'evm',
      addresses: { evm: EVM_ADDR, xlm: XLM_ADDR, svm: 'sol1', btc: 'btc1' },
    });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(disconnectMock()).not.toHaveBeenCalled();
    expect(mockGetStoredMnemonic).not.toHaveBeenCalled();
  });

  it('disconnects and reports ready when no mnemonic is stored', async () => {
    resetState({ hasHydrated: true });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(mockGetStoredMnemonic).toHaveBeenCalled();
    expect(disconnectMock()).toHaveBeenCalled();
    expect(connectMock()).not.toHaveBeenCalled();
  });

  it('restores the session from the stored mnemonic', async () => {
    mockGetStoredMnemonic.mockResolvedValue('word '.repeat(12).trim());
    const derived = { evm: EVM_ADDR, xlm: XLM_ADDR, svm: 'sol1', btc: 'btc1' };
    mockDeriveAddresses.mockResolvedValue(derived);
    resetState({
      hasHydrated: true,
      chainType: 'evm',
      activeChain: { key: 'ethereum' },
    });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(connectMock()).toHaveBeenCalledWith(EVM_ADDR, 'evm', 'ethereum', derived);
  });

  it('falls back to the evm address when the stored chain type is absent', async () => {
    mockGetStoredMnemonic.mockResolvedValue('mnemonic');
    mockDeriveAddresses.mockResolvedValue({ evm: EVM_ADDR });
    resetState({ hasHydrated: true, chainType: null, activeChain: null });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(connectMock()).toHaveBeenCalledWith(EVM_ADDR, 'evm', undefined, { evm: EVM_ADDR });
  });

  it('disconnects when derivation yields no usable address', async () => {
    mockGetStoredMnemonic.mockResolvedValue('mnemonic');
    mockDeriveAddresses.mockResolvedValue({});
    resetState({ hasHydrated: true });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(connectMock()).not.toHaveBeenCalled();
    expect(disconnectMock()).toHaveBeenCalled();
  });

  it('clears a stale connection before restoring', async () => {
    mockGetStoredMnemonic.mockResolvedValue('mnemonic');
    mockDeriveAddresses.mockResolvedValue({ evm: EVM_ADDR, xlm: XLM_ADDR, svm: 's', btc: 'b' });
    resetState({
      hasHydrated: true,
      isConnected: true,
      address: 'not-a-valid-address',
      chainType: 'evm',
      addresses: { evm: EVM_ADDR },
    });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(disconnectMock()).toHaveBeenCalled();
    expect(connectMock()).toHaveBeenCalled();
  });

  it('keeps a live external WalletConnect session when no local wallet exists', async () => {
    mockIsWalletInitialized.mockResolvedValue(false);
    mockGetActiveSessions.mockResolvedValue([
      { namespaces: { eip155: { accounts: [`eip155:1:${EVM_ADDR}`] } } },
    ]);
    resetState({
      hasHydrated: true,
      isConnected: true,
      address: EVM_ADDR,
      chainType: 'evm',
      addresses: { evm: EVM_ADDR },
    });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(mockGetActiveSessions).toHaveBeenCalled();
    expect(disconnectMock()).not.toHaveBeenCalled();
  });

  it('disconnects an expired external WalletConnect session', async () => {
    mockIsWalletInitialized.mockResolvedValue(false);
    mockGetActiveSessions.mockResolvedValue([
      { namespaces: { eip155: { accounts: ['eip155:1:0xdeadbeef'] } } },
    ]);
    resetState({
      hasHydrated: true,
      isConnected: true,
      address: EVM_ADDR,
      chainType: 'evm',
      addresses: { evm: EVM_ADDR },
    });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('External wallet session expired'),
      'warning'
    );
    expect(disconnectMock()).toHaveBeenCalled();
  });

  it('captures WalletConnect session check failures', async () => {
    mockIsWalletInitialized.mockResolvedValue(false);
    mockGetActiveSessions.mockRejectedValue(new Error('wc relay down'));
    resetState({
      hasHydrated: true,
      isConnected: true,
      address: EVM_ADDR,
      chainType: 'evm',
      addresses: { evm: EVM_ADDR },
    });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ scope: 'wallet-session-bootstrap' })
    );
    // The session state is still valid, so no disconnect.
    expect(disconnectMock()).not.toHaveBeenCalled();
  });

  it('disconnects a partially-connected wallet with no local seed', async () => {
    mockIsWalletInitialized.mockResolvedValue(false);
    resetState({ hasHydrated: true, isConnected: true, address: EVM_ADDR, chainType: null });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(disconnectMock()).toHaveBeenCalled();
  });

  it('bootstraps a disconnected wallet with no local seed without disconnecting', async () => {
    mockIsWalletInitialized.mockResolvedValue(false);
    resetState({ hasHydrated: true });
    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(disconnectMock()).not.toHaveBeenCalled();
    expect(connectMock()).not.toHaveBeenCalled();
  });

  it('retries with backoff and then continues disconnected after exhausting retries', async () => {
    mockIsWalletInitialized.mockRejectedValue(new Error('secure store locked'));
    resetState({ hasHydrated: true });
    const { result } = renderHook(() => useSessionBootstrap());

    await waitFor(() => expect(mockCaptureError).toHaveBeenCalled());
    await act(async () => {
      jest.advanceTimersByTime(2100); // first backoff: 2s
    });
    await waitFor(() => expect(result.current.bootstrapRetryCount).toBe(2));
    await act(async () => {
      jest.advanceTimersByTime(4100); // second backoff: 4s
    });

    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('All 3 attempts failed'),
      'error'
    );
    expect(disconnectMock()).toHaveBeenCalled();
    expect(mockIsWalletInitialized.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('recovers when a retry succeeds', async () => {
    mockIsWalletInitialized
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(true);
    mockGetStoredMnemonic.mockResolvedValue('mnemonic');
    const derived = { evm: EVM_ADDR, xlm: XLM_ADDR, svm: 's', btc: 'b' };
    mockDeriveAddresses.mockResolvedValue(derived);
    resetState({ hasHydrated: true });

    const { result } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(mockCaptureError).toHaveBeenCalled());
    await act(async () => {
      jest.advanceTimersByTime(2100);
    });
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    expect(connectMock()).toHaveBeenCalled();
    expect(result.current.bootstrapRetryCount).toBe(1);
  });

  it('does not bootstrap twice', async () => {
    resetState({ hasHydrated: true });
    const { result, rerender } = renderHook(() => useSessionBootstrap());
    await waitFor(() => expect(result.current.isSessionReady).toBe(true));
    const calls = mockIsWalletInitialized.mock.calls.length;
    rerender({});
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockIsWalletInitialized.mock.calls.length).toBe(calls);
  });
});
