import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { TokenSelectorScreen } from '../TokenSelectorScreen';
import { NavigationContainer } from '@react-navigation/native';
import { useWalletStore } from '../../stores/walletStore';

jest.mock('../../stores/walletStore');
jest.mock('../../hooks/useBalancePolling', () => ({
  useBalancePolling: jest.fn(),
}));
jest.mock('../../hooks/useBalance', () => ({
  useTokenBalances: () => ({ tokens: [], isLoading: false, error: null }),
}));
jest.mock('../../hooks/useMarketData', () => ({
  useMarketData: () => ({ quotes: {} }),
}));
jest.mock('../../utils/priceFeed', () => ({
  formatFiatValue: (n: number) => `$${n}`,
  getFiatExchangeRate: async () => 1,
}));
jest.mock('../../utils/stellarSpp', () => ({
  getLocalPrivateBalance: async () => ({ amount: '0', notes: [] }),
}));
jest.mock('../../stores/settingsStore', () => {
  const state = {
    theme: 'dark' as const,
    nativeCurrency: 'USD',
    selectedPrivacyAssetId: null as string | null,
  };
  const useSettingsStore = Object.assign(
    (selector?: (s: typeof state) => unknown) =>
      typeof selector === 'function' ? selector(state) : state,
    {
      getState: () => state,
    }
  );
  return {
    useSettingsStore,
    useThemeState: () => 'dark' as const,
    usePrivacyLevel: () => 'standard' as const,
    useNativeCurrency: () => 'USD',
  };
});


describe('TokenSelectorScreen', () => {
  beforeEach(() => {
    (useWalletStore as unknown as jest.Mock).mockReturnValue({
      address: 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME',
      activeChain: {
        key: 'stellar-testnet',
        type: 'xlm',
        name: 'Stellar Testnet',
        symbol: 'XLM',
        isTestnet: true,
      },
    });
  });

  it('renders and shows Privacy section on stellar-testnet', async () => {
    const { getByText } = render(
      <NavigationContainer>
        <TokenSelectorScreen
          navigation={{ goBack: jest.fn() } as any}
          route={{ params: { chainKey: 'stellar-testnet' } } as any}
        />
      </NavigationContainer>
    );
    expect(getByText('SELECT TOKEN')).toBeTruthy();
    await waitFor(() => {
      expect(getByText('Privacy')).toBeTruthy();
      expect(getByText('pXLM')).toBeTruthy();
    });
  });
});
