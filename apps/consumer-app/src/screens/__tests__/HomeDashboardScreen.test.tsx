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
  transactions: [],
  isLoadingTransactions: false,
  refreshTransactions: mockRefreshTransactions,
  latestTransakOrder: null,
  clearLatestTransakOrder: jest.fn(() => {
    mockWalletState.latestTransakOrder = null;
  }),
};

jest.mock('../../stores/walletStore', () => ({
  SUPPORTED_CHAINS: [
    { key: 'ethereum', name: 'Ethereum', type: 'evm', symbol: 'ETH' },
    { key: 'polygon', name: 'Polygon', type: 'evm', symbol: 'MATIC' },
  ],
  useWalletStore: (selector: any) => {
    if (typeof selector === 'function') {
      return selector(mockWalletState);
    }

    return mockWalletState;
  },
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
    mockWalletState.latestTransakOrder = null;
    mockWalletState.clearLatestTransakOrder.mockClear();
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

    fireEvent.press(screen.getByText('BUY / SELL CRYPTO'));

    await waitFor(() => {
      expect(screen.getByText('BUY OR SELL CRYPTO')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('BUY CRYPTO'));

    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.DEPOSIT_CRYPTO);

    fireEvent.press(screen.getByText('BUY / SELL CRYPTO'));

    await waitFor(() => {
      expect(screen.getByText('SELL CRYPTO')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('SELL CRYPTO'));

    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.WITHDRAW_FIAT);
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
    mockWalletState.latestTransakOrder = {
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
      expect(mockWalletState.clearLatestTransakOrder).toHaveBeenCalled();
    });

    screen.rerender(<HomeDashboardScreen navigation={navigation as any} route={route as any} />);

    expect(screen.queryByText('BUY ORDER COMPLETE')).toBeNull();
  });
});