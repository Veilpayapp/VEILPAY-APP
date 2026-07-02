import React from 'react';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRefreshTransactions = jest.fn().mockResolvedValue(undefined);
const mockLoadMoreTransactions = jest.fn();
const mockShow = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) },
  useNetInfo: () => ({ isConnected: true }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Error: 'Error', Success: 'Success', Warning: 'Warning' },
}));

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const View = (props: any) => React.createElement('View', props, props.children);
  return {
    __esModule: true,
    FadeInDown: { duration: () => ({}) },
    default: { View, createAnimatedComponent: (c: any) => c },
    createAnimatedComponent: (c: any) => c,
    useSharedValue: jest.fn(() => ({ value: 0 })),
    useAnimatedStyle: jest.fn(() => ({})),
    withTiming: jest.fn((v) => v),
  };
});

jest.mock('@shopify/flash-list', () => {
  const { FlatList } = require('react-native');
  return { FlashList: FlatList };
});

const mockWalletState: any = {
  address: '0xabcdef1234567890abcdef1234567890abcdef12',
  activeChain: { key: 'ethereum', name: 'Ethereum', type: 'evm', nativeToken: { symbol: 'ETH', name: 'Ether' } },
};

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: (selector: any) => typeof selector === 'function' ? selector(mockWalletState) : mockWalletState,
  useThemeState: () => 'dark',
}));

const mockTxState: any = {
  transactions: [],
  hasMoreTransactions: false,
  isLoadingTransactions: false,
  transactionsError: null,
  refreshTransactions: mockRefreshTransactions,
  loadMoreTransactions: mockLoadMoreTransactions,
};

jest.mock('../../stores/transactionStore', () => ({
  useTransactionStore: (selector: any) => typeof selector === 'function' ? selector(mockTxState) : mockTxState,
}));

jest.mock('../../components/Toast', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: () => <View testID="toast" />,
    useToast: () => ({ visible: false, message: '', type: 'info', show: mockShow, hide: jest.fn() }),
  };
});

jest.mock('../../components/ScreenBackButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return { ScreenBackButton: ({ onPress }: any) => <TouchableOpacity testID="back-btn" onPress={onPress}><Text>BACK</Text></TouchableOpacity> };
});

jest.mock('../../components/Icon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Icon: () => <View testID="icon" /> };
});

jest.mock('../../components/Skeleton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { TransactionSkeleton: () => <View testID="tx-skeleton" /> };
});

jest.mock('../../components/EmptyState', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    EmptyState: ({ title, actionLabel, onAction }: any) => (
      <TouchableOpacity testID="empty-action" onPress={onAction}>
        <Text testID="empty-title">{title}</Text>
        <Text testID="empty-action-label">{actionLabel}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../components/BottomNavBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { BottomNavBar: () => <View testID="bottom-nav" /> };
});

jest.mock('../../components/SovereignCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { SovereignCard: ({ children }: any) => <View>{children}</View> };
});

