import { renderHook } from '@testing-library/react-native';
import { usePushNotifications } from '../usePushNotifications';
import { useSettingsStore } from '../../stores/settingsStore';

jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: jest.fn(),
}));

jest.mock('../../utils/pushNotifications', () => ({
  registerForPushNotificationsAsync: jest.fn().mockResolvedValue('token123'),
}));

describe('usePushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSettingsStore as unknown as jest.Mock).mockReturnValue({
      pushToken: null,
      setPushToken: jest.fn(),
    });
  });

  it('renders without crashing', () => {
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current).toBeDefined();
  });
});
