import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { SCREENS } from '../../constants/screens';
import { SPP_TESTNET } from '../../constants/spp';
import { useSettingsStore } from '../../stores/settingsStore';

// Mock @react-native-community/netinfo before any import that uses it
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({ type: 'wifi', isConnected: true, isInternetReachable: true })),
  },
  useNetInfo: () => ({ type: 'wifi', isConnected: true, isInternetReachable: true }),
}));

// Home uses useFocusEffect; unit tests render outside NavigationContainer.
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useFocusEffect: (effect: () => void | (() => void)) => {
      // Run once on mount, matching a focused screen for tests.
      R.useEffect(() => {
        const cleanup = effect();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [effect]);
    },
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const mockShowToast = jest.fn();
const mockOpenExternalUrl = jest.fn();
const mockSetActiveChain = jest.fn();
const mockRefreshTransactions = jest.fn();
const mockRefreshBalance = jest.fn();

const mockWalletState: any = {
  address: '0x1234567890abcdef1234567890abcdef12345678',
  activeChain: { key: 'ethereum', name: 'Ethereum', type: 'evm', symbol: 'ETH' },
  setActiveChain: mockSetActiveChain,
  balance: '1.234',
  balanceUsd: '4321.00',
};

const mockTransactionState: any = {
  transactions: [],
  isLoadingTransactions: false,
  refreshTransactions: mockRefreshTransactions,
  latestTransakOrder: null,
  latestOnrampOrder: null,
  clearLatestTransakOrder: jest.fn(() => {
    mockTransactionState.latestTransakOrder = null;
  }),
  clearLatestOnrampOrder: jest.fn(() => {
    mockTransactionState.latestOnrampOrder = null;
  }),
  clearTransactions: jest.fn(),
};

jest.mock('../../stores/walletStore', () => ({
  SUPPORTED_CHAINS: [
    { key: 'ethereum', name: 'Ethereum', type: 'evm', symbol: 'ETH' },
    { key: 'polygon', name: 'Polygon', type: 'evm', symbol: 'MATIC' },
  ],
  useWalletStore: Object.assign((selector: any) => {
    if (typeof selector === 'function') {
      return selector(mockWalletState);
    }

    return mockWalletState;
  }, { getState: () => mockWalletState }),
  useThemeState: () => 'dark',
}));

jest.mock('../../stores/transactionStore', () => ({
  useTransactionStore: Object.assign((selector: any) => {
    if (typeof selector === 'function') {
      return selector(mockTransactionState);
    }
    return mockTransactionState;
  }, { getState: () => mockTransactionState }),
}));

const mockUseBalance = jest.fn((): any => ({
  isLoading: false,
  refresh: mockRefreshBalance,
  error: null,
  nativeBalance: null,
  tokenBalances: [],
  fiatRate: 1,
}));
jest.mock('../../hooks/useBalance', () => ({
  useBalance: () => mockUseBalance(),
}));

jest.mock('../../components/Toast', () => ({
  __esModule: true,
  default: () => null,
  useToast: () => ({
    visible: false,
    message: '',
    type: 'info',
    show: mockShowToast,
    hide: jest.fn(),
  }),
}));

jest.mock('../../components/Logo', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Logo: () => <View testID="mock-logo" /> };
});

jest.mock('../../components/BottomNavBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { BottomNavBar: () => <View testID="mock-bottom-nav" /> };
});

jest.mock('../../components/Icon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Icon: () => <View testID="mock-icon" /> };
});

jest.mock('../../components/Skeleton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BalanceSkeleton: () => <View testID="mock-balance-skeleton" />,
    TransactionSkeleton: () => <View testID="mock-transaction-skeleton" />,
  };
});

jest.mock('../../components/EmptyState', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    EmptyState: ({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) => (
      <TouchableOpacity onPress={onAction}>
        <Text>{title}</Text>
        <Text>{actionLabel}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../hooks/useMarketData', () => ({
  useMarketData: () => ({
    quotes: {
      ETH: {
        symbol: 'ETH',
        price: 3000,
        change24h: 1.2,
        lastUpdated: Date.now(),
        source: 'binance',
        isStale: false,
      },
    },
    isLoading: false,
    error: null,
    refresh: jest.fn(),
    lastUpdated: Date.now(),
    getQuote: (symbol: string) => ({
      symbol,
      price: 3000,
      change24h: 1.2,
      lastUpdated: Date.now(),
      source: 'binance',
      isStale: false,
    }),
  }),
}));

