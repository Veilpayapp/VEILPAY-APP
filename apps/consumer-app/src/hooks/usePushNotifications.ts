// Removed top-level import of expo-notifications to prevent Expo Go Android crash
import { useState, useEffect, useRef, useCallback } from 'react';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { createTransactionLink } from '../utils/deepLinking';

function isRunningInExpoGo(): boolean {
  if ((Constants as { appOwnership?: string | null }).appOwnership === 'expo') {
    return true;
  }

  const executionEnv = Constants.executionEnvironment;
  if (executionEnv === 'storeClient') {
    return true;
  }

  if (__DEV__ && executionEnv !== 'standalone' && executionEnv !== 'bare') {
    return true;
  }

  const expoConfig = Constants.expoConfig;
  if (expoConfig?.hostUri && !Constants?.easConfig?.projectId) {
    return true;
  }

  return false;
}

const IS_EXPO_GO = isRunningInExpoGo();

function configureNotificationHandler() {
  if (IS_EXPO_GO) {
    return;
  }

  try {
    const Notifications = require('expo-notifications');
    if (typeof Notifications.setNotificationHandler === 'function') {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
    }
  } catch {
    // Silently fail
  }
}

// Ensure configure is called in a safe way if needed, but not immediately at top level to avoid Expo Go crash.
// We will call it lazily.
let isConfigured = false;
function ensureConfigured() {
  if (!isConfigured) {
    configureNotificationHandler();
    isConfigured = true;
  }
}

export type NotificationStatus = {
  token: string | null;
  isRegistered: boolean;
  error: string | null;
};

type UsePushNotificationsOptions = {
  autoRegister?: boolean;
  onNotificationTap?: (data: Record<string, unknown>) => void;
};

function getProjectId(): string | null {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId ??
    null
  );
}

export function usePushNotifications(options: UsePushNotificationsOptions = {}) {
  const { autoRegister = true, onNotificationTap } = options;
  const shouldSurfaceRegistrationError = !__DEV__;
  const [status, setStatus] = useState<NotificationStatus>({
    token: null,
    isRegistered: false,
    error: null,
  });
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const registerForPushNotifications = useCallback(async () => {
    if (IS_EXPO_GO) {
      if (isMountedRef.current) {
        setStatus({ token: null, isRegistered: false, error: null });
      }
      return;
    }

    try {
      ensureConfigured();
      const Notifications = require('expo-notifications');

      if (typeof Notifications.getPermissionsAsync !== 'function') {
        if (isMountedRef.current) {
          setStatus({ token: null, isRegistered: false, error: null });
        }
        return;
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        if (typeof Notifications.requestPermissionsAsync !== 'function') {
          if (isMountedRef.current) {
            setStatus({ token: null, isRegistered: false, error: null });
          }
          return;
        }
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        if (isMountedRef.current) {
          setStatus({
            token: null,
            isRegistered: false,
            error: shouldSurfaceRegistrationError ? 'Push notification permission denied' : null,
          });
        }
        return;
      }

      if (typeof Notifications.getExpoPushTokenAsync !== 'function') {
        if (isMountedRef.current) {
          setStatus({ token: null, isRegistered: false, error: null });
        }
        return;
      }

      const projectId = getProjectId();
      const tokenResult = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();

      const token = tokenResult?.data ?? null;

      if (!token) {
        if (isMountedRef.current) {
          setStatus({ token: null, isRegistered: false, error: null });
        }
        return;
      }

      if (Platform.OS === 'android' && typeof Notifications.setNotificationChannelAsync === 'function') {
        try {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Veilpay Notifications',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#6366F1',
          });
        } catch {
          // Channel creation failure is non-fatal
        }
      }

      if (isMountedRef.current) {
        setStatus({ token, isRegistered: true, error: null });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isExpoGoError =
        errorMessage.includes('Expo Go') ||
        errorMessage.includes('getExpoPushTokenAsync') ||
        errorMessage.includes('not supported') ||
        errorMessage.includes('not available') ||
        errorMessage.includes('UNAVAILABLE');

      if (isMountedRef.current) {
        setStatus({
          token: null,
          isRegistered: false,
          error: isExpoGoError ? null : (shouldSurfaceRegistrationError ? 'Failed to register for notifications' : null),
        });
      }
    }
  }, [shouldSurfaceRegistrationError]);

  useEffect(() => {
    if (IS_EXPO_GO) {
      return;
    }

    if (autoRegister) {
      void registerForPushNotifications();
    }

    let notificationListener: { remove: () => void } | null = null;
    let responseListener: { remove: () => void } | null = null;

    try {
      ensureConfigured();
      const Notifications = require('expo-notifications');

      if (typeof Notifications.addNotificationReceivedListener === 'function') {
        notificationListener = Notifications.addNotificationReceivedListener(
          (notification: any) => {
            if (__DEV__) {
              console.log('[usePushNotifications] Notification received:', notification.request.identifier);
            }
          }
        );
      }

      if (typeof Notifications.addNotificationResponseReceivedListener === 'function') {
        responseListener = Notifications.addNotificationResponseReceivedListener(
          (response: any) => {
            const data = (response.notification.request.content.data || {}) as Record<string, unknown>;
            const deepLink = typeof data.deepLink === 'string' ? data.deepLink : null;
            const transactionHash = typeof data.transactionHash === 'string'
              ? data.transactionHash
              : (typeof data.transactionId === 'string' ? data.transactionId : null);

            if (deepLink) {
              Linking.openURL(deepLink).catch(() => {
                console.warn('Failed to open notification deep link');
              });
            } else if (transactionHash) {
              Linking.openURL(createTransactionLink(transactionHash)).catch(() => {
                console.warn('Failed to open transaction deep link');
              });
            }

            if (onNotificationTap) {
              onNotificationTap(data);
            }

            if (__DEV__) {
              console.log('[usePushNotifications] Notification tapped:', data);
            }
          }
        );
      }
    } catch {
      // Silently fail
    }

    return () => {
      notificationListener?.remove();
      responseListener?.remove();
    };
  }, [autoRegister, onNotificationTap, registerForPushNotifications]);

  const sendLocalNotification = useCallback(async (
    title: string,
    body: string,
    data?: Record<string, unknown>
  ) => {
    if (IS_EXPO_GO) {
      return;
    }

    try {
      ensureConfigured();
      const Notifications = require('expo-notifications');

      if (typeof Notifications.scheduleNotificationAsync !== 'function') {
        return;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: data || {},
        },
        trigger: null,
      });
    } catch {
      // Silently fail
    }
  }, []);

  if (IS_EXPO_GO) {
    return {
      ...status,
      registerForPushNotifications: async () => { },
      sendLocalNotification: async () => { },
    };
  }

  return {
    ...status,
    registerForPushNotifications,
    sendLocalNotification,
  };
}
