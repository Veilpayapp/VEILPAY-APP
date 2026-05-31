import React from 'react';
import { render } from '@testing-library/react-native';
import { OnrampQuotesScreen as Component } from '../OnrampQuotesScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: () => ({
    activeChain: { id: 'ethereum', name: 'Ethereum', currency: 'ETH' },
  }),
}));

jest.mock('../../features/fiat-gateway', () => ({
  useOnramp: () => ({
    quotes: [{ providerId: 'transak', cryptoAmount: 1, fiatAmount: 100 }],
    isFetchingQuotes: false,
    fetchQuotes: jest.fn(),
  }),
}));

jest.mock('../../components/ScreenBackButton', () => ({ ScreenBackButton: 'ScreenBackButton' }));
jest.mock('../../components/SovereignCard', () => ({ SovereignCard: 'SovereignCard' }));
jest.mock('../../components/Icon', () => ({ Icon: 'Icon' }));

describe('OnrampQuotesScreen', () => {
  it('renders correctly', () => {
    const props: any = {
      navigation: { navigate: jest.fn(), goBack: jest.fn() } as any,
      route: { params: { flow: 'buy', fiatAmount: '100', cryptoToken: 'ETH', chainKey: 'ethereum' } } as any,
    };

    const { toJSON } = render(<Component {...props} />);
    expect(toJSON()).toBeTruthy();
  });
});
