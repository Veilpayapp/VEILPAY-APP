import React from 'react';
import { render } from '@testing-library/react-native';
import { ReceiveQRScreen } from '../ReceiveQRScreen';
import { NavigationContainer } from '@react-navigation/native';
import { useWalletStore } from '../../stores/walletStore';

jest.mock('../../stores/walletStore');

describe('ReceiveQRScreen', () => {
  beforeEach(() => {
    (useWalletStore as unknown as jest.Mock).mockReturnValue({
      address: '0x123',
    });
  });

  it('renders without crashing', () => {
    const { queryAllByText } = render(
      <NavigationContainer>
        <ReceiveQRScreen {...({ navigation: {}, route: { params: {} } } as any)} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Receive/i).length).toBeGreaterThan(0);
  });
});
