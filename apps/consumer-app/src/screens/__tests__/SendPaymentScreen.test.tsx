import React from 'react';
import { render } from '@testing-library/react-native';
import { SendPaymentScreen } from '../SendPaymentScreen';
import { NavigationContainer } from '@react-navigation/native';
import { useWalletStore } from '../../stores/walletStore';

jest.mock('../../stores/walletStore');

describe('SendPaymentScreen', () => {
  beforeEach(() => {
    (useWalletStore as unknown as jest.Mock).mockReturnValue({
      address: '0x123',
    });
  });

  it('renders without crashing', () => {
    const { queryAllByText } = render(
      <NavigationContainer>
        <SendPaymentScreen navigation={{} as any} route={{ params: {} } as any} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Send/i).length).toBeGreaterThan(0);
  });
});
