/**
 * useSppBackgroundSetup — background ASP bootstrap tests.
 *
 * Guards the UX-001 silent background setup: no boot when disconnected or no
 * valid Stellar address, mainnet-without-SPP guard (no silent testnet
 * fallback), chain-key resolution (active SPP chain, else testnet recovery
 * chain, else nothing), one-shot boot per mount with the 1.5s debounce, and
 * the recovered-vs-refresh decision after ensureSppAccountReady.
 */
import { renderHook, act } from '@testing-library/react-native';

interface MockWalletState {
  address: string | null;
  isConnected: boolean;
  activeChain: { key: string } | null;
  addresses: { xlm?: string } | null;
}

let mockWalletState: MockWalletState = {
  address: null,
  isConnected: false,
  activeChain: null,
  addresses: null,
};

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: (selector: (s: MockWalletState) => unknown) => selector(mockWalletState),
}));

const mockSppConfig: {
  isSppEnabledForChain: (key: string) => boolean;
  SPP_MAINNET: string | null;
} = {
  isSppEnabledForChain: (key: string) => key === 'stellar',
  SPP_MAINNET: 'spp-mainnet-registry',
};

jest.mock('../../constants/spp', () => ({
  isSppEnabledForChain: (key: string) => mockSppConfig.isSppEnabledForChain(key),
  get SPP_MAINNET() {
    return mockSppConfig.SPP_MAINNET;
  },
  SPP_TESTNET: 'spp-testnet',
}));

const mockSppUtils = {
  ensureSppAccountReady: jest.fn(async () => undefined),
  refreshPrivateBalanceSmart: jest.fn(async () => ({
    message: 'recovered',
    recovered: true,
    amount: '0',
    nativeAmount: '0',
  })),
  hasRecoveredThisSession: jest.fn(() => true),
};

jest.mock('../../utils/stellarSpp', () => ({
  ensureSppAccountReady: (...a: Parameters<typeof mockSppUtils.ensureSppAccountReady>) =>
    mockSppUtils.ensureSppAccountReady(...a),
  refreshPrivateBalanceSmart: (
    ...a: Parameters<typeof mockSppUtils.refreshPrivateBalanceSmart>
  ) => mockSppUtils.refreshPrivateBalanceSmart(...a),
  hasRecoveredThisSession: (
    ...a: Parameters<typeof mockSppUtils.hasRecoveredThisSession>
  ) => mockSppUtils.hasRecoveredThisSession(...a),
}));

import { useSppBackgroundSetup } from '../useSppBackgroundSetup';

const STELLAR_ADDRESS = 'G' + 'A'.repeat(55);

function resetWallet(overrides: Partial<MockWalletState> = {}) {
  mockWalletState = {
    address: null,
    isConnected: false,
    activeChain: null,
    addresses: null,
    ...overrides,
  };
  mockSppConfig.isSppEnabledForChain = (key) => key === 'stellar';
  mockSppConfig.SPP_MAINNET = 'spp-mainnet-registry';
  mockSppUtils.ensureSppAccountReady.mockClear().mockResolvedValue(undefined);
  mockSppUtils.refreshPrivateBalanceSmart.mockClear().mockResolvedValue({
    message: 'recovered',
    recovered: true,
    amount: '0',
    nativeAmount: '0',
  });
  mockSppUtils.hasRecoveredThisSession.mockClear().mockReturnValue(true);
}

function renderSetup() {
  return renderHook(() => useSppBackgroundSetup());
}