jest.mock('../../components/NetworkSelectorModal', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    NetworkSelectorModal: ({ visible, onSelect }: { visible: boolean; onSelect: (chain: any) => void }) =>
      visible ? (
        <View>
          <Text>SELECT NETWORK</Text>
          <TouchableOpacity onPress={() => onSelect({ key: 'polygon', name: 'Polygon', type: 'evm', symbol: 'MATIC' })}>
            <Text>POLYGON</Text>
          </TouchableOpacity>
        </View>
      ) : null,
  };
});

jest.mock('../../utils/priceFeed', () => ({
  getETHPrice: jest.fn().mockResolvedValue({ price: 3000, source: 'mock', isStale: false, change24h: 1.2 }),
  formatFiatValue: (value: number, currency?: string) => `${currency || '$'}${value.toFixed(2)}`,
}));

jest.mock('../../utils/externalLink', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

const mockCheckOrderStatus = jest.fn().mockResolvedValue(undefined);
jest.mock('../../hooks/useOnramp', () => ({
  useOnramp: () => ({ checkOrderStatus: mockCheckOrderStatus }),
}));

// SPP privacy-flow seams (dynamic imports in the screen resolve through the
// same jest registry, so these mocks intercept both the static and the
// dynamic imports).
const mockReadLocalPrivateBalanceLight = jest.fn();
const mockRefreshPrivateBalanceSmart = jest.fn();
const mockGetLastKnownPrivateAmount = jest.fn();
const mockSetLastKnownPrivateAmount = jest.fn();
const mockHasRecoveredThisSession = jest.fn();
const mockSppNativeCapabilities = jest.fn();
const mockPrepareSppOp = jest.fn();
const mockEnsureSppAccountReady = jest.fn();
const mockGatingSppBlocker = jest.fn();
const mockGetLocalPrivateBalance = jest.fn();

jest.mock('../../utils/stellarSpp', () => ({
  readLocalPrivateBalanceLight: (...args: unknown[]) => mockReadLocalPrivateBalanceLight(...args),
  refreshPrivateBalanceSmart: (...args: unknown[]) => mockRefreshPrivateBalanceSmart(...args),
  getLastKnownPrivateAmount: (...args: unknown[]) => mockGetLastKnownPrivateAmount(...args),
  setLastKnownPrivateAmount: (...args: unknown[]) => mockSetLastKnownPrivateAmount(...args),
  hasRecoveredThisSession: (...args: unknown[]) => mockHasRecoveredThisSession(...args),
  sppNativeCapabilities: () => mockSppNativeCapabilities(),
  prepareSppOp: (...args: unknown[]) => mockPrepareSppOp(...args),
  ensureSppAccountReady: (...args: unknown[]) => mockEnsureSppAccountReady(...args),
  gatingSppBlocker: (...args: unknown[]) => mockGatingSppBlocker(...args),
  getLocalPrivateBalance: (...args: unknown[]) => mockGetLocalPrivateBalance(...args),
}));

const mockGetSppAccount = jest.fn();
jest.mock('../../stores/sppAccountStore', () => ({
  getSppAccount: (...args: unknown[]) => mockGetSppAccount(...args),
}));

const { HomeDashboardScreen, formatTransactionTime, formatAddress } = require('../HomeDashboardScreen');

describe('HomeDashboardScreen', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockOpenExternalUrl.mockReset();
    mockSetActiveChain.mockReset();
    mockRefreshTransactions.mockReset();
    mockRefreshBalance.mockReset();
    mockTransactionState.latestTransakOrder = null;
    mockTransactionState.clearLatestTransakOrder.mockClear();
    mockOpenExternalUrl.mockResolvedValue(true);
  });

  it('opens swap externally and routes buy/sell in-app', async () => {
    jest.setTimeout(30000);
    const navigation = { navigate: jest.fn() };
    const route = { key: 'Home', name: 'Home', params: undefined };

    const screen = render(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);

    await waitFor(() => {
      expect(screen.getByText(/1.20%/)).toBeTruthy();
    });

    fireEvent.press(screen.getByText('SWAP'));

    await waitFor(() => {
      expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://app.uniswap.org/swap');
    });

    // Press Fiat Gateway card to open chooser modal
    fireEvent.press(screen.getByText('FIAT GATEWAY'));

    await waitFor(() => {
      expect(screen.getAllByText('FIAT GATEWAY').length).toBeGreaterThan(0);
    });

    // Press BUY CRYPTO option in the modal
    fireEvent.press(screen.getByText('BUY CRYPTO'));

    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.ONRAMP_AMOUNT, { flow: 'buy' });

    // Open Fiat Gateway chooser modal again
    fireEvent.press(screen.getByText('FIAT GATEWAY'));

    await waitFor(() => {
      expect(screen.getByText('OFF-RAMP FIAT')).toBeTruthy();
    });

    // Press OFF-RAMP FIAT option in the modal
    fireEvent.press(screen.getByText('OFF-RAMP FIAT'));

    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.ONRAMP_AMOUNT, { flow: 'sell' });
  }, 30000);

  it('switches network through the selector modal', async () => {
    const navigation = { navigate: jest.fn() };
    const route = { key: 'Home', name: 'Home', params: undefined };

    const screen = render(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);

    await waitFor(() => {
      expect(screen.getByText(/1.20%/)).toBeTruthy();
    });

    fireEvent.press(screen.getByText('ETHEREUM'));

    await waitFor(() => {
      expect(screen.getByText('SELECT NETWORK')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('POLYGON'));

    expect(mockSetActiveChain).toHaveBeenCalledWith(expect.objectContaining({ key: 'polygon' }));
    expect(mockShowToast).toHaveBeenCalledWith('Switched to Polygon', 'success');
  });

  it('clears stale Transak outcomes from the dashboard', async () => {
    mockTransactionState.latestTransakOrder = {
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      flow: 'buy',
      status: 'success',
      updatedAt: Date.now() - (24 * 60 * 60 * 1000) - 1,
      cryptoAmount: '1.25',
      cryptoCurrency: 'ETH',
      orderId: 'ORDER-123',
    };

    const navigation = { navigate: jest.fn() };
    const route = { key: 'Home', name: 'Home', params: undefined };

    const screen = render(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);

    await waitFor(() => {
      expect(mockTransactionState.clearLatestTransakOrder).toHaveBeenCalled();
    });

    screen.rerender(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);

    expect(screen.queryByText('BUY ORDER COMPLETE')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Round-5 coverage extension: the line-1 `istanbul ignore file` directive was
// removed from this screen; the suites below exercise the newly-visible
// branches (quick actions, faucet/fiat gating, order banners, SPP privacy
// mode, pull-to-refresh, pure helpers).
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHAIN: any = { key: 'ethereum', name: 'Ethereum', type: 'evm', symbol: 'ETH' };
const STELLAR_TESTNET_CHAIN: any = {
  key: 'stellar-testnet',
  name: 'Stellar Testnet',
  type: 'xlm',
  symbol: 'XLM',
  isTestnet: true,
};
const DEFAULT_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const gAddr = (fill: string) => `G${fill.repeat(55)}`;

const flushAsync = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      jest.runOnlyPendingTimers();
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    });
  }
};

const defaultBalance = (): any => ({
  isLoading: false,
  refresh: mockRefreshBalance,
  error: null,
  nativeBalance: null,
  tokenBalances: [],
  fiatRate: 1,
});

const resetDashboardState = () => {
  mockWalletState.activeChain = DEFAULT_CHAIN;
  mockWalletState.addresses = {};
  mockWalletState.address = DEFAULT_ADDRESS;
  mockTransactionState.transactions = [];
  mockTransactionState.isLoadingTransactions = false;
  mockTransactionState.latestTransakOrder = null;
  mockTransactionState.latestOnrampOrder = null;
  mockUseBalance.mockImplementation(defaultBalance);
  useSettingsStore.getState().setSelectedPrivacyAssetId(null);
  useSettingsStore.getState().setNativeCurrency('USD');
};

const resetSppMocks = () => {
  mockReadLocalPrivateBalanceLight.mockResolvedValue({ amount: '5.5' });
  mockGetLastKnownPrivateAmount.mockReturnValue('5.5');
  mockSetLastKnownPrivateAmount.mockImplementation(() => {});
  mockHasRecoveredThisSession.mockReturnValue(false);
  mockSppNativeCapabilities.mockReturnValue({ poolOps: true });
  mockPrepareSppOp.mockResolvedValue({ readyForProve: true });
  mockEnsureSppAccountReady.mockResolvedValue({ aspReady: true, keysRegistered: true, message: '' });
  mockRefreshPrivateBalanceSmart.mockResolvedValue({
    amount: '7.5',
    nativeAmount: '0',
    recovered: true,
    message: 'recovered from chain',
  });
  mockGatingSppBlocker.mockReturnValue(null);
  mockGetLocalPrivateBalance.mockResolvedValue({ amount: '0' });
  mockGetSppAccount.mockResolvedValue({
    aspInserted: true,
    aspMembershipContractId: SPP_TESTNET.aspMembershipId,
    keysRegistered: true,
    registryContractId: SPP_TESTNET.registryId,
  });
};

const renderHome = () => {
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()) };
  const route = { key: 'Home', name: 'Home', params: undefined };
  const screen = render(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);
  return { screen, navigation };
};

