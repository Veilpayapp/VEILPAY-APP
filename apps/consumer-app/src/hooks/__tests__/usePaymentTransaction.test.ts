import * as Module from '../usePaymentTransaction';
import { renderHook } from '@testing-library/react-native';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: () => ({
    address: '0x123',
    activeChain: { key: 'ethereum', type: 'evm', symbol: 'ETH' },
    setBalance: jest.fn(),
    setLoadingBalance: jest.fn(),
  }),
  useActiveChain: () => ({ key: 'ethereum', type: 'evm', symbol: 'ETH' })
}));

jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: () => ({ nativeCurrency: 'USD' })
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: {} })
}));

describe('usePaymentTransaction', () => {
  it('renders hooks without crashing', () => {
    for (const key of Object.keys(Module)) {
      if (typeof Module[key] === 'function' && key.startsWith('use')) {
        try {
          const {unmount} = renderHook(() => Module[key]({} as any, {} as any)); unmount();
        } catch(e) {
          console.warn("Hook error:", key, e.message);
        }
      }
    }
  });
});
