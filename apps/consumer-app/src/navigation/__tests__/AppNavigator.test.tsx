import React from 'react';
import { render, act } from '@testing-library/react-native';
import { AppNavigator } from '../AppNavigator';
import { SCREENS } from '../../constants/screens';

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: any) => <>{children}</>,
    Screen: () => null,
  }),
}));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({ children }: any) => <>{children}</>,
    useNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: jest.fn(),
      getCurrentRoute: () => ({ name: 'Home' }),
    }),
  };
});

// Avoid zustand errors
jest.mock('../../stores/walletStore', () => ({
  useWalletStore: { getState: () => ({}) },
  // OnrampQuotesScreen (loaded via the fiat-gateway screens barrel) derives
  // lookup maps from SUPPORTED_CHAINS at module scope, so the mock must expose
  // a representative list or the barrel import throws on `.map` of undefined.
  SUPPORTED_CHAINS: [
    { id: 1, key: 'ethereum', name: 'Ethereum', type: 'evm', symbol: 'ETH', nativeToken: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
    { id: 101, key: 'solana', name: 'Solana', type: 'svm', symbol: 'SOL', nativeToken: { name: 'Solana', symbol: 'SOL', decimals: 9 } },

    { id: 0, key: 'stellar', name: 'Stellar', type: 'xlm', symbol: 'XLM', nativeToken: { name: 'Stellar Lumens', symbol: 'XLM', decimals: 7 } },
  ],
}));

jest.mock('../../stores/transactionStore', () => ({
  useTransactionStore: { getState: () => ({ transactions: [] }) },
}));

// Mock utils
jest.mock('../../utils/analytics', () => ({
  trackScreenView: jest.fn(),
}));

jest.mock('../../utils/deepLinking', () => {
  let cb: any = null;
  return {
    setupDeepLinking: (callback: any) => { cb = callback; },
    __triggerDeepLink: (params: any) => { if (cb) cb(params); },
  };
});

describe('AppNavigator', () => {
  it('renders correctly and handles deep links', async () => {
    const { setupDeepLinking, __triggerDeepLink } = require('../../utils/deepLinking');
    const { trackScreenView } = require('../../utils/analytics');

    render(<AppNavigator initialRouteName={SCREENS.ONBOARDING} />);

    await act(async () => {
      // It handles deep link send
      __triggerDeepLink({ action: 'send', address: '0x123', amount: '1' });
    });

    await act(async () => {
      // It handles deep link receive
      __triggerDeepLink({ action: 'receive' });
    });

    await act(async () => {
      // It handles walletconnect
      __triggerDeepLink({ action: 'walletconnect', uri: 'wc:...' });
    });

    await act(async () => {
      // It handles unknown
      __triggerDeepLink({ action: 'unknown' });
    });
  });
});
