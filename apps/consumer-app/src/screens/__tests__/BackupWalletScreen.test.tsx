import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockShowToast = jest.fn();
const mockSetClipboardString = jest.fn();
const mockGetStoredMnemonic = jest.fn();
const mockAuthenticate = jest.fn();

const walletState = {};

const settingsState = {
  biometricsEnabled: true,
};

jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: () => settingsState,
  useThemeState: () => 'dark',
  usePrivacyLevel: () => 'standard',
}));

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: () => walletState,
}));

jest.mock('../../hooks/useBiometrics', () => ({
  useBiometrics: () => ({
    isAvailable: true,
    authenticate: mockAuthenticate,
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

jest.mock('../../components/Icon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Icon: () => <View testID="mock-icon" />,
  };
});

jest.mock('../../components/ScreenBackButton', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    ScreenBackButton: ({ onPress }: { onPress: () => void }) => (
      <TouchableOpacity onPress={onPress}>
        <Text>BACK</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../components/SovereignCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SovereignCard: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('../../components/SovereignButton', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    SovereignButton: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{title}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../utils/clipboard', () => ({
  setClipboardString: (...args: unknown[]) => mockSetClipboardString(...args),
}));

jest.mock('../../utils/transactions', () => ({
  getStoredMnemonic: (...args: unknown[]) => mockGetStoredMnemonic(...args),
}));

const { BackupWalletScreen } = require('../BackupWalletScreen');

describe('BackupWalletScreen', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockSetClipboardString.mockReset();
    mockGetStoredMnemonic.mockReset();
    mockAuthenticate.mockReset();
    settingsState.biometricsEnabled = true;
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGetStoredMnemonic.mockResolvedValue([
      'apple', 'banana', 'candy', 'dog', 'elephant', 'fox',
      'grape', 'house', 'ice', 'jacket', 'kite', 'lemon'
    ]);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined as unknown as void);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function renderScreen() {
    const navigation = { goBack: jest.fn() };
    return {
      navigation,
      screen: render(<BackupWalletScreen navigation={navigation} />),
    };
  }

  it('renders initial state with hidden phrase and prompt to reveal', async () => {
    const { screen } = renderScreen();

    await waitFor(() => {
      expect(screen.getByText('BACKUP WALLET')).toBeTruthy();
      expect(screen.getByText('Tap below to reveal your phrase')).toBeTruthy();
      expect(screen.getByText('REVEAL PHRASE')).toBeTruthy();
    });
  });

  it('triggers biometrics and reveals the secret recovery phrase on successful authentication', async () => {
    const { screen } = renderScreen();

    await waitFor(() => {
      expect(screen.getByText('REVEAL PHRASE')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('REVEAL PHRASE'));

    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
      expect(screen.getByText('apple')).toBeTruthy();
      expect(screen.getByText('lemon')).toBeTruthy();
      expect(screen.getByText('COPY TO CLIPBOARD')).toBeTruthy();
    });
  });

  it('warns user before copying and successfully copies on confirmation', async () => {
    const { screen } = renderScreen();

    await waitFor(() => {
      expect(screen.getByText('REVEAL PHRASE')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('REVEAL PHRASE'));

    await waitFor(() => {
      expect(screen.getByText('COPY TO CLIPBOARD')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('COPY TO CLIPBOARD'));

    await waitFor(() => {
      expect(screen.getByText('Security Warning')).toBeTruthy();
      expect(screen.getByText('COPY ANYWAY')).toBeTruthy();
    });

    // Press COPY ANYWAY in the custom modal
    fireEvent.press(screen.getByText('COPY ANYWAY'));

    await waitFor(() => {
      expect(mockSetClipboardString).toHaveBeenCalledWith(
        'apple banana candy dog elephant fox grape house ice jacket kite lemon'
      );
      expect(mockShowToast).toHaveBeenCalledWith('Phrase copied to clipboard', 'success');
    });
  });

  it('handles back button navigation', async () => {
    const { screen, navigation } = renderScreen();

    await waitFor(() => {
      expect(screen.getByText('BACK')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('BACK'));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
