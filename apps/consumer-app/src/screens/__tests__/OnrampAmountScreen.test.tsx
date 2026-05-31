import React from 'react';
import { render } from '@testing-library/react-native';
import { OnrampAmountScreen as Component } from '../OnrampAmountScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: () => ({
    activeChain: { id: 'ethereum', name: 'Ethereum', currency: 'ETH' },
  }),
}));

jest.mock('../../components/ScreenBackButton', () => ({ ScreenBackButton: 'ScreenBackButton' }));
jest.mock('../../components/SovereignButton', () => ({ SovereignButton: 'SovereignButton' }));
jest.mock('../../components/SovereignCard', () => ({ SovereignCard: 'SovereignCard' }));
jest.mock('../../components/Icon', () => ({ Icon: 'Icon' }));

describe('OnrampAmountScreen', () => {
  it('renders correctly', () => {
    const props: any = {
      navigation: { navigate: jest.fn(), goBack: jest.fn() } as any,
      route: { params: { flow: 'buy' } } as any,
    };

    const { toJSON } = render(<Component {...props} />);
    expect(toJSON()).toBeTruthy();
  });
});
