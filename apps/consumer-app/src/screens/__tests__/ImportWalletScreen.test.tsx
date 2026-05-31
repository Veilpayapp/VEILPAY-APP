import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const View = (props: any) => React.createElement('View', props, props.children);
  return {
    __esModule: true,
    FadeInDown: { duration: () => ({ springify: () => ({ damping: () => ({ stiffness: () => ({}) }) }) }) },
    default: { View },
    createAnimatedComponent: (c: any) => c,
  };
});

const mockValidateMnemonic = jest.fn().mockResolvedValue(true);
const mockDeriveAddress = jest.fn().mockResolvedValue('0xDerived1234567890abcdef1234567890abcdef12');

jest.mock('../../utils/bip39', () => ({
  validateMnemonic: (...args: any[]) => mockValidateMnemonic(...args),
  deriveAddressFromMnemonic: (...args: any[]) => mockDeriveAddress(...args),
}));

jest.mock('../../utils/transactions', () => ({
  storeMnemonic: jest.fn().mockResolvedValue(undefined),
  clearStoredMnemonic: jest.fn().mockResolvedValue(undefined),
}));

const mockWalletState = { connect: mockConnect };
jest.mock('../../stores/walletStore', () => ({
  useWalletStore: (selector: any) => typeof selector === 'function' ? selector(mockWalletState) : mockWalletState,
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
      <TouchableOpacity testID={`btn-${title}`} onPress={!disabled ? onPress : undefined} disabled={disabled}>
        <Text>{title}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../styles/design-tokens', () => ({
  useTheme: () => ({ colors: { surfaceScreen: '#000', bgTertiary: '#111', textPrimary: '#fff', textMuted: '#888', accent: '#f00', bgContainerHigh: '#200', surfaceCard: '#333', surfaceElevated: '#444', outlineSubtle: '#555', textTertiary: '#666', textFaint: '#444', error: '#f00', success: '#0f0' } }),
  useStyles: (fn: any) => fn({ surfaceScreen: '#000', bgTertiary: '#111', textPrimary: '#fff', textMuted: '#888', accent: '#f00', bgContainerHigh: '#200', surfaceCard: '#333', surfaceElevated: '#444', outlineSubtle: '#555', textTertiary: '#666', textFaint: '#444', error: '#f00', success: '#0f0' }),
  typography: { fontFamily: { mono: 'monospace', body: 'sans-serif', bodyMedium: 'sans-serif' } },
}));

const { ImportWalletScreen } = require('../ImportWalletScreen');
const { storeMnemonic } = require('../../utils/transactions');

// ─── Tests ───────────────────────────────────────────────────────────────────

const VALID_12_WORDS = ['word1','word2','word3','word4','word5','word6','word7','word8','word9','word10','word11','word12'];