jest.mock('../../utils/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('../../utils/analyticsEvents', () => ({ ANALYTICS_EVENTS: {} }));

jest.mock('../../styles/design-tokens', () => ({
  useTheme: () => ({
    colors: {
      surfaceScreen: '#000', surfaceCard: '#333', outlineSubtle: '#555', textPrimary: '#fff',
      textMuted: '#888', textTertiary: '#666', textSecondary: '#aaa', accent: '#f00',
      accentContainer: '#300', error: '#f00', success: '#0f0', errorBg: '#300', successBg: '#030',
      bgPrimary: '#000',
    },
  }),
  useStyles: (fn: any) => fn({
    surfaceScreen: '#000', surfaceCard: '#333', outlineSubtle: '#555', textPrimary: '#fff',
    textMuted: '#888', textTertiary: '#666', textSecondary: '#aaa', accent: '#f00',
    accentContainer: '#300', error: '#f00', success: '#0f0', errorBg: '#300', successBg: '#030',
    bgPrimary: '#000',
  }),
  typography: { fontFamily: { mono: 'monospace', body: 'sans-serif', bodyMedium: 'sans-serif', headline: 'sans-serif', headlineBold: 'sans-serif' } },
}));

const { TransactionHistoryScreen } = require('../TransactionHistoryScreen');

// ─── Tests ───────────────────────────────────────────────────────────────────

const mockTx = {
  id: 'tx-1',
  type: 'sent',
  status: 'confirmed',
  amount: '1.5',
  tokenSymbol: 'ETH',
  timestamp: Date.now() - 300000, // 5 mins ago
  privacyLevel: 'standard',
};

const mockRxTx = {
  id: 'tx-2',
  type: 'received',
  status: 'confirmed',
  amount: '0.5',
  tokenSymbol: 'ETH',
  timestamp: Date.now() - 90 * 60 * 1000, // 1.5 hours ago
  privacyLevel: 'max',
};

describe('TransactionHistoryScreen', () => {
  const navigation: any = { navigate: mockNavigate, goBack: mockGoBack };

  beforeEach(() => {
    jest.clearAllMocks();
    mockTxState.transactions = [];
    mockTxState.isLoadingTransactions = false;
    mockTxState.transactionsError = null;
    mockTxState.hasMoreTransactions = false;
  });

  it('renders the header', () => {
    const { getByText } = render(<TransactionHistoryScreen navigation={navigation} />);
    expect(getByText('TRANSACTION HISTORY')).toBeTruthy();
  });

  it('renders filter tabs', () => {
    const { getByText } = render(<TransactionHistoryScreen navigation={navigation} />);
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Sent')).toBeTruthy();
    expect(getByText('Received')).toBeTruthy();
  });

  it('shows empty state when no transactions', () => {
    const { getByTestId } = render(<TransactionHistoryScreen navigation={navigation} />);
    expect(getByTestId('empty-title')).toBeTruthy();
  });

  it('renders transaction list when transactions exist', async () => {
    mockTxState.transactions = [mockTx, mockRxTx];
    const { getByText, getAllByText } = render(<TransactionHistoryScreen navigation={navigation} />);
    await waitFor(() => {
      expect(getAllByText('Sent').length).toBeGreaterThan(0);
      expect(getByText('-1.5 ETH')).toBeTruthy();
      expect(getByText('+0.5 ETH')).toBeTruthy();
    });
  });

  it('shows skeleton when loading', () => {
    mockTxState.transactions = [];
    mockTxState.isLoadingTransactions = true;
    const { getAllByTestId } = render(<TransactionHistoryScreen navigation={navigation} />);
    expect(getAllByTestId('tx-skeleton').length).toBeGreaterThan(0);
  });

  it('filters to only sent transactions', async () => {
    mockTxState.transactions = [mockTx, mockRxTx];
    const { getAllByText, getByText, queryByText } = render(<TransactionHistoryScreen navigation={navigation} />);
    fireEvent.press(getAllByText('Sent')[0]);
    await waitFor(() => {
      expect(getByText('-1.5 ETH')).toBeTruthy();
      expect(queryByText('+0.5 ETH')).toBeNull();
    });
  });

  it('filters to only received transactions', async () => {
    mockTxState.transactions = [mockTx, mockRxTx];
    const { getAllByText, getByText, queryByText } = render(<TransactionHistoryScreen navigation={navigation} />);
    fireEvent.press(getAllByText('Received')[0]);
    await waitFor(() => {
      expect(getByText('+0.5 ETH')).toBeTruthy();
      expect(queryByText('-1.5 ETH')).toBeNull();
    });
  });

  it('navigates to transaction details on press', async () => {
    mockTxState.transactions = [mockTx];
    const { getByText } = render(<TransactionHistoryScreen navigation={navigation} />);
    await waitFor(() => fireEvent.press(getByText('-1.5 ETH')));
    expect(mockNavigate).toHaveBeenCalledWith('TransactionDetails', { transaction: mockTx });
  });

  it('shows error toast when transactionsError is set', async () => {
    mockTxState.transactionsError = 'Network error occurred';
    render(<TransactionHistoryScreen navigation={navigation} />);
    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith('Network error occurred', 'error');
    });
  });

  it('navigates to send payment from empty state', () => {
    const { getByTestId } = render(<TransactionHistoryScreen navigation={navigation} />);
    fireEvent.press(getByTestId('empty-action'));
    expect(mockNavigate).toHaveBeenCalledWith('SendPayment', {});
  });

  it('navigates back on back button press', () => {
    const { getByTestId } = render(<TransactionHistoryScreen navigation={navigation} />);
    fireEvent.press(getByTestId('back-btn'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('marks pending transactions', async () => {
    mockTxState.transactions = [{...mockTx, status: 'pending'}];
    const { getByText } = render(<TransactionHistoryScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Pending')).toBeTruthy());
  });
});
