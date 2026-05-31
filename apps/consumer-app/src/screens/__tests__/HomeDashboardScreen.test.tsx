import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SCREENS } from '../../constants/screens';

// Mock @react-native-community/netinfo before any import that uses it
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({ type: 'wifi', isConnected: true, isInternetReachable: true })),
  },
  useNetInfo: () => ({ type: 'wifi', isConnected: true, isInternetReachable: true }),
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

jest.mock('../../hooks/useBalance', () => ({
  useBalance: () => ({
    isLoading: false,
    refresh: mockRefreshBalance,
    error: null,
  }),
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
}));

jest.mock('../../utils/externalLink', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

const { HomeDashboardScreen } = require('../HomeDashboardScreen');

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
  });

  it('switches network through the selector modal', async () => {
    const navigation = { navigate: jest.fn() };
    const route = { key: 'Home', name: 'Home', params: undefined };

    const screen = render(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);

    await waitFor(() => {
      expect(screen.getByText(/1.20%/)).toBeTruthy();
    });

    fireEvent.press(screen.getByText('NETWORK'));

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