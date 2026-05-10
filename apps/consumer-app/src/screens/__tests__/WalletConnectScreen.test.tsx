import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

const mockConnect = jest.fn();
const mockToastShow = jest.fn();
const mockCreateRandom = jest.fn();
const mockCreateWalletConnectSession = jest.fn();
const mockHasWalletConnectProjectId = jest.fn(() => false);

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: () => ({
    connect: mockConnect,
  }),
}));

jest.mock('../../components/Toast', () => ({
  __esModule: true,
  default: () => null,
  useToast: () => ({
    visible: false,
    message: '',
    type: 'info',
    show: mockToastShow,
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

jest.mock('../../components/WalletIcons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MetaMaskIcon: () => <View testID="mock-metamask-icon" />,
    TrustWalletIcon: () => <View testID="mock-trust-icon" />,
    WalletConnectIcon: () => <View testID="mock-walletconnect-icon" />,
  };
});

jest.mock('../../components/NeoPop', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    NeoPopCard: ({ children }: { children: any }) => <View>{children}</View>,
  };
});

jest.mock('../../components/Icon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Icon: () => <View testID="mock-icon" />,
  };
});

jest.mock('ethers', () => ({
  Wallet: {
    createRandom: () => mockCreateRandom(),
  },
}));

jest.mock('../../utils/walletConnectSession', () => ({
  createWalletConnectSession: (...args: unknown[]) => mockCreateWalletConnectSession(...args),
  hasWalletConnectProjectId: () => mockHasWalletConnectProjectId(),
}));

const { WalletConnectScreen } = require('../WalletConnectScreen');
const { SCREENS } = require('../../constants/screens');

describe('WalletConnectScreen', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockToastShow.mockReset();
    mockCreateWalletConnectSession.mockReset();
    mockHasWalletConnectProjectId.mockReset();
    mockHasWalletConnectProjectId.mockReturnValue(false);

    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('navigates to create wallet from internal option', () => {
    const navigation = { navigate: jest.fn(), reset: jest.fn(), goBack: jest.fn() };

    const screen = render(<WalletConnectScreen navigation={navigation} />);

    fireEvent.press(screen.getByText('CREATE NEW WALLET'));

    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.CREATE_WALLET);
  });

  it('navigates to import wallet from internal option', () => {
    const navigation = { navigate: jest.fn(), reset: jest.fn(), goBack: jest.fn() };

    const screen = render(<WalletConnectScreen navigation={navigation} />);

    fireEvent.press(screen.getByText('IMPORT EXISTING'));

    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.IMPORT_WALLET);
  });

  it('shows inline error when external connect is attempted without WalletConnect URI', async () => {
    const navigation = { navigate: jest.fn(), reset: jest.fn(), goBack: jest.fn() };

    const screen = render(<WalletConnectScreen navigation={navigation} />);

    fireEvent.press(screen.getByText('METAMASK'));

    await waitFor(() => {
      expect(screen.getByText(/No WalletConnect session URI found/i)).toBeTruthy();
    });

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('creates a WalletConnect session URI via SDK and connects on approval', async () => {
    const navigation = { navigate: jest.fn(), reset: jest.fn(), goBack: jest.fn() };
    const approvedAddress = '0x1111111111111111111111111111111111111111';

    mockHasWalletConnectProjectId.mockReturnValue(true);
    mockCreateWalletConnectSession.mockResolvedValue({
      uri: 'wc:example@2?relay-protocol=irn&symKey=test',
      waitForApproval: async () => ({
        topic: 'topic-1',
        chainId: 'eip155:1',
        account: `eip155:1:${approvedAddress}`,
        address: approvedAddress,
      }),
    });

    const screen = render(<WalletConnectScreen navigation={navigation} />);

    fireEvent.press(screen.getByText('METAMASK'));

    await waitFor(() => {
      expect(mockCreateWalletConnectSession).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith(approvedAddress, 'evm');
    });

    expect(navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: SCREENS.HOME }],
    });
  });

});
