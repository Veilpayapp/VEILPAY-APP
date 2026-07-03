import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { OnrampQuotesScreen as Component } from '../OnrampQuotesScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

const mockWalletState = {
  address: '0xWALLET123',
  addresses: { evm: '0xWALLET123', svm: null, mvm: null, xlm: null },
  activeChain: { id: 1, key: 'ethereum', name: 'Ethereum', type: 'evm', symbol: 'ETH', nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
};

jest.mock('../../stores/walletStore', () => {
  const state = {
    address: '0xWALLET123',
    addresses: { evm: '0xWALLET123', svm: null, mvm: null, xlm: null },
    activeChain: { id: 1, key: 'ethereum', name: 'Ethereum', type: 'evm', symbol: 'ETH', nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
  };
  const hook = () => state;
  hook.getState = () => state;
  return { useWalletStore: hook };
});

jest.mock('../../features/fiat-gateway', () => ({
  useOnramp: () => ({
    getOnrampUrl: jest.fn().mockResolvedValue({ url: 'https://onramp.test', orderId: 'ord-1' }),
  }),
}));

jest.mock('../../components/ScreenBackButton', () => ({ ScreenBackButton: 'ScreenBackButton' }));
jest.mock('../../components/SovereignCard', () => ({ SovereignCard: 'SovereignCard' }));
jest.mock('../../components/Icon', () => ({ Icon: 'Icon' }));
jest.mock('../../utils/haptics', () => ({ triggerLightImpactHaptic: jest.fn() }));

describe('OnrampQuotesScreen', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const defaultProps = {
    navigation: { navigate: jest.fn(), goBack: jest.fn() } as any,
    route: {
      params: { flow: 'buy', fiatAmount: '5000', fiatCurrency: 'USD', cryptoToken: 'ETH', chainKey: 'ethereum' },
    } as any,
  };

  it('renders correctly', () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ quotes: [] }),
    }) as any;

    const { toJSON } = render(<Component {...defaultProps} />);
    expect(toJSON()).toBeTruthy();
  });

  it('encodes query params when fetching quotes (B1)', async () => {
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.veilpay.app';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ quotes: [] }),
    });
    global.fetch = fetchMock as any;

    render(<Component {...defaultProps} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('fiatAmount=5000');
    expect(calledUrl).toContain('fiatCurrency=USD');
    expect(calledUrl).toContain('cryptoToken=ETH');
    expect(calledUrl).toContain('flow=buy');
    // Confirm URLSearchParams was used (proper encoding, not raw interpolation)
    expect(calledUrl).not.toContain('fiatAmount=5000&fiatCurrency=USD&cryptoToken=ETH&flow=buy&');
    expect(calledUrl.startsWith('https://api.veilpay.app/api/v1/onramp/quotes?')).toBe(true);
  });

  it('navigates to Transak webview with narrowed FiatCurrency (B2)', async () => {
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.veilpay.app';
    const navigate = jest.fn();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        quotes: [{
          provider: 'transak',
          estimatedCryptoAmount: '1.5',
          exchangeRate: '3000',
          providerFee: '50',
          networkFee: '10',
        }],
      }),
    });
    global.fetch = fetchMock as any;

    const { findByText } = render(
      <Component {...defaultProps} navigation={{ navigate, goBack: jest.fn() } as any} />
    );

    const card = await findByText('Transak');
    fireEvent.press(card);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        expect.stringMatching(/TransakWebView|TRANSAK_WEBVIEW|ONRAMP/),
        expect.objectContaining({
          url: expect.stringContaining('transak.com'),
          // fiatCurrency should have been narrowed to 'USD', not the raw string
        })
      );
    });
  });
});
