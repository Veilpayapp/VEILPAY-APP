import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SendPaymentScreen } from '../SendPaymentScreen';
import { NavigationContainer } from '@react-navigation/native';
import { useWalletStore } from '../../stores/walletStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { SCREENS } from '../../constants/screens';

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: jest.fn(),
  validateAddress: jest.fn((addr: string, chainType: string) =>
    chainType === 'xlm'
      ? /^G[A-Z2-7]{55}$/.test(addr)
      : /^0x[0-9a-fA-F]{40}$/.test(addr)
  ),
}));

const mockAuthenticate = jest.fn();
jest.mock('../../hooks/useBiometrics', () => ({
  useBiometrics: () => ({ authenticate: mockAuthenticate }),
}));

jest.mock('../../hooks/useMarketData', () => ({
  useMarketData: () => ({
    getQuote: () => ({
      symbol: 'ETH',
      price: 3000,
      change24h: 1.2,
      lastUpdated: 1700000000000,
      source: 'mock',
      isStale: false,
    }),
  }),
}));

const mockGetClipboardString = jest.fn();
jest.mock('../../utils/clipboard', () => ({
  getClipboardString: (...args: unknown[]) => mockGetClipboardString(...args),
}));

const mockGetLocalPrivateBalance = jest.fn();
jest.mock('../../utils/stellarSpp', () => ({
  getLocalPrivateBalance: (...args: unknown[]) => mockGetLocalPrivateBalance(...args),
}));

const mockFetchNativeBalance = jest.fn();
jest.mock('../../utils/balanceFetcher', () => ({
  fetchNativeBalance: (...args: unknown[]) => mockFetchNativeBalance(...args),
}));

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

jest.mock('../../components/dashboard/AddressBookModal', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    AddressBookModal: ({ visible, onSelect, onClose }: any) =>
      visible ? (
        <View>
          <TouchableOpacity onPress={() => onSelect('0xAB5801a7D398351b8bE11C439e05C5B3259aeC9B')}>
            <Text>Pick saved address</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose}>
            <Text>Close address book</Text>
          </TouchableOpacity>
        </View>
      ) : null,
  };
});

function renderScreen(routeParams: Record<string, unknown> = {}) {
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()) };
  const screen = render(
    <NavigationContainer>
      <SendPaymentScreen navigation={navigation as any} route={{ params: routeParams } as any} />
    </NavigationContainer>
  );
  return { ...screen, navigation };
}