async function fireBoot() {
  await act(async () => {
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useSppBackgroundSetup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetWallet();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does nothing while disconnected', async () => {
    resetWallet({ address: STELLAR_ADDRESS, isConnected: false });
    renderSetup();
    await fireBoot();
    expect(mockSppUtils.ensureSppAccountReady).not.toHaveBeenCalled();
  });

  it('does nothing without a valid Stellar address (address nor addresses.xlm)', async () => {
    resetWallet({
      address: '0x1234',
      isConnected: true,
      activeChain: { key: 'stellar' },
      addresses: { xlm: 'too-short' },
    });
    renderSetup();
    await fireBoot();
    expect(mockSppUtils.ensureSppAccountReady).not.toHaveBeenCalled();
  });

  it('boots with addresses.xlm when present (preferred over address)', async () => {
    resetWallet({
      address: STELLAR_ADDRESS.replace(/A$/, 'B'),
      isConnected: true,
      activeChain: { key: 'stellar' },
      addresses: { xlm: STELLAR_ADDRESS },
    });
    renderSetup();
    await fireBoot();
    expect(mockSppUtils.ensureSppAccountReady).toHaveBeenCalledWith(
      'stellar',
      STELLAR_ADDRESS
    );
  });

  it('boots with the wallet address when addresses.xlm is absent', async () => {
    resetWallet({
      address: STELLAR_ADDRESS,
      isConnected: true,
      activeChain: { key: 'stellar' },
      addresses: {},
    });
    renderSetup();
    await fireBoot();
    expect(mockSppUtils.ensureSppAccountReady).toHaveBeenCalledWith(
      'stellar',
      STELLAR_ADDRESS
    );
  });

  it('mainnet stellar without SPP_MAINNET configured: no boot (no silent testnet mix)', async () => {
    resetWallet({
      address: STELLAR_ADDRESS,
      isConnected: true,
      activeChain: { key: 'stellar' },
    });
    mockSppConfig.SPP_MAINNET = null;
    renderSetup();
    await fireBoot();
    expect(mockSppUtils.ensureSppAccountReady).not.toHaveBeenCalled();
  });

  it('non-SPP active chain falls back to the testnet recovery chain', async () => {
    resetWallet({
      address: STELLAR_ADDRESS,
      isConnected: true,
      activeChain: { key: 'ethereum' },
    });
    mockSppConfig.isSppEnabledForChain = (key) => key === 'stellar' || key === 'stellar-testnet';
    renderSetup();
    await fireBoot();
    expect(mockSppUtils.ensureSppAccountReady).toHaveBeenCalledWith(
      'stellar-testnet',
      STELLAR_ADDRESS
    );
  });

  it('no SPP-enabled chain at all: no boot', async () => {
    resetWallet({
      address: STELLAR_ADDRESS,
      isConnected: true,
      activeChain: { key: 'ethereum' },
    });
    mockSppConfig.isSppEnabledForChain = () => false;
    renderSetup();
    await fireBoot();
    expect(mockSppUtils.ensureSppAccountReady).not.toHaveBeenCalled();
  });

  it('refreshes the private balance when nothing recovered this session', async () => {
    resetWallet({
      address: STELLAR_ADDRESS,
      isConnected: true,
      activeChain: { key: 'stellar' },
    });
    mockSppUtils.hasRecoveredThisSession.mockReturnValue(false);
    renderSetup();
    await fireBoot();
    expect(mockSppUtils.refreshPrivateBalanceSmart).toHaveBeenCalledWith(
      'stellar',
      STELLAR_ADDRESS,
      { force: false }
    );
  });

  it('skips the refresh when recovery already ran this session', async () => {
    resetWallet({
      address: STELLAR_ADDRESS,
      isConnected: true,
      activeChain: { key: 'stellar' },
    });
    mockSppUtils.hasRecoveredThisSession.mockReturnValue(true);
    renderSetup();
    await fireBoot();
    expect(mockSppUtils.refreshPrivateBalanceSmart).not.toHaveBeenCalled();
  });

  it('ensureSppAccountReady throwing is swallowed (silent failure)', async () => {
    resetWallet({
      address: STELLAR_ADDRESS,
      isConnected: true,
      activeChain: { key: 'stellar' },
    });
    mockSppUtils.ensureSppAccountReady.mockRejectedValue(new Error('pool down'));
    renderSetup();
    await act(async () => {
      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // No unhandled rejection → test passes by not throwing.
  });

  it('unmounting before the debounce clears the boot timer', async () => {
    resetWallet({
      address: STELLAR_ADDRESS,
      isConnected: true,
      activeChain: { key: 'stellar' },
    });
    const { unmount } = renderSetup();
    unmount();
    await fireBoot();
    expect(mockSppUtils.ensureSppAccountReady).not.toHaveBeenCalled();
  });

  it('boots only once per mount even if deps change afterwards', async () => {
    resetWallet({
      address: STELLAR_ADDRESS,
      isConnected: true,
      activeChain: { key: 'stellar' },
    });
    const { rerender } = renderSetup();
    await fireBoot();
    expect(mockSppUtils.ensureSppAccountReady).toHaveBeenCalledTimes(1);

    // Same mount, new address → didBoot guard blocks a second boot.
    // (Mutate state directly: resetWallet() would clear the call log.)
    mockWalletState = {
      ...mockWalletState,
      address: STELLAR_ADDRESS.replace(/A$/, 'C'),
    };
    await act(async () => {
      rerender(undefined as never);
      jest.advanceTimersByTime(60000);
      await Promise.resolve();
    });
    expect(mockSppUtils.ensureSppAccountReady).toHaveBeenCalledTimes(1);
  });
});
