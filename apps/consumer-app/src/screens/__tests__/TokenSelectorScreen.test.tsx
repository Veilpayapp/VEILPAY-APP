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


function mockWallet(activeChain: Record<string, unknown>, address = '0xabc') {
  const chains = [activeChain];
  (useWalletStore as unknown as jest.Mock).mockReturnValue({
    address,
    balance: '0',
    activeChain,
    allChains: () => chains,
  });
}

describe('TokenSelectorScreen', () => {
  beforeEach(() => {
    mockWallet(
      {
        key: 'stellar-testnet',
        type: 'xlm',
        name: 'Stellar Testnet',
        symbol: 'XLM',
        isTestnet: true,
        nativeToken: { name: 'Stellar Lumens', symbol: 'XLM', decimals: 7 },
      },
      'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME'
    );
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

  it.each([
    {
      key: 'bsc',
      symbol: 'BNB',
      name: 'BNB',
      type: 'evm',
      absent: ['Ether', 'MATIC'],
    },
    {
      key: 'ethereum',
      symbol: 'ETH',
      name: 'Ether',
      type: 'evm',
      absent: ['BNB', 'MATIC'],
    },
    {
      key: 'polygon',
      symbol: 'MATIC',
      name: 'MATIC',
      type: 'evm',
      absent: ['BNB', 'Ether'],
    },
    {
      key: 'base',
      symbol: 'ETH',
      name: 'Ether',
      type: 'evm',
      absent: ['BNB', 'MATIC'],
    },
    {
      key: 'solana',
      symbol: 'SOL',
      name: 'Solana',
      type: 'svm',
      absent: ['Ether', 'BNB', 'MATIC'],
    },
  ])('shows $symbol for chain $key (not cross-chain natives)', async ({
    key,
    symbol,
    name,
    type,
    absent,
  }) => {
    mockWallet({
      key,
      type,
      name: key,
      symbol,
      nativeToken: { name, symbol, decimals: 18 },
    });

    const { getByText, getAllByText, queryByText } = render(
      <NavigationContainer>
        <TokenSelectorScreen
          navigation={{ goBack: jest.fn() } as any}
          route={{ params: { chainKey: key } } as any}
        />
      </NavigationContainer>
    );

    await waitFor(() => {
      expect(getAllByText(symbol).length).toBeGreaterThanOrEqual(1);
      expect(getByText('Assets')).toBeTruthy();
    });
    for (const label of absent) {
      expect(queryByText(label)).toBeNull();
    }
  });
});