describe('SendPaymentScreen', () => {
  beforeEach(() => {
    (useWalletStore as unknown as jest.Mock).mockReturnValue({
      address: '0x123',
    });
  });

  it('renders without crashing', () => {
    const { queryAllByText } = renderScreen();
    expect(queryAllByText(/Send/i).length).toBeGreaterThan(0);
  });

  // A11Y-001: screen-reader smoke. The money-flow entry controls must expose
  // stable accessibility labels so a VoiceOver/TalkBack user can complete a
  // send without relying on placeholder-only hints. This is a presence check,
  // not a full WCAG audit — it locks in the labels so a refactor can't silently
  // drop them.
  describe('accessibility labels (A11Y-001)', () => {
    it('labels the recipient and amount inputs', () => {
      const { getByLabelText } = renderScreen();
      expect(getByLabelText('Recipient address')).toBeTruthy();
      expect(getByLabelText('Payment amount')).toBeTruthy();
    });

    it('labels the memo input and quick-amount controls', () => {
      const { getByLabelText } = renderScreen();
      expect(getByLabelText('Payment memo, optional')).toBeTruthy();
      expect(getByLabelText('Use maximum available amount')).toBeTruthy();
      expect(getByLabelText('Use 25% of balance')).toBeTruthy();
    });

    it('exposes an accessible available-balance summary', () => {
      const { getByLabelText } = renderScreen();
      // Balance value is dynamic; assert the summary prefix is present.
      expect(getByLabelText(/^Available balance /)).toBeTruthy();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Round-5 coverage extension: the line-1 `istanbul ignore file` directive was
// removed from this screen; the suites below exercise the newly-visible
// branches (form handlers, paste/URI parsing, quick amounts, USD toggle,
// privacy modes, continue/auth flow).
// ────────────────────────────────────────────────────────────────────────────

const EVM_CHAIN: any = {
  key: 'ethereum',
  name: 'Ethereum',
  type: 'evm',
  symbol: 'ETH',
  nativeToken: { symbol: 'ETH', name: 'Ether' },
  isTestnet: false,
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
const EVM_ADDR_2 = '0xAB5801a7D398351b8bE11C439e05C5B3259aeC9B';
const XLM_ADDR = `G${'A'.repeat(55)}`;

const setWallet = (over: Record<string, unknown> = {}) => {
  (useWalletStore as unknown as jest.Mock).mockReturnValue({
    address: EVM_ADDR,
    balance: '1.234',
    activeChain: EVM_CHAIN,
    ...over,
  });
};

describe('SendPaymentScreen — form handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWallet();
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGetLocalPrivateBalance.mockResolvedValue({ amount: '4.25' });
    mockFetchNativeBalance.mockResolvedValue({ subentryCount: 3 });
    mockGetClipboardString.mockResolvedValue('');
  });

  afterEach(() => {
    useSettingsStore.getState().setSelectedPrivacyAssetId(null);
  });

  it('navigates back and to the QR scanner', async () => {
    const { getByLabelText, navigation } = renderScreen();
    fireEvent.press(getByLabelText('Go back'));
    expect(navigation.goBack).toHaveBeenCalled();

    fireEvent.press(getByLabelText('Scan QR code'));
    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.QR_SCANNER);
  });

  it('filters amount input to a single decimal point', () => {
    const { getByTestId } = renderScreen();
    const input = getByTestId('send-amount-input');
    fireEvent.changeText(input, '1.2.3');
    expect(input.props.value).toBe('1.23');
    fireEvent.changeText(input, '0a5');
    expect(input.props.value).toBe('05');
  });

  it('shows recipient and amount validation copy after edits', async () => {
    const { getByTestId, getByLabelText, queryByText } = renderScreen();
    fireEvent.changeText(getByLabelText('Recipient address'), 'not-an-address');
    fireEvent(getByLabelText('Recipient address'), 'blur');
    await waitFor(() =>
      expect(queryByText('Enter a valid Ethereum address.')).toBeTruthy()
    );

    const amountInput = getByTestId('send-amount-input');
    fireEvent.changeText(amountInput, '5');
    fireEvent(amountInput, 'blur');
    await waitFor(() =>
      expect(queryByText(/Amount exceeds your available balance/)).toBeTruthy()
    );

    fireEvent.changeText(amountInput, '');
    await waitFor(() => expect(queryByText('Amount is required.')).toBeTruthy());

    fireEvent.changeText(amountInput, '0');
    await waitFor(() =>
      expect(queryByText('Enter a valid amount greater than 0.')).toBeTruthy()
    );
  });

  it('fills 25% of the balance via quick amounts and MAX via the reserve helper', async () => {
    const { getByLabelText, getByTestId } = renderScreen();
    fireEvent.press(getByLabelText('Use 25% of balance'));
    expect(getByTestId('send-amount-input').props.value).toBe('0.308500');

    fireEvent.press(getByLabelText('Use maximum available amount'));
    const maxValue = getByTestId('send-amount-input').props.value;
    expect(Number.parseFloat(maxValue)).toBeGreaterThan(0);
    expect(Number.parseFloat(maxValue)).toBeLessThan(1.234);
  });

  it('uses the Stellar subentry-aware reserve for MAX on xlm chains', async () => {
    setWallet({ activeChain: XLM_CHAIN, balance: '10.0' });
    const { getByLabelText, getByTestId } = renderScreen();
    await waitFor(() => expect(mockFetchNativeBalance).toHaveBeenCalled());

    // Press MAX once the subentry count has landed; retry inside waitFor until
    // the reserve math reflects it (10 XLM less fee + (2 + 3) x 0.5 ≈ 7.49).
    await waitFor(() => {
      fireEvent.press(getByLabelText('Use maximum available amount'));
      const v = Number.parseFloat(getByTestId('send-amount-input').props.value);
      expect(v).toBeGreaterThan(7);
      expect(v).toBeLessThan(8);
    });
  });

  it('toggles between crypto and fiat entry with conversion', () => {
    const { getByTestId, getByLabelText, getByText } = renderScreen();
    const amountInput = getByTestId('send-amount-input');

    // Empty amount: toggle only flips the unit.
    fireEvent.press(getByText('SWAP TO USD'));
    expect(getByText('SWAP TO ETH')).toBeTruthy();

    // Enter 3000 USD → switch to crypto converts at the mocked 3000 USD/ETH.
    fireEvent.changeText(amountInput, '3000');
    fireEvent.press(getByText('SWAP TO ETH'));
    expect(getByTestId('send-amount-input').props.value).toBe('1.000000');

    // Back to fiat: 1 ETH → 3000 USD.
    fireEvent.press(getByText('SWAP TO USD'));
    expect(getByTestId('send-amount-input').props.value).toBe('3000.00');

    expect(getByLabelText('Payment amount')).toBeTruthy();
  });

  it('shows the fiat equivalent row when a price is available', async () => {
    const { getByTestId, queryByText } = renderScreen();
    fireEvent.changeText(getByTestId('send-amount-input'), '0.5');
    await waitFor(() => expect(queryByText(/≈ \$/)).toBeTruthy());
  });

  it('opens the address book and applies a picked address', async () => {
    const { getByLabelText, getByText, queryByText } = renderScreen();
    fireEvent.press(getByLabelText('Open address book'));
    await waitFor(() => expect(getByText('Pick saved address')).toBeTruthy());

    fireEvent.press(getByText('Pick saved address'));
    await waitFor(() =>
      expect(getByLabelText('Recipient address').props.value).toBe(EVM_ADDR_2)
    );

    fireEvent.press(getByLabelText('Open address book'));
    fireEvent.press(getByText('Close address book'));
    await waitFor(() => expect(queryByText('Pick saved address')).toBeNull());
  });
});

describe('SendPaymentScreen — paste handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWallet();
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGetLocalPrivateBalance.mockResolvedValue({ amount: '4.25' });
    mockFetchNativeBalance.mockResolvedValue({ subentryCount: 3 });
  });

  it('reports an empty clipboard', async () => {
    mockGetClipboardString.mockResolvedValue('');
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText('Paste from clipboard'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Clipboard unavailable or empty', 'error')
    );
  });

  it('parses an ethereum: URI with amount', async () => {
    mockGetClipboardString.mockResolvedValue(`ethereum:${EVM_ADDR_2}?amount=0.25`);
    const { getByLabelText, getByTestId } = renderScreen();
    fireEvent.press(getByLabelText('Paste from clipboard'));
    await waitFor(() =>
      expect(getByLabelText('Recipient address').props.value).toBe(EVM_ADDR_2)
    );
    expect(getByTestId('send-amount-input').props.value).toBe('0.25');
    expect(mockToastShow).toHaveBeenCalledWith('Payment details pasted from clipboard', 'success');
  });

  it('parses a veilpay:// send link', async () => {
    mockGetClipboardString.mockResolvedValue(
      `veilpay://send?address=${EVM_ADDR_2}&amount=1.5`
    );
    const { getByLabelText, getByTestId } = renderScreen();
    fireEvent.press(getByLabelText('Paste from clipboard'));
    await waitFor(() =>
      expect(getByLabelText('Recipient address').props.value).toBe(EVM_ADDR_2)
    );
    expect(getByTestId('send-amount-input').props.value).toBe('1.5');
  });

  it('accepts a plain address', async () => {
    mockGetClipboardString.mockResolvedValue(EVM_ADDR_2);
    const { getByLabelText, getByTestId } = renderScreen();
    fireEvent.press(getByLabelText('Paste from clipboard'));
    await waitFor(() =>
      expect(getByLabelText('Recipient address').props.value).toBe(EVM_ADDR_2)
    );
    expect(getByTestId('send-amount-input').props.value).toBe('');
  });
});

