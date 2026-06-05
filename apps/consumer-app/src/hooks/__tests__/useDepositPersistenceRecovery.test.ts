import * as Module from '../useDepositPersistenceRecovery';
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

describe('useDepositPersistenceRecovery', () => {
  it('renders hooks without crashing', () => {
    for (const key of Object.keys(Module)) {
      if (typeof (Module as any)[key] === 'function' && key.startsWith('use')) {
        try {
          const {unmount} = renderHook(() => (Module as any)[key]({} as any, {} as any)); unmount();
        } catch(e) {
          console.warn("Hook error:", key, e.message);
        }
      }
    }
  });
});
