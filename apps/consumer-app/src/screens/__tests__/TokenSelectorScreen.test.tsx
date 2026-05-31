import React from 'react';
import { render } from '@testing-library/react-native';
import { TokenSelectorScreen } from '../TokenSelectorScreen';
import { NavigationContainer } from '@react-navigation/native';
import { useWalletStore } from '../../stores/walletStore';

jest.mock('../../stores/walletStore');
jest.mock('../../hooks/useBalancePolling', () => ({
  useBalancePolling: jest.fn(),
}));

describe('TokenSelectorScreen', () => {
  beforeEach(() => {
    (useWalletStore as unknown as jest.Mock).mockReturnValue({
      address: '0x123',
    });
  });

  it('renders without crashing', () => {
    const { getByText } = render(
      <NavigationContainer>
        <TokenSelectorScreen navigation={{} as any} route={{ params: {} } as any} />
      </NavigationContainer>
    );
    expect(getByText('SELECT TOKEN')).toBeTruthy();
  });
});