const firePullToRefresh = async (screen: ReturnType<typeof render>) => {
  const scrollViews = screen.UNSAFE_getAllByType(ScrollView);
  const refreshControl = scrollViews
    .map((sv) => sv.props.refreshControl)
    .find(Boolean);
  expect(refreshControl).toBeTruthy();
  await act(async () => {
    await refreshControl.props.onRefresh();
  });
};

describe('HomeDashboardScreen — quick actions and navigation', () => {
  beforeEach(() => {
    resetDashboardState();
    jest.clearAllMocks();
    mockOpenExternalUrl.mockResolvedValue(true);
  });

  it('navigates via send/receive/scan/see-all and token rows', async () => {
    mockUseBalance.mockReturnValue({
      ...defaultBalance(),
      nativeBalance: { symbol: 'ETH', name: 'Ethereum', balance: '1.0', balanceFormatted: '1.0000' },
      tokenBalances: [
        { symbol: 'USDC', tokenName: 'USD Coin', balance: '10', balanceFormatted: '10.00', tokenAddress: '0xusdc' },
      ],
    });
    const { screen, navigation } = renderHome();
    await waitFor(() => expect(screen.getByText(/1.20%/)).toBeTruthy());

    fireEvent.press(screen.getByTestId('home-action-send'));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.SEND_PAYMENT, {});

    fireEvent.press(screen.getByTestId('home-action-receive'));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.RECEIVE_QR);

    fireEvent.press(screen.getByTestId('home-action-scan'));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.QR_SCANNER);

    fireEvent.press(screen.getByText('See all'));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.TRANSACTION_HISTORY);

    fireEvent.press(screen.getByText('USDC'));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.TOKEN_DETAIL, {
      tokenSymbol: 'USDC',
      chainKey: 'ethereum',
    });
  });

  it('opens transaction details when a recent activity row is pressed', async () => {
    const tx = {
      id: 'tx-1',
      type: 'send',
      amount: '1.5',
      token: 'ETH',
      tokenSymbol: 'ETH',
      from: DEFAULT_ADDRESS,
      to: '0xdeadbeef',
      timestamp: Date.now(),
      status: 'confirmed',
      hash: '0xhash',
      displayTitle: 'Coffee',
    };
    mockTransactionState.transactions = [tx];
    const { screen, navigation } = renderHome();
    await waitFor(() => expect(screen.getByText(/Coffee/)).toBeTruthy());

    fireEvent.press(screen.getByText(/Coffee/));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.TRANSACTION_DETAILS, { transaction: tx });
  });

  it('renders transaction skeletons while history loads', async () => {
    mockTransactionState.isLoadingTransactions = true;
    mockTransactionState.transactions = [];
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getAllByTestId('mock-transaction-skeleton').length).toBeGreaterThan(0));
  });

  it('shows an info toast instead of navigating on an unsupported chain send', async () => {
    mockWalletState.activeChain = { key: 'bitcoin', name: 'Bitcoin', type: 'btc', symbol: 'BTC' };
    const { screen, navigation } = renderHome();
    await waitFor(() => expect(screen.getByTestId('home-action-send')).toBeTruthy());

    fireEvent.press(screen.getByTestId('home-action-send'));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('Send is not yet available'),
      'info'
    );
    expect(navigation.navigate).not.toHaveBeenCalledWith(SCREENS.SEND_PAYMENT, {});
  });

  it('reports when the swap link cannot be opened', async () => {
    mockOpenExternalUrl.mockResolvedValue(false);
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByText('SWAP')).toBeTruthy());

    fireEvent.press(screen.getByText('SWAP'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Swap link is unavailable right now', 'error')
    );
  });

  it('toggles balance visibility from the balance card', async () => {
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByLabelText('Hide balance')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Hide balance'));
    await waitFor(() => expect(screen.getByLabelText('Show balance')).toBeTruthy());
  });

  it('pull-to-refresh refreshes market data, balance and history', async () => {
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByText(/1.20%/)).toBeTruthy());

    await firePullToRefresh(screen);
    expect(mockRefreshBalance).toHaveBeenCalledWith({ silent: true });
    expect(mockRefreshTransactions).toHaveBeenCalledWith({ silent: true });
  });
});