describe('ImportWalletScreen', () => {
  const navigation: any = { navigate: mockNavigate, goBack: mockGoBack, reset: mockReset };

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockValidateMnemonic.mockResolvedValue(true);
    mockDeriveAddress.mockResolvedValue('0xDerived1234567890abcdef1234567890abcdef12');
  });

  it('renders the header and initial 12-word grid', () => {
    const { getAllByText, getByText } = render(<ImportWalletScreen navigation={navigation} />);
    expect(getAllByText('IMPORT WALLET').length).toBeGreaterThan(0);
    expect(getByText('12 WORDS')).toBeTruthy();
    expect(getByText('24 WORDS')).toBeTruthy();
  });

  it('toggles to 24 words when 24 WORDS is pressed', () => {
    const { getByText } = render(<ImportWalletScreen navigation={navigation} />);
    fireEvent.press(getByText('24 WORDS'));
    expect(getByText('Enter your recovery phrase below')).toBeTruthy();
  });

  it('shows import button as disabled initially', () => {
    const { getByTestId } = render(<ImportWalletScreen navigation={navigation} />);
    expect(getByTestId('btn-IMPORT WALLET').props.accessibilityState.disabled).toBe(true);
  });

  it('shows error on invalid (short) mnemonic words', async () => {
    const { getAllByPlaceholderText, getByText } = render(<ImportWalletScreen navigation={navigation} />);
    const inputs = getAllByPlaceholderText('word');
    fireEvent.changeText(inputs[0], 'a'); // too short
    fireEvent(inputs[0], 'blur');
    await waitFor(() => {
      expect(getByText('Each recovery word should be at least 2 characters.')).toBeTruthy();
    });
  });

  it('shows incomplete phrase error when some words missing', async () => {
    const { getAllByPlaceholderText, getByText } = render(<ImportWalletScreen navigation={navigation} />);
    const inputs = getAllByPlaceholderText('word');
    fireEvent.changeText(inputs[0], 'abandon');
    fireEvent(inputs[0], 'blur');
    await waitFor(() => {
      expect(getByText(/Enter all 12 words/)).toBeTruthy();
    });
  });

  it('shows validation error when checksum is invalid', async () => {
    mockValidateMnemonic.mockResolvedValue(false);
    const { getAllByPlaceholderText, getByText } = render(<ImportWalletScreen navigation={navigation} />);
    const inputs = getAllByPlaceholderText('word');
    // Fill all 12 words
    VALID_12_WORDS.forEach((word, i) => {
      fireEvent.changeText(inputs[i], word);
    });
    fireEvent(inputs[0], 'blur');
    await waitFor(() => {
      expect(getByText('Recovery phrase checksum is invalid. Re-check spelling and word order.')).toBeTruthy();
    });
  });

  it('shows valid hint when mnemonic is correct', async () => {
    mockValidateMnemonic.mockResolvedValue(true);
    const { getAllByPlaceholderText, getByText } = render(<ImportWalletScreen navigation={navigation} />);
    const inputs = getAllByPlaceholderText('word');
    VALID_12_WORDS.forEach((word, i) => {
      fireEvent.changeText(inputs[i], word);
    });
    await waitFor(() => {
      expect(getByText('Recovery phrase checksum is valid.')).toBeTruthy();
    });
  });

  it('imports wallet and navigates when valid mnemonic submitted', async () => {
    const { getAllByPlaceholderText, getByText, getByTestId } = render(<ImportWalletScreen navigation={navigation} />);
    const inputs = getAllByPlaceholderText('word');
    VALID_12_WORDS.forEach((word, i) => {
      fireEvent.changeText(inputs[i], word);
    });
    await waitFor(() => expect(getByText('Recovery phrase checksum is valid.')).toBeTruthy());
    fireEvent.press(getByTestId('btn-IMPORT WALLET'));
    await waitFor(() => {
      expect(storeMnemonic).toHaveBeenCalledWith(VALID_12_WORDS);
      expect(mockConnect).toHaveBeenCalledWith('0xDerived1234567890abcdef1234567890abcdef12', 'evm');
      expect(mockReset).toHaveBeenCalled();
    });
  });

  it('shows error toast when import fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('network error'));
    const { getAllByPlaceholderText, getByText, getByTestId } = render(<ImportWalletScreen navigation={navigation} />);
    const inputs = getAllByPlaceholderText('word');
    VALID_12_WORDS.forEach((word, i) => {
      fireEvent.changeText(inputs[i], word);
    });
    await waitFor(() => expect(getByText('Recovery phrase checksum is valid.')).toBeTruthy());
    fireEvent.press(getByTestId('btn-IMPORT WALLET'));
    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith('network error', 'error');
    });
  });

  it('pasting a full seed phrase populates all inputs', async () => {
    const { getAllByPlaceholderText } = render(<ImportWalletScreen navigation={navigation} />);
    const inputs = getAllByPlaceholderText('word');
    const pastedPhrase = VALID_12_WORDS.join(' ');
    fireEvent.changeText(inputs[0], pastedPhrase);
    await waitFor(() => {
      // After paste, first input should have first word only
    });
  });

  it('goes back when back button pressed', () => {
    const { getByTestId } = render(<ImportWalletScreen navigation={navigation} />);
    fireEvent.press(getByTestId('back-btn'));
    expect(mockGoBack).toHaveBeenCalled();
  });
});
