import { renderHook } from '@testing-library/react-native';
import { useSessionBootstrap } from '../useSessionBootstrap';
import { useWalletStore } from '../../stores/walletStore';
import { useSettingsStore } from '../../stores/settingsStore';

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: jest.fn(),
}));

jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: jest.fn(),
}));

describe('useSessionBootstrap', () => {
  beforeEach(() => {
    (useWalletStore as unknown as jest.Mock).mockReturnValue({
      reconnect: jest.fn(),
      isInitialized: false,
    });
    (useSettingsStore as unknown as jest.Mock).mockReturnValue({
      hasCompletedOnboarding: true,
      requiresBiometrics: false,
    });
  });

  it('initializes without crashing', () => {
    const { result } = renderHook(() => useSessionBootstrap());
    expect(result.current).toBeDefined();
  });
});