describe('HomeDashboardScreen — faucet and fiat gating', () => {
  beforeEach(() => {
    resetDashboardState();
    jest.clearAllMocks();
    mockOpenExternalUrl.mockResolvedValue(true);
  });

  it('requests stellar-testnet funds via friendbot', async () => {
    mockWalletState.activeChain = STELLAR_TESTNET_CHAIN;
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByTestId('home-action-faucet')).toBeTruthy());

    fireEvent.press(screen.getByTestId('home-action-faucet'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Funds received! Updating balance...', 'success')
    );
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('friendbot.stellar.org'));
  });

  it('requests solana-devnet funds via RPC airdrop', async () => {
    mockWalletState.activeChain = {
      key: 'solana-devnet',
      name: 'Solana Devnet',
      type: 'svm',
      symbol: 'SOL',
      isTestnet: true,
    };
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByTestId('home-action-faucet')).toBeTruthy());

    fireEvent.press(screen.getByTestId('home-action-faucet'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Funds received! Updating balance...', 'success')
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.devnet.solana.com',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('opens the sepolia faucet externally', async () => {
    mockWalletState.activeChain = { key: 'sepolia', name: 'Sepolia', type: 'evm', symbol: 'ETH', isTestnet: true };
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByTestId('home-action-faucet')).toBeTruthy());

    fireEvent.press(screen.getByTestId('home-action-faucet'));
    await waitFor(() =>
      expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://sepoliafaucet.com/')
    );
  });

  it('tells the user when no faucet exists for the testnet', async () => {
    mockWalletState.activeChain = {
      key: 'base-sepolia',
      name: 'Base Sepolia',
      type: 'evm',
      symbol: 'ETH',
      isTestnet: true,
    };
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByTestId('home-action-faucet')).toBeTruthy());

    fireEvent.press(screen.getByTestId('home-action-faucet'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('No faucet available for this testnet', 'info')
    );
  });

  it('surfaces faucet request failures', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
    mockWalletState.activeChain = STELLAR_TESTNET_CHAIN;
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByTestId('home-action-faucet')).toBeTruthy());

    fireEvent.press(screen.getByTestId('home-action-faucet'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Failed to request funds. Try again later.', 'error')
    );
  });

  it('blocks the fiat gateway on testnets', async () => {
    mockWalletState.activeChain = STELLAR_TESTNET_CHAIN;
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByText('FIAT GATEWAY')).toBeTruthy());

    fireEvent.press(screen.getByText('FIAT GATEWAY'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'Fiat ramps are not available on testnets. Switch to a mainnet.',
        'info'
      )
    );
  });

  it('closes the fiat gateway modal via CLOSE', async () => {
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByText('FIAT GATEWAY')).toBeTruthy());

    fireEvent.press(screen.getByText('FIAT GATEWAY'));
    await waitFor(() => expect(screen.getByText('BUY CRYPTO')).toBeTruthy());

    fireEvent.press(screen.getByText('CLOSE'));
    await waitFor(() => expect(screen.queryByText('OFF-RAMP FIAT')).toBeNull());
  });

  it('switches native currency through the selector modal', async () => {
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByText('FIAT GATEWAY')).toBeTruthy());

    fireEvent.press(screen.getByText('FIAT GATEWAY'));
    await waitFor(() => expect(screen.getByText('BUY CRYPTO')).toBeTruthy());

    fireEvent.press(screen.getByText('USD'));
    await waitFor(() => expect(screen.getByText('SELECT NATIVE CURRENCY')).toBeTruthy());

    fireEvent.press(screen.getByText('Euro'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Native currency set to EUR', 'success')
    );
    expect(useSettingsStore.getState().nativeCurrency).toBe('EUR');
  });
});

