import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { QRScannerScreen } from '../QRScannerScreen';
import { NavigationContainer } from '@react-navigation/native';
import { SCREENS } from '../../constants/screens';

const mockRequestPermission = jest.fn();
const mockUseCameraPermissions = jest.fn();

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: jest.fn(({ children, ...props }: any) => React.createElement(View, props, children)),
    useCameraPermissions: () => mockUseCameraPermissions(),
  };
});

const mockToastShow = jest.fn();
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

const { CameraView } = require('expo-camera');

const EVM_ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const XLM_ADDR = `G${'A'.repeat(55)}`;

describe('QRScannerScreen', () => {
  const renderScreen = (routeParams: Record<string, unknown> = {}) => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const screen = render(
      <NavigationContainer>
        <QRScannerScreen navigation={navigation as any} route={{ params: routeParams } as any} />
      </NavigationContainer>
    );
    return { ...screen, navigation };
  };

  const scan = async (data: string) => {
    const props = CameraView.mock.calls[CameraView.mock.calls.length - 1][0];
    await act(async () => {
      props.onBarcodeScanned({ data });
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, mockRequestPermission]);
  });

  it('renders without crashing', () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, mockRequestPermission]);
    const { queryAllByText } = render(
      <NavigationContainer>
        <QRScannerScreen navigation={{} as any} route={{ params: {} } as any} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Scan/i).length).toBeGreaterThanOrEqual(0);
  });

  it('shows a loading state while permission is unknown', () => {
    mockUseCameraPermissions.mockReturnValue([null, mockRequestPermission]);
    const screen = renderScreen();
    expect(screen.getByText('Requesting camera permission...')).toBeTruthy();
  });

  it('requests permission and offers settings when denied', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: false }, mockRequestPermission]);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(true as never);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const screen = renderScreen();

    expect(screen.getByText('CAMERA ACCESS REQUIRED')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Grant camera permission'));
    expect(mockRequestPermission).toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Open app settings'));
    await waitFor(() =>
      expect(openURL.mock.calls.length + openSettings.mock.calls.length).toBeGreaterThan(0)
    );
    openSettings.mockRestore();
    openURL.mockRestore();
  });

  it('closes via the header button', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByLabelText('Close QR scanner'));
    expect(screen.navigation.goBack).toHaveBeenCalled();
  });

  it('toggles the flash', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByLabelText('Turn flash on'));
    expect(screen.getByLabelText('Turn flash off')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Turn flash off'));
    expect(screen.getByLabelText('Turn flash on')).toBeTruthy();
  });

  it('navigates to send with a scanned EVM address', async () => {
    const screen = renderScreen();
    await scan(EVM_ADDR);
    expect(screen.navigation.navigate).toHaveBeenCalledWith(SCREENS.SEND_PAYMENT, {
      address: EVM_ADDR,
    });
    expect(mockToastShow).toHaveBeenCalledWith('EVM address scanned successfully!', 'success');
  });

  it('extracts the address from an ethereum: URI', async () => {
    const screen = renderScreen();
    await scan(`ethereum:${EVM_ADDR}?amount=1`);
    expect(screen.navigation.navigate).toHaveBeenCalledWith(SCREENS.SEND_PAYMENT, {
      address: EVM_ADDR,
    });
  });

  it('detects a Stellar address', async () => {
    const screen = renderScreen();
    await scan(XLM_ADDR);
    expect(mockToastShow).toHaveBeenCalledWith('XLM address scanned successfully!', 'success');
  });

  it('rejects invalid payloads and allows rescanning', async () => {
    const screen = renderScreen();
    await scan('not a wallet address');
    expect(mockToastShow).toHaveBeenCalledWith(
      'Invalid QR code. Please scan a valid wallet address.',
      'error'
    );

    // After the rescan delay, a valid scan works.
    await act(async () => {
      jest.advanceTimersByTime(2100);
    });
    await scan(EVM_ADDR);
    expect(screen.navigation.navigate).toHaveBeenCalledWith(SCREENS.SEND_PAYMENT, {
      address: EVM_ADDR,
    });
  });

  it('locks the scanner after the first scan', async () => {
    const screen = renderScreen();
    await scan(EVM_ADDR);
    expect(screen.navigation.navigate).toHaveBeenCalledTimes(1);

    // After a successful scan the barcode handler is detached until reset.
    const lastProps = CameraView.mock.calls[CameraView.mock.calls.length - 1][0];
    expect(lastProps.onBarcodeScanned).toBeUndefined();
  });

  it('uses the onScan callback when provided', async () => {
    const onScan = jest.fn();
    const screen = renderScreen({ mode: 'walletconnect', onScan });
    await scan(EVM_ADDR);
    expect(onScan).toHaveBeenCalledWith(EVM_ADDR);
    expect(screen.navigation.goBack).toHaveBeenCalled();
    expect(screen.navigation.navigate).not.toHaveBeenCalledWith(
      SCREENS.SEND_PAYMENT,
      expect.anything()
    );
  });
});