describe('SendPaymentScreen — continue flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWallet();
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGetLocalPrivateBalance.mockResolvedValue({ amount: '4.25' });
    mockFetchNativeBalance.mockResolvedValue({ subentryCount: 3 });
    mockGetClipboardString.mockResolvedValue('');
  });

  afterEach(() => {
    useSettingsStore.getState().setSelectedPrivacyAssetId(null);
  });

  const fillValidForm = async (screen: ReturnType<typeof renderScreen>, amount = '0.5') => {
    fireEvent.changeText(screen.getByLabelText('Recipient address'), EVM_ADDR_2);
    fireEvent.changeText(screen.getByTestId('send-amount-input'), amount);
    await waitFor(() =>
      expect(screen.getByTestId('send-continue-button')).toBeTruthy()
    );
  };

  it('continues to privacy-level selection after authentication', async () => {
    const screen = renderScreen();
    await fillValidForm(screen);

    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() =>
      expect(screen.navigation.navigate).toHaveBeenCalledWith(
        SCREENS.PRIVACY_LEVEL,
        expect.objectContaining({ recipient: EVM_ADDR_2, amount: '0.5', token: 'ETH' })
      )
    );
    expect(mockAuthenticate).toHaveBeenCalledWith('send_payment', true);
  });

  it('debounces rapid continue attempts', async () => {
    // Auth-failure path so the button re-enables between attempts (a success
    // unmounts this screen in production; the mocked navigate leaves it mounted).
    mockAuthenticate.mockResolvedValue({ success: false, cancelled: true });
    const screen = renderScreen();
    await fillValidForm(screen);

    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Authentication cancelled', 'error')
    );
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);

    // Inside the 1200ms debounce window: second attempt is swallowed.
    fireEvent.press(screen.getByTestId('send-continue-button'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);

    // After the window: the attempt goes through.
    await act(async () => {
      jest.advanceTimersByTime(1300);
    });
    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() => expect(mockAuthenticate).toHaveBeenCalledTimes(2));
  });

  it('surfaces cancelled and failed authentication', async () => {
    mockAuthenticate.mockResolvedValue({ success: false, cancelled: true });
    const screen = renderScreen();
    await fillValidForm(screen);
    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Authentication cancelled', 'error')
    );

    mockAuthenticate.mockResolvedValue({ success: false, cancelled: false });
    await act(async () => {
      jest.advanceTimersByTime(1300);
    });
    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith('Authentication failed', 'error')
    );
    expect(screen.navigation.navigate).not.toHaveBeenCalledWith(
      SCREENS.PRIVACY_LEVEL,
      expect.anything()
    );
  });

  it('converts a fiat amount to crypto for confirmation', async () => {
    const screen = renderScreen();
    fireEvent.changeText(screen.getByLabelText('Recipient address'), EVM_ADDR_2);
    fireEvent.press(screen.getByText('SWAP TO USD'));
    fireEvent.changeText(screen.getByTestId('send-amount-input'), '1500');

    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() =>
      expect(screen.navigation.navigate).toHaveBeenCalledWith(
        SCREENS.PRIVACY_LEVEL,
        expect.objectContaining({ amount: '0.500000' })
      )
    );
  });

  it('prefills address and amount from route params (QR scan)', () => {
    const screen = renderScreen({ address: EVM_ADDR_2, amount: '0.75' });
    expect(screen.getByLabelText('Recipient address').props.value).toBe(EVM_ADDR_2);
    expect(screen.getByTestId('send-amount-input').props.value).toBe('0.75');
  });

  it('opens the token selector and applies the selection callbacks', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByLabelText(/Selected token ETH/));
    expect(screen.navigation.navigate).toHaveBeenCalledWith(
      SCREENS.TOKEN_SELECTOR,
      expect.objectContaining({ chainKey: 'ethereum', selectedSymbol: 'ETH' })
    );

    const { onSelect } = (screen.navigation.navigate as jest.Mock).mock.calls.find(
      ([name]) => name === SCREENS.TOKEN_SELECTOR
    )[1];

    // Selecting a privacy token flips the mode to transfer.
    await act(async () => {
      onSelect({
        id: 'stellar-testnet-XLM',
        name: 'Private XLM',
        symbol: 'pXLM',
        balance: '4',
        usdPrice: 0,
        chainTypes: ['xlm'],
        isPrivacyAsset: true,
        privacyAssetId: 'spp-xlm-testnet',
      });
    });
    expect(useSettingsStore.getState().selectedPrivacyAssetId).toBe('spp-xlm-testnet');
    await waitFor(() => expect(screen.getAllByText('SEND PRIVATELY').length).toBeGreaterThan(0));

    // Selecting a public token returns to public mode.
    await act(async () => {
      onSelect({
        id: 'ethereum-ETH',
        name: 'Ether',
        symbol: 'ETH',
        balance: '1.234',
        usdPrice: 0,
        chainTypes: ['evm'],
      });
    });
    await waitFor(() => expect(screen.getAllByText('SEND PAYMENT').length).toBeGreaterThan(0));
  });
});