describe('HomeDashboardScreen — order outcome banners', () => {
  beforeEach(() => {
    resetDashboardState();
    jest.clearAllMocks();
    mockOpenExternalUrl.mockResolvedValue(true);
  });

  const mkTransakOrder = (status: string, flow: string) => ({
    walletAddress: DEFAULT_ADDRESS,
    flow,
    status,
    updatedAt: Date.now(),
    cryptoAmount: '1.25',
    cryptoCurrency: 'ETH',
    orderId: 'ORDER-X',
  });

  it('renders transak outcome titles for each status and flow', async () => {
    const cases: Array<[string, string, string]> = [
      ['success', 'buy', 'BUY ORDER COMPLETE'],
      ['success', 'sell', 'SELL ORDER COMPLETE'],
      ['failed', 'buy', 'BUY ORDER FAILED'],
      ['failed', 'sell', 'SELL ORDER FAILED'],
      ['processing', 'buy', 'BUY ORDER PROCESSING'],
      ['created', 'sell', 'SELL ORDER CREATED'],
    ];
    for (const [status, flow, title] of cases) {
      mockTransactionState.latestTransakOrder = mkTransakOrder(status, flow);
      const { screen, unmount } = (() => {
        const navigation = { navigate: jest.fn() };
        const route = { key: 'Home', name: 'Home', params: undefined };
        const s = render(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);
        return { screen: s, unmount: s.unmount };
      })();
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
      unmount();
    }
  });

  it('hides transak orders that belong to a different wallet', async () => {
    mockTransactionState.latestTransakOrder = {
      ...mkTransakOrder('success', 'buy'),
      walletAddress: '0xsomeoneelse',
    };
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByText(/1.20%/)).toBeTruthy());
    expect(screen.queryByText('BUY ORDER COMPLETE')).toBeNull();
  });

  it('renders onramp outcome titles for completed/failed/pending', async () => {
    const cases: Array<[string, string, string]> = [
      ['completed', 'buy', 'BUY COMPLETE'],
      ['completed', 'sell', 'SELL COMPLETE'],
      ['failed', 'sell', 'SELL FAILED'],
      ['pending', 'buy', 'BUY PENDING'],
    ];
    for (const [status, flow, title] of cases) {
      mockTransactionState.latestOnrampOrder = {
        walletAddress: DEFAULT_ADDRESS,
        flow,
        status,
        statusToken: 'tok-1',
        updatedAt: Date.now(),
        orderId: 'ORD-1',
      };
      const navigation = { navigate: jest.fn() };
      const route = { key: 'Home', name: 'Home', params: undefined };
      const s = render(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(s.getByText(title)).toBeTruthy());
      s.unmount();
    }
  });

  it('polls a pending onramp order with its status token', async () => {
    mockTransactionState.latestOnrampOrder = {
      walletAddress: DEFAULT_ADDRESS,
      flow: 'buy',
      status: 'pending',
      statusToken: 'tok-1',
      updatedAt: Date.now(),
      orderId: 'ORD-1',
    };
    const { screen, unmount } = (() => {
      const navigation = { navigate: jest.fn() };
      const route = { key: 'Home', name: 'Home', params: undefined };
      const s = render(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);
      return { screen: s, unmount: s.unmount };
    })();

    await waitFor(() => expect(mockCheckOrderStatus).toHaveBeenCalledWith('tok-1'));
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(mockCheckOrderStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    unmount();
  });
});

