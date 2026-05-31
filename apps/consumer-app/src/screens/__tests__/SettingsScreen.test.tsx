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
  useThemeState: () => 'dark',
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

jest.mock('../../components/SovereignCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SovereignCard: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('../../components/SovereignButton', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SovereignButton: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
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

  it('navigates to the backup wallet screen', async () => {
    const navigation = { goBack: jest.fn(), reset: jest.fn(), navigate: jest.fn() };
    const route = { key: 'Settings', name: 'Settings', params: undefined };

    const screen = render(<SettingsScreen navigation={navigation} route={route as any} />);

    fireEvent.press(screen.getByText('Backup Wallet'));

    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('BackupWallet');
    });
  });

  it('navigates to the export private key screen', async () => {
    const navigation = { goBack: jest.fn(), reset: jest.fn(), navigate: jest.fn() };
    const route = { key: 'Settings', name: 'Settings', params: undefined };

    const screen = render(<SettingsScreen navigation={navigation} route={route as any} />);

    fireEvent.press(screen.getByText('Export Private Key'));

    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('ExportPrivateKey');
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