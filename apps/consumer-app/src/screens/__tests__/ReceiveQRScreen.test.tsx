import React from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReceiveQRScreen } from '../ReceiveQRScreen';
import { NavigationContainer } from '@react-navigation/native';
import { useWalletStore } from '../../stores/walletStore';

jest.mock('../../stores/walletStore');

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

jest.mock('../../components/BottomNavBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { BottomNavBar: () => <View testID="mock-bottom-nav" /> };
});

const mockSetClipboardString = jest.fn();
jest.mock('../../utils/clipboard', () => ({
  setClipboardString: (...args: unknown[]) => mockSetClipboardString(...args),
}));

const mockCaptureRef = jest.fn();
jest.mock('react-native-view-shot', () => ({
  captureRef: (...args: unknown[]) => mockCaptureRef(...args),
}));

const mockShareAsync = jest.fn();
jest.mock('expo-sharing', () => ({
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

const EVM_CHAIN: any = {
  key: 'ethereum',
  name: 'Ethereum',
  type: 'evm',
  symbol: 'ETH',
  nativeToken: { symbol: 'ETH', name: 'Ether' },
};
const XLM_CHAIN: any = {
  key: 'stellar-testnet',
  name: 'Stellar Testnet',
  type: 'xlm',
  symbol: 'XLM',
  nativeToken: { symbol: 'XLM', name: 'Stellar Lumens' },
  isTestnet: true,
};
const EVM_ADDR = '0x1234567890abcdef1234567890abcdef12345678';

describe('ReceiveQRScreen', () => {
  const renderScreen = (walletState: Record<string, unknown> = {}) => {
    (useWalletStore as unknown as jest.Mock).mockReturnValue({
      address: EVM_ADDR,
      activeChain: EVM_CHAIN,
      ...walletState,
    });
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const screen = render(
      <NavigationContainer>
        <ReceiveQRScreen {...({ navigation, route: { params: {} } } as any)} />
      </NavigationContainer>
    );
    return { ...screen, navigation };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetClipboardString.mockResolvedValue(true);
    mockCaptureRef.mockResolvedValue('file:///tmp/qr.png');
    mockShareAsync.mockResolvedValue(undefined);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
  });

  afterEach(() => {
    (Share.share as jest.Mock).mockRestore?.();
  });

  it('renders without crashing', () => {
    (useWalletStore as unknown as jest.Mock).mockReturnValue({
      address: '0x123',
    });
    const { queryAllByText } = render(
      <NavigationContainer>
        <ReceiveQRScreen {...({ navigation: {}, route: { params: {} } } as any)} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Receive/i).length).toBeGreaterThan(0);
  });

  it('navigates back from the header', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(screen.navigation.goBack).toHaveBeenCalled();
  });

  it('copies the address and confirms', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByLabelText('Copy wallet address'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Address copied to clipboard', 'success')
    );
    expect(mockSetClipboardString).toHaveBeenCalledWith(EVM_ADDR);
  });

  it('reports clipboard failure on copy', async () => {
    mockSetClipboardString.mockResolvedValue(false);
    const screen = renderScreen();
    fireEvent.press(screen.getByLabelText('Copy wallet address'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Clipboard unavailable in this runtime', 'error')
    );
  });

  it('does nothing on copy without an address', async () => {
    const screen = renderScreen({ address: null });
    expect(screen.getAllByText('No wallet connected').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByLabelText('Copy wallet address'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSetClipboardString).not.toHaveBeenCalled();
  });

  it('shares the QR image of the address', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByLabelText('Share wallet address'));
    await waitFor(() => expect(mockCaptureRef).toHaveBeenCalled());
    expect(mockShareAsync).toHaveBeenCalledWith(
      'file:///tmp/qr.png',
      expect.objectContaining({ mimeType: 'image/png' })
    );
  });

  it('reports share failures', async () => {
    mockCaptureRef.mockRejectedValue(new Error('view-shot unavailable'));
    const screen = renderScreen();
    fireEvent.press(screen.getByLabelText('Share wallet address'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Failed to share address image', 'error')
    );
  });

  it('skips sharing when no address is available', async () => {
    const screen = renderScreen({ address: null });
    fireEvent.press(screen.getByLabelText('Share wallet address'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockCaptureRef).not.toHaveBeenCalled();
  });

  it('filters the requested amount to a single decimal', () => {
    const screen = renderScreen();
    const input = screen.getByLabelText('REQUEST SPECIFIC AMOUNT');
    fireEvent.changeText(input, '1.2.3.4');
    expect(input.props.value).toBe('1.234');
    fireEvent.changeText(input, '5a0');
    expect(input.props.value).toBe('50');
  });

  it('shares a payment link with amount via system share and clipboard', async () => {
    const screen = renderScreen();
    fireEvent.changeText(screen.getByLabelText('REQUEST SPECIFIC AMOUNT'), '1.5');

    fireEvent.press(screen.getByText('SHARE PAYMENT LINK'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Payment link shared and copied', 'success')
    );
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Pay me 1.5 ETH') })
    );
    expect(mockSetClipboardString).toHaveBeenCalledWith(expect.stringContaining('veilpay://'));
  });

  it('builds a receive link without an amount', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText('SHARE RECEIVE LINK'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Payment link shared and copied', 'success')
    );
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Send to me on Veilpay') })
    );
  });

  it('falls back to clipboard copy when the share sheet is dismissed', async () => {
    (Share.share as jest.Mock).mockRejectedValue(new Error('dismissed'));
    const screen = renderScreen();
    fireEvent.press(screen.getByText('SHARE RECEIVE LINK'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Payment link copied', 'success')
    );
  });

  it('reports when both share and clipboard fail', async () => {
    (Share.share as jest.Mock).mockRejectedValue(new Error('dismissed'));
    mockSetClipboardString.mockResolvedValue(false);
    const screen = renderScreen();
    fireEvent.press(screen.getByText('SHARE RECEIVE LINK'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Could not share or copy the payment link', 'error')
    );
  });

  it('shows Stellar private-receive copy on xlm chains', () => {
    const screen = renderScreen({ activeChain: XLM_CHAIN, address: `G${'A'.repeat(55)}` });
    expect(screen.getByText('PRIVATE RECEIVE')).toBeTruthy();
    expect(screen.getAllByText(/Share this G… address/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('XLM').length).toBeGreaterThan(0);
  });

  it('shows stealth copy on EVM and neutral copy on other chains', () => {
    const evm = renderScreen();
    expect(evm.getAllByText('STEALTH-READY').length).toBeGreaterThan(0);
    evm.unmount();

    const other = renderScreen({
      activeChain: { key: 'bitcoin', name: 'Bitcoin', type: 'btc', symbol: 'BTC' },
    });
    expect(other.getAllByText('YOUR ADDRESS').length).toBeGreaterThan(0);
  });
});
