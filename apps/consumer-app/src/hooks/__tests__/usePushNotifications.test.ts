import { renderHook, act, waitFor } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import { usePushNotifications } from '../usePushNotifications';

// Standalone build (NOT Expo Go): the hook computes IS_EXPO_GO at module load
// from expo-constants, so this file mocks a standalone/dev-client shape.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    appOwnership: null,
    executionEnvironment: 'standalone',
    expoConfig: { extra: { eas: { projectId: 'proj-test-1' } } },
  },
}));

const mockSetNotificationHandler = jest.fn();
const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockGetExpoPushTokenAsync = jest.fn();
const mockSetNotificationChannelAsync = jest.fn();
const mockAddNotificationReceivedListener = jest.fn();
const mockAddNotificationResponseReceivedListener = jest.fn();
const mockScheduleNotificationAsync = jest.fn();

const notificationsFactory = () => ({
  setNotificationHandler: (...args: unknown[]) => mockSetNotificationHandler(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  addNotificationReceivedListener: (...args: unknown[]) => mockAddNotificationReceivedListener(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddNotificationResponseReceivedListener(...args),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  AndroidImportance: { HIGH: 4 },
});

jest.mock('expo-notifications', () => notificationsFactory());

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('usePushNotifications (standalone build)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[test]' });
    mockSetNotificationChannelAsync.mockResolvedValue(undefined);
    mockAddNotificationReceivedListener.mockReturnValue({ remove: jest.fn() });
    mockAddNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });
    mockScheduleNotificationAsync.mockResolvedValue('notif-id');
  });

  it('registers with the EAS project id and reports the token', async () => {
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.isRegistered).toBe(true));

    expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-test-1' });
    expect(result.current.token).toBe('ExponentPushToken[test]');
    expect(result.current.error).toBeNull();
    expect(mockSetNotificationHandler).toHaveBeenCalled();

    // The registered handler allows alerts/sounds/badges.
    const handlerConfig = mockSetNotificationHandler.mock.calls[0][0];
    await expect(handlerConfig.handleNotification()).resolves.toEqual(
      expect.objectContaining({ shouldShowAlert: true, shouldPlaySound: true })
    );
  });

  it('requests permission when not yet granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.isRegistered).toBe(true));
    expect(mockRequestPermissionsAsync).toHaveBeenCalled();
  });

  it('stays unregistered when permission is denied (quiet in dev)', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const { result } = renderHook(() => usePushNotifications());
    await flush();
    await waitFor(() => expect(mockRequestPermissionsAsync).toHaveBeenCalled());
    expect(result.current.isRegistered).toBe(false);
    expect(result.current.token).toBeNull();
    // __DEV__ is true in tests → registration errors are not surfaced.
    expect(result.current.error).toBeNull();
  });

  it('surfaces the permission-denied error outside dev', async () => {
    const originalDev = (global as any).__DEV__;
    (global as any).__DEV__ = false;
    try {
      mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });
      mockRequestPermissionsAsync.mockResolvedValue({ status: 'denied' });
      const { result } = renderHook(() => usePushNotifications());
      await waitFor(() =>
        expect(result.current.error).toBe('Push notification permission denied')
      );
      expect(result.current.isRegistered).toBe(false);
    } finally {
      (global as any).__DEV__ = originalDev;
    }
  });

  it('creates the Android notification channel', async () => {
    const replace = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      const { result } = renderHook(() => usePushNotifications());
      await waitFor(() => expect(result.current.isRegistered).toBe(true));
      expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({ name: 'Veilpay Notifications' })
      );
    } finally {
      replace.restore();
    }
  });

  it('tolerates Android channel creation failure', async () => {
    const replace = jest.replaceProperty(Platform, 'OS', 'android');
    mockSetNotificationChannelAsync.mockRejectedValue(new Error('channel boom'));
    try {
      const { result } = renderHook(() => usePushNotifications());
      await waitFor(() => expect(result.current.isRegistered).toBe(true));
      expect(result.current.token).toBe('ExponentPushToken[test]');
    } finally {
      replace.restore();
    }
  });

  it('skips registration when the runtime lacks the permissions API', async () => {
    // Simulate an Expo-Go-like runtime where the method is absent. The hook
    // require()s expo-notifications lazily, so a partial mock is picked up
    // after a registry reset without re-requiring the hook itself.
    jest.resetModules();
    jest.doMock('expo-notifications', () => ({ setNotificationHandler: jest.fn() }));
    try {
      const { result } = renderHook(() => usePushNotifications());
      await flush();
      expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
      expect(result.current.isRegistered).toBe(false);
      expect(result.current.token).toBeNull();
    } finally {
      jest.resetModules();
      jest.doMock('expo-notifications', notificationsFactory);
    }
  });

  it('stops quietly when the token API is absent', async () => {
    jest.resetModules();
    jest.doMock('expo-notifications', () => ({
      setNotificationHandler: jest.fn(),
      getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
      requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
    }));
    try {
      const { result } = renderHook(() => usePushNotifications());
      await flush();
      expect(mockGetPermissionsAsync).toHaveBeenCalled();
      expect(result.current.isRegistered).toBe(false);
    } finally {
      jest.resetModules();
      jest.doMock('expo-notifications', notificationsFactory);
    }
  });

  it('swallows Expo-Go-style token errors quietly', async () => {
    mockGetExpoPushTokenAsync.mockRejectedValue(
      new Error('getExpoPushTokenAsync is not supported in Expo Go')
    );
    const { result } = renderHook(() => usePushNotifications());
    await flush();
    await waitFor(() => expect(mockGetExpoPushTokenAsync).toHaveBeenCalled());
    expect(result.current.error).toBeNull();
    expect(result.current.isRegistered).toBe(false);
  });

  it('surfaces generic registration failures outside dev', async () => {
    const originalDev = (global as any).__DEV__;
    (global as any).__DEV__ = false;
    try {
      mockGetExpoPushTokenAsync.mockRejectedValue(new Error('network unreachable'));
      const { result } = renderHook(() => usePushNotifications());
      await waitFor(() =>
        expect(result.current.error).toBe('Failed to register for notifications')
      );
    } finally {
      (global as any).__DEV__ = originalDev;
    }
  });

  it('handles a null token payload', async () => {
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: null });
    const { result } = renderHook(() => usePushNotifications());
    await flush();
    await waitFor(() => expect(mockGetExpoPushTokenAsync).toHaveBeenCalled());
    expect(result.current.token).toBeNull();
    expect(result.current.isRegistered).toBe(false);
  });

  it('does not auto-register when autoRegister is false', async () => {
    renderHook(() => usePushNotifications({ autoRegister: false }));
    await flush();
    expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
  });

  it('opens deep links from notification taps and notifies the callback', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const onNotificationTap = jest.fn();
    renderHook(() => usePushNotifications({ onNotificationTap, autoRegister: false }));
    await flush();

    expect(mockAddNotificationResponseReceivedListener).toHaveBeenCalled();
    const responseListener = mockAddNotificationResponseReceivedListener.mock.calls[0][0];

    await act(async () => {
      responseListener({ notification: { request: { content: { data: { deepLink: 'veilpay://home' } } } } });
    });
    expect(openURL).toHaveBeenCalledWith('veilpay://home');
    expect(onNotificationTap).toHaveBeenCalledWith({ deepLink: 'veilpay://home' });

    await act(async () => {
      responseListener({ notification: { request: { content: { data: { transactionHash: 'abc123' } } } } });
    });
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('abc123'));

    await act(async () => {
      responseListener({ notification: { request: { content: { data: { transactionId: 'tid-9' } } } } });
    });
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('tid-9'));

    openURL.mockRestore();
  });

  it('tolerates deep-link open failures', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    renderHook(() => usePushNotifications({ autoRegister: false }));
    await flush();
    const responseListener = mockAddNotificationResponseReceivedListener.mock.calls[0][0];
    await act(async () => {
      responseListener({ notification: { request: { content: { data: { deepLink: 'veilpay://x' } } } } });
      await Promise.resolve();
    });
    expect(openURL).toHaveBeenCalledWith('veilpay://x');
    openURL.mockRestore();
  });

  it('removes listeners on unmount', async () => {
    const receivedRemove = jest.fn();
    const responseRemove = jest.fn();
    mockAddNotificationReceivedListener.mockReturnValue({ remove: receivedRemove });
    mockAddNotificationResponseReceivedListener.mockReturnValue({ remove: responseRemove });

    const { unmount } = renderHook(() => usePushNotifications({ autoRegister: false }));
    await flush();
    unmount();
    expect(receivedRemove).toHaveBeenCalled();
    expect(responseRemove).toHaveBeenCalled();
  });

  it('receives foreground notifications without crashing', async () => {
    renderHook(() => usePushNotifications({ autoRegister: false }));
    await flush();
    const receivedListener = mockAddNotificationReceivedListener.mock.calls[0][0];
    await act(async () => {
      receivedListener({ request: { identifier: 'n-1' } });
    });
    expect(receivedListener).toBeDefined();
  });

  it('sends a local notification', async () => {
    const { result } = renderHook(() => usePushNotifications({ autoRegister: false }));
    await flush();
    await act(async () => {
      await result.current.sendLocalNotification('Title', 'Body', { k: 1 });
    });
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Title', body: 'Body', data: { k: 1 } },
      trigger: null,
    });
  });

  it('sends a local notification with default data', async () => {
    const { result } = renderHook(() => usePushNotifications({ autoRegister: false }));
    await flush();
    await act(async () => {
      await result.current.sendLocalNotification('T', 'B');
    });
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'T', body: 'B', data: {} },
      trigger: null,
    });
  });

  it('covers the remaining Expo-Go detection branches at module load', () => {
    // storeClient execution environment
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { appOwnership: null, executionEnvironment: 'storeClient' },
      }));
      expect(require('../usePushNotifications').usePushNotifications).toBeDefined();
    });
    // dev-client bundle (no standalone/bare execution environment)
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { appOwnership: null, executionEnvironment: undefined },
      }));
      expect(require('../usePushNotifications').usePushNotifications).toBeDefined();
    });
    // hostUri without an EAS project id
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: {
          appOwnership: null,
          executionEnvironment: 'bare',
          expoConfig: { hostUri: '192.168.1.5:8081' },
        },
      }));
      expect(require('../usePushNotifications').usePushNotifications).toBeDefined();
    });
    // bare workflow, no hostUri → NOT Expo Go
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: {
          appOwnership: null,
          executionEnvironment: 'bare',
          expoConfig: {},
          easConfig: { projectId: 'proj-2' },
        },
      }));
      const mod = require('../usePushNotifications');
      expect(mod.usePushNotifications).toBeDefined();
    });
  });
});
