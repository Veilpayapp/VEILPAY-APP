import { renderHook, act } from '@testing-library/react-native';
import { usePushNotifications } from '../usePushNotifications';

// Expo Go runtime: the hook computes IS_EXPO_GO at module load from
// expo-constants, so this file mocks the Expo Go shape — every push code path
// must short-circuit without touching the native module.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    appOwnership: 'expo',
    expoConfig: { extra: {} },
  },
}));

const mockGetPermissionsAsync = jest.fn();
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
}));

describe('usePushNotifications (Expo Go)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders with a null registration state', () => {
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current).toEqual(
      expect.objectContaining({ token: null, isRegistered: false, error: null })
    );
  });

  it('no-ops registration and never touches the native module', async () => {
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {
      await result.current.registerForPushNotifications();
    });
    expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.isRegistered).toBe(false);
  });

  it('no-ops local notifications', async () => {
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => {
      await result.current.sendLocalNotification('Title', 'Body');
    });
    expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
    expect(result.current.token).toBeNull();
  });
});
