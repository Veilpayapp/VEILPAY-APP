import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockShowToast = jest.fn();
const mockSetClipboardString = jest.fn();
const mockGetStoredMnemonic = jest.fn();
const mockDeriveWalletFromMnemonic = jest.fn();
const mockAuthenticate = jest.fn();

const walletState = {
  biometricsEnabled: true,
  address: '0x1234567890abcdef1234567890abcdef12345678',
  addresses: {
    evm: '0x1234567890abcdef1234567890abcdef12345678',
  },
  activeChain: { name: 'Ethereum' },
};

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: Object.assign((selector?: any) => {
    if (typeof selector === 'function') {
      return selector(walletState);
    }
    return walletState;
  }, { getState: () => walletState }),
}));

const settingsState = {
  biometricsEnabled: true,
};

jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: Object.assign((selector?: any) => {
    if (typeof selector === 'function') {
      return selector(settingsState);
    }
    return settingsState;
  }, { getState: () => settingsState }),
  useThemeState: () => 'dark',
  usePrivacyLevel: () => 'standard',
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

jest.mock('viem/accounts', () => ({
  mnemonicToAccount: () => ({
    getHdKey: () => ({
      privateKey: Buffer.from('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef', 'hex')
    })
  })
}));

const { ExportPrivateKeyScreen } = require('../ExportPrivateKeyScreen');

describe('ExportPrivateKeyScreen', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockSetClipboardString.mockReset();
    mockGetStoredMnemonic.mockReset();
    mockDeriveWalletFromMnemonic.mockReset();
    mockAuthenticate.mockReset();
    settingsState.biometricsEnabled = true;
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGetStoredMnemonic.mockResolvedValue(['apple', 'banana', 'candy']);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined as unknown as void);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function renderScreen() {
    const navigation = { goBack: jest.fn() };
    return {
      navigation,
      screen: render(<ExportPrivateKeyScreen navigation={navigation} />),
    };
  }

  it('renders initial state with address and hidden key prompt', async () => {
    const { screen } = renderScreen();

    await waitFor(() => {
      expect(screen.getByText('EXPORT PRIVATE KEY')).toBeTruthy();
      expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeTruthy();
      expect(screen.getByText('Tap to reveal private key')).toBeTruthy();
      expect(screen.getByText('REVEAL PRIVATE KEY')).toBeTruthy();
    });
  });

  it('triggers biometrics and reveals raw private key on successful authentication', async () => {
    const { screen } = renderScreen();

    await waitFor(() => {
      expect(screen.getByText('REVEAL PRIVATE KEY')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('REVEAL PRIVATE KEY'));

    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
      expect(mockGetStoredMnemonic).toHaveBeenCalledTimes(1);
      expect(screen.getByText('0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef')).toBeTruthy();
      expect(screen.getByText('COPY KEY')).toBeTruthy();
    });
  });

  it('warns user before copying and successfully copies on confirmation', async () => {
    const { screen } = renderScreen();

    await waitFor(() => {
      expect(screen.getByText('REVEAL PRIVATE KEY')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('REVEAL PRIVATE KEY'));

    await waitFor(() => {
      expect(screen.getByText('COPY KEY')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('COPY KEY'));

    await waitFor(() => {
      expect(screen.getByText('Critical Warning')).toBeTruthy();
      expect(screen.getByText('COPY ANYWAY')).toBeTruthy();
    });

    // Press COPY ANYWAY in the custom modal
    fireEvent.press(screen.getByText('COPY ANYWAY'));

    await waitFor(() => {
      expect(mockSetClipboardString).toHaveBeenCalledWith(
        '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'
      );
      expect(mockShowToast).toHaveBeenCalledWith('Private key copied to clipboard', 'success');
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
