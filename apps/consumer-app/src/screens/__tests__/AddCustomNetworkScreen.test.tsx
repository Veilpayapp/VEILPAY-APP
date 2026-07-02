import React from 'react';
import { render } from '@testing-library/react-native';
import { AddCustomNetworkScreen } from '../AddCustomNetworkScreen';
import { NavigationContainer } from '@react-navigation/native';

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: jest.fn().mockReturnValue({
    addCustomNetwork: jest.fn(),
  })
}));

describe('AddCustomNetworkScreen', () => {
  it('renders without crashing', () => {
    const { queryAllByText } = render(
      <NavigationContainer>
        <AddCustomNetworkScreen {...({ navigation: {}, route: { params: {} } } as any)} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Network/i).length).toBeGreaterThan(0);
  });
});