describe('SendPaymentScreen — privacy modes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWallet({ activeChain: XLM_CHAIN, balance: '10.0', address: XLM_ADDR });
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGetLocalPrivateBalance.mockResolvedValue({ amount: '4.25' });
    mockFetchNativeBalance.mockResolvedValue({ subentryCount: 3 });
    mockGetClipboardString.mockResolvedValue('');
  });

  afterEach(() => {
    useSettingsStore.getState().setSelectedPrivacyAssetId(null);
  });

  it('shield mode hides the recipient and confirms straight to the pool', async () => {
    const screen = renderScreen({ mode: 'shield', privacyAssetId: 'spp-xlm-testnet', lockMode: true });
    expect(screen.getAllByText('SHIELD').length).toBeGreaterThan(0);
    expect(screen.getByText('TO YOUR PRIVATE BALANCE')).toBeTruthy();
    expect(screen.queryByLabelText('Recipient address')).toBeNull();

    fireEvent.changeText(screen.getByTestId('send-amount-input'), '2');
    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() =>
      expect(screen.navigation.navigate).toHaveBeenCalledWith(
        SCREENS.PAYMENT_CONFIRMATION,
        expect.objectContaining({
          recipient: XLM_ADDR,
          amount: '2',
          privacyLevel: 'private',
          sppOp: 'shield',
        })
      )
    );
  });

  it('transfer mode sends privately to a G… recipient', async () => {
    const screen = renderScreen({ mode: 'transfer', privacyAssetId: 'spp-xlm-testnet', lockMode: true });
    expect(screen.getAllByText('SEND PRIVATELY').length).toBeGreaterThan(0);
    expect(screen.getByText('FROM PRIVATE BALANCE')).toBeTruthy();
    await waitFor(() => expect(mockGetLocalPrivateBalance).toHaveBeenCalled());

    fireEvent.changeText(screen.getByLabelText('Recipient address'), XLM_ADDR);
    fireEvent.changeText(screen.getByTestId('send-amount-input'), '1');
    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() =>
      expect(screen.navigation.navigate).toHaveBeenCalledWith(
        SCREENS.PAYMENT_CONFIRMATION,
        expect.objectContaining({
          recipient: XLM_ADDR,
          privacyLevel: 'private',
          sppOp: 'transfer',
        })
      )
    );
  });

  it('unshield mode defaults the destination to the wallet itself', async () => {
    const screen = renderScreen({ mode: 'unshield', privacyAssetId: 'spp-xlm-testnet', lockMode: true });
    expect(screen.getAllByText('UNSHIELD').length).toBeGreaterThan(0);
    expect(screen.getByText('PUBLIC ADDRESS (OPTIONAL)')).toBeTruthy();

    // Continue unlocks only after the private balance lands (exceeds check).
    await waitFor(() =>
      expect(screen.getByLabelText(/^Available balance /).props.accessibilityLabel).toContain('4.25')
    );
    fireEvent.changeText(screen.getByTestId('send-amount-input'), '1');
    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() =>
      expect(screen.navigation.navigate).toHaveBeenCalledWith(
        SCREENS.PAYMENT_CONFIRMATION,
        expect.objectContaining({ recipient: XLM_ADDR, sppOp: 'unshield' })
      )
    );
  });

  it('shows the empty-private-balance card and switches to shield', async () => {
    mockGetLocalPrivateBalance.mockResolvedValue({ amount: '0' });
    const screen = renderScreen({ mode: 'transfer', privacyAssetId: 'spp-xlm-testnet', lockMode: true });

    await waitFor(() => expect(screen.getByText('NO PRIVATE BALANCE YET')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Shield XLM'));
    await waitFor(() => expect(screen.getAllByText('SHIELD').length).toBeGreaterThan(0));
  });

  it('shows mode chips in a privacy context and switches modes', async () => {
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText('Send privately')).toBeTruthy());

    fireEvent.press(screen.getByText('Send privately'));
    await waitFor(() => expect(screen.getAllByText('SEND PRIVATELY').length).toBeGreaterThan(0));

    fireEvent.press(screen.getByText('Shield'));
    await waitFor(() => expect(screen.getAllByText('SHIELD').length).toBeGreaterThan(0));

    fireEvent.press(screen.getByText('Unshield'));
    await waitFor(() => expect(screen.getAllByText('UNSHIELD').length).toBeGreaterThan(0));
  });

  it('routes a public send to private confirmation when pXLM is selected', async () => {
    useSettingsStore.getState().setSelectedPrivacyAssetId('spp-xlm-testnet');
    const screen = renderScreen();

    // Token selector callback picking the privacy asset.
    fireEvent.press(screen.getByLabelText(/Selected token/));
    const { onSelect } = (screen.navigation.navigate as jest.Mock).mock.calls.find(
      ([name]) => name === SCREENS.TOKEN_SELECTOR
    )[1];
    await act(async () => {
      onSelect({
        id: 'stellar-testnet-XLM',
        name: 'Private XLM',
        symbol: 'pXLM',
        balance: '4',
        usdPrice: 0,
        chainTypes: ['xlm'],
        isPrivacyAsset: true,
        privacyAssetId: 'spp-xlm-testnet',
      });
    });

    fireEvent.changeText(screen.getByLabelText('Recipient address'), XLM_ADDR);
    fireEvent.changeText(screen.getByTestId('send-amount-input'), '1');
    fireEvent.press(screen.getByTestId('send-continue-button'));
    await waitFor(() =>
      expect(screen.navigation.navigate).toHaveBeenCalledWith(
        SCREENS.PAYMENT_CONFIRMATION,
        expect.objectContaining({ privacyLevel: 'private', sppOp: 'transfer' })
      )
    );
  });
});
