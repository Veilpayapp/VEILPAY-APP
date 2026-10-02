import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { TransakWebViewScreen } from '../TransakWebViewScreen';
import { NavigationContainer } from '@react-navigation/native';
import { View } from 'react-native';

jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return {
    WebView: View,
  };
});

const mockSetLatestTransakOrder = jest.fn();
const mockWalletState: any = { address: '0x1234567890abcdef1234567890abcdef12345678' };

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: Object.assign(() => mockWalletState, { getState: () => mockWalletState }),
}));

jest.mock('../../stores/transactionStore', () => ({
  useTransactionStore: Object.assign(() => ({}), {
    getState: () => ({ setLatestTransakOrder: mockSetLatestTransakOrder }),
  }),
}));

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('TransakWebViewScreen', () => {
  const makeScreen = (params: Record<string, unknown> = {}) => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: { url: 'https://global-stg.transak.com', flow: 'buy', ...params } };
    const screen = render(
      <NavigationContainer>
        <TransakWebViewScreen route={route as any} navigation={navigation as any} />
      </NavigationContainer>
    );
    return { ...screen, navigation };
  };

  const getWebView = (screen: ReturnType<typeof makeScreen>) => {
    const view = screen
      .UNSAFE_getAllByType(View)
      .find((v) => typeof v.props.onMessage === 'function');
    if (!view) throw new Error('WebView host element not found');
    return view;
  };

  const sendMessage = async (screen: ReturnType<typeof makeScreen>, payload: unknown) => {
    const view = getWebView(screen);
    await act(async () => {
      view.props.onMessage({ nativeEvent: { data: JSON.stringify(payload) } });
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWalletState.address = '0x1234567890abcdef1234567890abcdef12345678';
  });

  it('renders without crashing', () => {
    const route = {
      params: {
        fiatCurrency: 'USD',
        cryptoCurrency: 'ETH',
        network: 'ethereum',
        fiatAmount: 100,
        type: 'buy' as const,
      }
    };

    const { queryAllByText } = render(
      <NavigationContainer>
        <TransakWebViewScreen route={route as any} navigation={{} as any} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Loading/i).length).toBeGreaterThan(0);
  });

  it('ignores malformed and irrelevant postMessages', async () => {
    const screen = makeScreen();
    const view = getWebView(screen);

    await act(async () => {
      view.props.onMessage({ nativeEvent: { data: 'not-json{{{' } });
      view.props.onMessage({ nativeEvent: { data: JSON.stringify({ event_id: 'SOME_OTHER_EVENT' }) } });
      view.props.onMessage({ nativeEvent: { data: JSON.stringify({ event_id: 'TRANSAK_WIDGET_INITIALISED', data: 'not-an-object' }) } });
    });

    await waitFor(() => expect(screen.queryAllByText(/Complete verification/i).length).toBeGreaterThan(0));
  });

  it('tracks KYC lifecycle events in the badge and banner', async () => {
    const screen = makeScreen();

    await sendMessage(screen, { event_id: 'TRANSAK_USER_KYC_FLOW_STARTS' });
    expect(screen.getByText('KYC IN PROGRESS')).toBeTruthy();
    expect(screen.getByText('Identity verification started.')).toBeTruthy();

    await sendMessage(screen, { event_id: 'TRANSAK_USER_KYC_VERIFIED' });
    expect(screen.getByText('KYC VERIFIED')).toBeTruthy();
    expect(screen.getByText('Identity verified. You can complete your order.')).toBeTruthy();

    await sendMessage(screen, { event_id: 'TRANSAK_USER_KYC_REJECTED' });
    expect(screen.getByText('KYC REVIEW NEEDED')).toBeTruthy();

    // Banner auto-dismisses after 4s.
    await act(async () => {
      jest.advanceTimersByTime(4100);
    });
    expect(screen.queryByText('Identity verification failed. Please try again or contact support.')).toBeNull();
  });

  it('tracks the order lifecycle and persists orders for the wallet', async () => {
    const screen = makeScreen();

    await sendMessage(screen, { event_id: 'TRANSAK_WIDGET_INITIALISED' });
    await sendMessage(screen, {
      event_id: 'TRANSAK_ORDER_CREATED',
      data: {
        id: 'ORDER-1',
        fiatAmount: 250,
        fiatCurrency: 'USD',
        cryptoAmount: '0.083333',
        cryptoCurrencyCode: 'ETH',
      },
    });
    expect(screen.getByText('ORDER INITIATED')).toBeTruthy();
    expect(screen.getAllByText(/Order created\. Continue in Transak\./).length).toBeGreaterThan(0);
    expect(mockSetLatestTransakOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'transak',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        flow: 'buy',
        status: 'initiated',
        orderId: 'ORDER-1',
        fiatAmount: '250',
        cryptoAmount: '0.083333',
        fiatCurrency: 'USD',
        cryptoCurrency: 'ETH',
      })
    );

    await sendMessage(screen, { event_id: 'TRANSAK_ORDER_PAYMENT_PROCESSING' });
    expect(screen.getByText('PAYMENT PROCESSING')).toBeTruthy();
    expect(screen.getAllByText(/Waiting for payment confirmation\./).length).toBeGreaterThan(0);

    await sendMessage(screen, {
      event_id: 'TRANSAK_ORDER_SUCCESSFUL',
      data: { cryptoAmount: 0.083333, cryptoCurrencyCode: 'ETH' },
    });
    expect(screen.getByText('0.0833 ETH')).toBeTruthy();
    expect(screen.getByText('Order successful. 0.083333 ETH is on the way.')).toBeTruthy();
    expect(screen.getAllByText(/Order completed successfully\./).length).toBeGreaterThan(0);
  });

  it('falls back to a generic success banner without amounts', async () => {
    const screen = makeScreen();

    await sendMessage(screen, { event_id: 'TRANSAK_ORDER_SUCCESSFUL', data: {} });
    expect(screen.getByText('ORDER COMPLETE')).toBeTruthy();
    expect(screen.getByText('Order successful.')).toBeTruthy();
  });

  it('handles order failure and hides the order pill', async () => {
    const screen = makeScreen();

    await sendMessage(screen, { event_id: 'TRANSAK_ORDER_CREATED', data: { id: 'O-2' } });
    expect(screen.getByText('ORDER INITIATED')).toBeTruthy();

    await sendMessage(screen, { event_id: 'TRANSAK_ORDER_FAILED' });
    await waitFor(() => expect(screen.queryByText('ORDER INITIATED')).toBeNull());
    expect(screen.getByText('Order failed. No funds were deducted.')).toBeTruthy();
  });

  it('does not persist orders when no wallet is connected', async () => {
    mockWalletState.address = null;
    const screen = makeScreen();

    await sendMessage(screen, { event_id: 'TRANSAK_ORDER_CREATED', data: { id: 'O-3' } });
    expect(screen.getByText('ORDER INITIATED')).toBeTruthy();
    expect(mockSetLatestTransakOrder).not.toHaveBeenCalled();
  });

  it('navigates back when Transak closes the widget', async () => {
    const screen = makeScreen();
    await sendMessage(screen, { event_id: 'TRANSAK_WIDGET_CLOSE' });
    expect(screen.navigation.goBack).toHaveBeenCalled();
  });

  it('closes via the shell back button', async () => {
    const screen = makeScreen();
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(screen.navigation.goBack).toHaveBeenCalled();
  });

  it('shows the error state on onError and retries', async () => {
    const screen = makeScreen();
    const view = getWebView(screen);

    await act(async () => {
      view.props.onError({ nativeEvent: { description: 'SSL failure' } });
    });
    expect(screen.getByText('Transak failed to load')).toBeTruthy();
    expect(screen.getByText('SSL failure')).toBeTruthy();
    expect(screen.getAllByText(/Unable to load the Transak widget\./).length).toBeGreaterThan(0);

    fireEvent.press(screen.getByLabelText('Retry loading Transak'));
    await waitFor(() => expect(screen.queryByText('Transak failed to load')).toBeNull());

    // Error again with no description → default copy.
    await act(async () => {
      view.props.onError({ nativeEvent: {} });
    });
    expect(screen.getByText('Transak could not be loaded.')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Close Transak'));
    expect(screen.navigation.goBack).toHaveBeenCalled();
  });

  it('shows the HTTP error state with the status code', async () => {
    const screen = makeScreen();
    const view = getWebView(screen);

    await act(async () => {
      view.props.onHttpError({ nativeEvent: { statusCode: 502 } });
    });
    expect(screen.getByText('Transak returned HTTP 502.')).toBeTruthy();
  });

  it('handles load start/end transitions', async () => {
    const screen = makeScreen();
    const view = getWebView(screen);

    await act(async () => {
      view.props.onLoadEnd();
    });
    expect(screen.getAllByText(/Complete verification and payment/).length).toBeGreaterThan(0);

    await act(async () => {
      view.props.onLoadStart();
    });
    expect(screen.getAllByText(/Loading secure checkout/).length).toBeGreaterThan(0);
  });

  it('uses SELL FLOW labeling for sell orders', () => {
    const screen = makeScreen({ flow: 'sell' });
    expect(screen.getAllByText(/SELL FLOW/).length).toBeGreaterThan(0);
  });
});