describe('HomeDashboardScreen — SPP privacy mode', () => {
  beforeEach(() => {
    resetDashboardState();
    jest.clearAllMocks();
    resetSppMocks();
    mockOpenExternalUrl.mockResolvedValue(true);
  });

  afterEach(() => {
    useSettingsStore.getState().setSelectedPrivacyAssetId(null);
  });

  const enterPrivacy = async (owner: string) => {
    mockWalletState.activeChain = STELLAR_TESTNET_CHAIN;
    mockWalletState.addresses = { xlm: owner };
    mockWalletState.address = owner;
    const utils = renderHome();
    await waitFor(() => expect(utils.screen.getByLabelText(/^Private XLM/)).toBeTruthy());
    fireEvent.press(utils.screen.getByLabelText(/^Private XLM/));
    await flushAsync();
    return utils;
  };

  it('reaches prove-ready via the setup-complete path', async () => {
    const { screen } = await enterPrivacy(gAddr('A'));

    await waitFor(() => expect(screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0));
    expect(mockPrepareSppOp).toHaveBeenCalledWith('stellar-testnet', gAddr('A'));
    expect(mockEnsureSppAccountReady).not.toHaveBeenCalled();
    // Private chrome: badge, chain label and empty private activity copy.
    expect(screen.getAllByText(/pXLM/).length).toBeGreaterThan(0);
    expect(screen.getByText('No private activity yet')).toBeTruthy();
  });

  it('marks private sends unavailable when pool ops are missing', async () => {
    mockSppNativeCapabilities.mockReturnValue({ poolOps: false });
    const { screen } = await enterPrivacy(gAddr('B'));

    await waitFor(() =>
      expect(
        screen.queryByText('Private sends need a pool-ops build') ||
          screen.queryByText('Private sends unavailable')
      ).toBeTruthy()
    );
    expect(mockPrepareSppOp).not.toHaveBeenCalled();
  });

  it('warns when no Stellar owner address is ready yet', async () => {
    mockWalletState.activeChain = STELLAR_TESTNET_CHAIN;
    mockWalletState.addresses = {};
    mockWalletState.address = DEFAULT_ADDRESS;
    const { screen } = renderHome();
    await waitFor(() => expect(screen.getByLabelText(/^Private XLM/)).toBeTruthy());

    fireEvent.press(screen.getByLabelText(/^Private XLM/));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('Stellar address not ready'),
        'error'
      )
    );
  });

  it('exits privacy mode via the PUBLIC action', async () => {
    const { screen } = await enterPrivacy(gAddr('C'));
    await waitFor(() => expect(screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0));

    fireEvent.press(screen.getByTestId('home-action-public'));
    await waitFor(() =>
      expect(useSettingsStore.getState().selectedPrivacyAssetId).toBeNull()
    );
  });

  it('navigates private shield, transfer and unshield', async () => {
    const { screen, navigation } = await enterPrivacy(gAddr('D'));
    await waitFor(() => expect(screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0));

    fireEvent.press(screen.getByTestId('home-action-shield'));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.SEND_PAYMENT, {
      mode: 'shield',
      forcePrivate: true,
      privacyAssetId: 'spp-xlm-testnet',
      lockMode: true,
    });

    fireEvent.press(screen.getByTestId('home-action-transfer'));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.SEND_PAYMENT, {
      mode: 'transfer',
      forcePrivate: true,
      privacyAssetId: 'spp-xlm-testnet',
      lockMode: true,
    });

    fireEvent.press(screen.getByTestId('home-action-unshield'));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.SEND_PAYMENT, {
      mode: 'unshield',
      forcePrivate: true,
      privacyAssetId: 'spp-xlm-testnet',
      lockMode: true,
    });
  });

  it('runs ensure pipeline when the account is not set up', async () => {
    mockGetSppAccount.mockResolvedValue(null);
    const { screen } = await enterPrivacy(gAddr('E'));

    await waitFor(() => expect(mockEnsureSppAccountReady).toHaveBeenCalledWith('stellar-testnet', gAddr('E')));
    await waitFor(() => expect(screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0));
  });

  it('continues after ensure when only ASP membership is ready', async () => {
    mockGetSppAccount.mockResolvedValue(null);
    mockEnsureSppAccountReady.mockResolvedValue({
      aspReady: true,
      keysRegistered: false,
      message: 'Finish receive-key registration',
    });
    const { screen } = await enterPrivacy(gAddr('F'));

    await waitFor(() => expect(mockPrepareSppOp).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0));
  });

  it('stays in setting_up when ensure finishes neither ASP nor keys', async () => {
    mockGetSppAccount.mockResolvedValue(null);
    mockEnsureSppAccountReady.mockResolvedValue({
      aspReady: false,
      keysRegistered: false,
      message: 'Setup started',
    });
    await enterPrivacy(gAddr('G'));

    await waitFor(() => expect(mockEnsureSppAccountReady).toHaveBeenCalled());
    expect(mockPrepareSppOp).not.toHaveBeenCalled();
  });

  it('retries prove-readiness before reporting ready', async () => {
    mockPrepareSppOp
      .mockResolvedValueOnce({ readyForProve: false })
      .mockResolvedValue({ readyForProve: true });
    mockGatingSppBlocker.mockReturnValue('asp_sync_pending');
    const { screen } = await enterPrivacy(gAddr('H'));

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });
    await flushAsync();
    await waitFor(() => expect(screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0));
    expect(mockPrepareSppOp.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('serves re-entry from the session prove-readiness cache', async () => {
    const first = await enterPrivacy(gAddr('I'));
    await waitFor(() => expect(first.screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0));

    fireEvent.press(first.screen.getByTestId('home-action-public'));
    await waitFor(() => expect(useSettingsStore.getState().selectedPrivacyAssetId).toBeNull());

    mockPrepareSppOp.mockClear();
    fireEvent.press(first.screen.getByLabelText(/^Private XLM/));
    await flushAsync();

    await waitFor(() =>
      expect(first.screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0)
    );
    expect(mockPrepareSppOp).not.toHaveBeenCalled();
  });

  it('force-recovers the private balance on pull-to-refresh', async () => {
    const { screen } = await enterPrivacy(gAddr('J'));
    await waitFor(() => expect(screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0));

    mockRefreshPrivateBalanceSmart.mockClear();
    await firePullToRefresh(screen);

    expect(mockRefreshPrivateBalanceSmart).toHaveBeenCalledWith('stellar-testnet', gAddr('J'), {
      force: true,
    });
    await waitFor(() =>
      expect(mockSetLastKnownPrivateAmount).toHaveBeenCalledWith('stellar-testnet', gAddr('J'), '7.5')
    );
  });

  it('falls back to local balance when smart refresh throws', async () => {
    const { screen } = await enterPrivacy(gAddr('K'));
    await waitFor(() => expect(screen.getAllByText(/Private XLM ready/).length).toBeGreaterThan(0));

    // Force the pull-to-refresh smart refresh to fail: refreshPrivateBalance's
    // own catch falls back to the local light read.
    mockRefreshPrivateBalanceSmart.mockRejectedValue(new Error('native boom'));
    await firePullToRefresh(screen);

    await waitFor(() => expect(mockGetLocalPrivateBalance).toHaveBeenCalled());
  });

  it('clears a persisted privacy selection for the wrong chain', async () => {
    useSettingsStore.getState().setSelectedPrivacyAssetId('spp-xlm-testnet');
    const { screen } = renderHome();

    await waitFor(() =>
      expect(useSettingsStore.getState().selectedPrivacyAssetId).toBeNull()
    );
    expect(screen.queryByText('No private activity yet')).toBeNull();
  });

  it('clears an unknown persisted privacy asset id', async () => {
    useSettingsStore.getState().setSelectedPrivacyAssetId('no-such-asset');
    renderHome();

    await waitFor(() =>
      expect(useSettingsStore.getState().selectedPrivacyAssetId).toBeNull()
    );
  });
});

describe('HomeDashboardScreen — pure helpers', () => {
  it('formatTransactionTime buckets minutes, hours, days and dates', () => {
    const now = Date.now();
    expect(formatTransactionTime(now - 30 * 60 * 1000)).toBe('30m ago');
    expect(formatTransactionTime(now - 2 * 60 * 60 * 1000)).toBe('2h ago');
    expect(formatTransactionTime(now - 3 * 24 * 60 * 60 * 1000)).toBe('3d ago');
    const old = now - 10 * 24 * 60 * 60 * 1000;
    expect(formatTransactionTime(old)).toBe(new Date(old).toLocaleDateString());
  });

  it('formatAddress truncates and handles empty input', () => {
    expect(formatAddress('')).toBe('0x...');
    expect(formatAddress('0x1234567890abcdef')).toBe('0x1234...cdef');
  });
});
