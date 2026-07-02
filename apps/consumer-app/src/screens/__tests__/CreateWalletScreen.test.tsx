import React from 'react';
import { SCREENS } from '../../constants/screens';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReset = jest.fn();
const mockConnect = jest.fn();
const mockShow = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, reset: mockReset }),
  useRoute: () => ({ params: {} }),
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
    FadeInDown: { duration: () => ({ springify: () => ({ damping: () => ({ stiffness: () => ({}) }) }) }) },
    default: { View, createAnimatedComponent: (c: any) => c },
    createAnimatedComponent: (c: any) => c,
    useSharedValue: jest.fn(() => ({ value: 0 })),
    useAnimatedStyle: jest.fn(() => ({})),
    withTiming: jest.fn((v) => v),
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/bip39', () => ({
  generateMnemonic: jest.fn().mockResolvedValue(['word1','word2','word3','word4','word5','word6','word7','word8','word9','word10','word11','word12']),
  deriveAddressFromMnemonic: jest.fn().mockResolvedValue('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12'),
}));

jest.mock('../../utils/clipboard', () => ({
  setClipboardString: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../utils/transactions', () => ({
  storeMnemonic: jest.fn().mockResolvedValue(undefined),
  clearStoredMnemonic: jest.fn().mockResolvedValue(undefined),
}));

const mockWalletState = { connect: mockConnect };
jest.mock('../../stores/walletStore', () => ({
  useWalletStore: (selector: any) => typeof selector === 'function' ? selector(mockWalletState) : mockWalletState,
  useThemeState: () => 'dark',
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
  return { Skeleton: () => <View testID="skeleton" />, BalanceSkeleton: () => <View />, TransactionSkeleton: () => <View /> };
});

jest.mock('../../components/SovereignCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { SovereignCard: ({ children }: any) => <View>{children}</View> };
});

jest.mock('../../components/SovereignButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    SovereignButton: ({ title, onPress, disabled }: any) => (
      <TouchableOpacity testID={`btn-${title}`} onPress={onPress} disabled={disabled}>
        <Text>{title}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../styles/design-tokens', () => ({
  useTheme: () => ({ colors: { surfaceScreen: '#000', bgTertiary: '#111', bgSecondary: '#222', textPrimary: '#fff', textMuted: '#888', accent: '#f00', accentContainer: '#300', bgPrimary: '#000', surfaceElevated: '#333', surfaceCard: '#444', outlineSubtle: '#555', textTertiary: '#666', success: '#0f0', error: '#f00' } }),
  useStyles: (fn: any) => fn({ surfaceScreen: '#000', bgTertiary: '#111', bgSecondary: '#222', textPrimary: '#fff', textMuted: '#888', accent: '#f00', accentContainer: '#300', bgPrimary: '#000', surfaceElevated: '#333', surfaceCard: '#444', outlineSubtle: '#555', textTertiary: '#666' }),
  typography: { fontFamily: { mono: 'monospace', body: 'sans-serif', bodyMedium: 'sans-serif' } },
}));

const { CreateWalletScreen } = require('../CreateWalletScreen');
const { generateMnemonic } = require('../../utils/bip39');
const { setClipboardString } = require('../../utils/clipboard');
const { storeMnemonic } = require('../../utils/transactions');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CreateWalletScreen', () => {
  const navigation: any = { navigate: mockNavigate, goBack: mockGoBack, reset: mockReset };

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
  });

  it('renders the header and security warning', async () => {
    const { getByText } = render(<CreateWalletScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('CREATE WALLET')).toBeTruthy());
    expect(getByText('KEEP THIS SAFE')).toBeTruthy();
  });

  it('shows generated seed words after loading', async () => {
    const { getByText } = render(<CreateWalletScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('word1')).toBeTruthy());
    expect(getByText('word12')).toBeTruthy();
  });

  it('shows error toast when seed generation fails', async () => {
    (generateMnemonic as jest.Mock).mockRejectedValueOnce(new Error('Entropy failure'));
    render(<CreateWalletScreen navigation={navigation} />);
    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith(expect.stringContaining('Failed to generate seed'), 'error');
    });
  });

  it('copies seed phrase to clipboard and shows toast', async () => {
    const { getByText } = render(<CreateWalletScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('word1')).toBeTruthy());
    fireEvent.press(getByText('COPY TO CLIPBOARD'));
    await waitFor(() => {
      expect(setClipboardString).toHaveBeenCalledWith(expect.stringContaining('word1'));
      expect(mockShow).toHaveBeenCalledWith(expect.stringContaining('Seed phrase copied'), 'success');
    });
  });

  it('shows clipboard error when clipboard is unavailable', async () => {
    (setClipboardString as jest.Mock).mockResolvedValueOnce(false);
    const { getByText } = render(<CreateWalletScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('word1')).toBeTruthy());
    fireEvent.press(getByText('COPY TO CLIPBOARD'));
    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith('Clipboard unavailable in this runtime', 'error');
    });
  });

  it('checkbox enables the confirm button, which navigates on press', async () => {
    const { getByText, getByTestId } = render(<CreateWalletScreen navigation={navigation} />);
    
    // Wait for the seed phrase to load
    await waitFor(() => expect(getByText('word1')).toBeTruthy());
    await waitFor(() => {
      expect(getByTestId('btn-CONFIRM TO CONTINUE')).toBeTruthy();
    });
    // Before checkbox: button is disabled
    const btnDisabled = getByTestId('btn-CONFIRM TO CONTINUE');
    expect(btnDisabled.props.accessibilityState.disabled).toBe(true);
    // Toggle checkbox
    const checkbox = getByText("I've written down my seed phrase and stored it securely");
    fireEvent.press(checkbox);
    // After checkbox: button is enabled and text changes to CONTINUE
    const btnEnabled = getByTestId('btn-CONTINUE TO VERIFY');
    expect(btnEnabled.props.accessibilityState.disabled).toBe(false);
    fireEvent.press(btnEnabled);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(SCREENS.VERIFY_WALLET, {
        seedWords: Array(12).fill('').map((_, i) => `word${i+1}`),
        derivedAddress: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12'
      });
    });
  });

  it('shows error toast when wallet derivation fails', async () => {
    const { deriveAddressFromMnemonic } = require('../../utils/bip39');
    deriveAddressFromMnemonic.mockRejectedValueOnce(new Error('derive failed'));
    render(<CreateWalletScreen navigation={navigation} />);
    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith('Failed to generate seed: derive failed', 'error');
    });
  });

  it('goes back when back button pressed', () => {
    const { getByTestId } = render(<CreateWalletScreen navigation={navigation} />);
    fireEvent.press(getByTestId('back-btn'));
    expect(mockGoBack).toHaveBeenCalled();
  });
});
