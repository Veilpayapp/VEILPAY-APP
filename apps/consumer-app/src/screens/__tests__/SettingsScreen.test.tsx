import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockShowToast = jest.fn();
const mockSetClipboardString = jest.fn();
const mockGetStoredMnemonic = jest.fn();
const mockDeriveWalletFromMnemonic = jest.fn();
const mockAuthenticate = jest.fn();
const mockDisconnect = jest.fn();
const mockSetActiveChain = jest.fn();

const mockSupportedChains = [
  { key: 'ethereum', name: 'Ethereum', type: 'evm', symbol: 'ETH' },
  { key: 'polygon', name: 'Polygon', type: 'evm', symbol: 'MATIC' },
];

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: (selector: (state: any) => any) =>
    selector({
      address: '0x1234567890abcdef1234567890abcdef12345678',
      activeChain: { name: 'Ethereum' },
      biometricsEnabled: false,
      notificationsEnabled: true,
      analyticsEnabled: false,
      defaultPrivacyLevel: 'standard',
      setBiometricsEnabled: jest.fn(),
      setNotificationsEnabled: jest.fn(),
      setAnalyticsEnabled: jest.fn(),
      setPrivacyLevel: jest.fn(),
      setActiveChain: mockSetActiveChain,
      disconnect: mockDisconnect,
    }),
  SUPPORTED_CHAINS: mockSupportedChains,
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

jest.mock('../../components/Logo', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    Logo: () => <View testID="mock-logo" />,
  };
});

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

jest.mock('../../components/NeoPop', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    NeoPopCard: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    NeoPopButton: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('../../utils/clipboard', () => ({
  setClipboardString: (...args: unknown[]) => mockSetClipboardString(...args),
}));

jest.mock('../../utils/transactions', () => ({
  clearStoredMnemonic: jest.fn(),
  deriveWalletFromMnemonic: (...args: unknown[]) => mockDeriveWalletFromMnemonic(...args),
  getStoredMnemonic: (...args: unknown[]) => mockGetStoredMnemonic(...args),
}));

const { SettingsScreen } = require('../SettingsScreen');

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockShowToast.mockReset();
    mockSetClipboardString.mockReset();
    mockGetStoredMnemonic.mockReset();
    mockDeriveWalletFromMnemonic.mockReset();
    mockAuthenticate.mockReset();
    mockDisconnect.mockReset();
    mockSetActiveChain.mockReset();

    mockGetStoredMnemonic.mockResolvedValue(['apple', 'banana', 'candy']);
    mockSetClipboardString.mockResolvedValue(true);
    mockDeriveWalletFromMnemonic.mockReturnValue({
      privateKey: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
    });
    // Biometric auth must resolve to true so handleBackupWallet / handleExportPrivateKey proceed
    mockAuthenticate.mockResolvedValue(true);

    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined as unknown as void);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('backs up the stored recovery phrase and shows a warning dialog', async () => {
    const navigation = { goBack: jest.fn(), reset: jest.fn() };
    const route = { key: 'Settings', name: 'Settings', params: undefined };

    const screen = render(<SettingsScreen navigation={navigation} route={route as any} />);

    fireEvent.press(screen.getByText('Backup Wallet'));

    // C2 fix: biometric auth is required before exposing the mnemonic
    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
      expect(mockGetStoredMnemonic).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Recovery Phrase',
        expect.stringContaining('apple banana candy'),
        expect.any(Array)
      );
    });

    // C2 fix: clipboard copy only happens on explicit "Copy" button press
    const alertButtons = (Alert.alert as jest.Mock).mock.calls[0][2];
    await alertButtons[1].onPress();

    await waitFor(() => {
      expect(mockSetClipboardString).toHaveBeenCalledWith('apple banana candy');
      expect(mockShowToast).toHaveBeenCalledWith('Recovery phrase copied', 'success');
    });
  });

  it('exports the derived private key and shows a warning dialog', async () => {
    const navigation = { goBack: jest.fn(), reset: jest.fn() };
    const route = { key: 'Settings', name: 'Settings', params: undefined };

    const screen = render(<SettingsScreen navigation={navigation} route={route as any} />);

    fireEvent.press(screen.getByText('Export Private Key'));

    // C2 fix: biometric auth is required before exposing the private key
    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
      expect(mockGetStoredMnemonic).toHaveBeenCalledTimes(1);
      expect(mockDeriveWalletFromMnemonic).toHaveBeenCalledWith(['apple', 'banana', 'candy']);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Private Key',
        expect.stringContaining('0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'),
        expect.any(Array)
      );
    });

    // C2 fix: clipboard copy only happens on explicit "Copy" button press
    const alertButtons = (Alert.alert as jest.Mock).mock.calls[0][2];
    await alertButtons[1].onPress();

    await waitFor(() => {
      expect(mockSetClipboardString).toHaveBeenCalledWith(
        '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef'
      );
      expect(mockShowToast).toHaveBeenCalledWith('Private key copied', 'success');
    });
  });

  it('opens the network selector and switches to another chain', async () => {
    const navigation = { goBack: jest.fn(), reset: jest.fn() };
    const route = { key: 'Settings', name: 'Settings', params: undefined };

    const screen = render(<SettingsScreen navigation={navigation} route={route as any} />);

    fireEvent.press(screen.getByText('Active Network'));

    await waitFor(() => {
      expect(screen.getByText('SELECT ACTIVE NETWORK')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('POLYGON'));

    expect(mockSetActiveChain).toHaveBeenCalledWith(expect.objectContaining({ key: 'polygon' }));
    expect(mockShowToast).toHaveBeenCalledWith('Switched to Polygon', 'success');
  });
});