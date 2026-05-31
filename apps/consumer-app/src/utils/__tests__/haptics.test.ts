/**
 * Andrej Karpathy first-principles style unit tests for haptics.ts
 * Covers mobile vs web environments, successful impacts, notification types, and warning logger recovery.
 */

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { triggerLightImpactHaptic, triggerNotificationHaptic } from '../haptics';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
  },
  NotificationFeedbackType: {
    Success: 'success',
  },
}));

describe('haptics utility tests', () => {
  const originalPlatformOs = Platform.OS;
  const originalWarn = console.warn;

  beforeEach(() => {
    jest.clearAllMocks();
    console.warn = jest.fn();
    // Default to mobile for standard tests
    Platform.OS = 'ios';
  });

  afterAll(() => {
    Platform.OS = originalPlatformOs;
    console.warn = originalWarn;
  });

  describe('triggerLightImpactHaptic', () => {
    it('successfully calls Haptics.impactAsync when on mobile platform', async () => {
      await triggerLightImpactHaptic();

      expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    });

    it('does nothing and skips haptics on web platform', async () => {
      Platform.OS = 'web';

      await triggerLightImpactHaptic();

      expect(Haptics.impactAsync).not.toHaveBeenCalled();
    });

    it('logs warning but does not throw under error conditions during __DEV__ dev mode', async () => {
      // Simulate dev mode
      (global as any).__DEV__ = true;
      (Haptics.impactAsync as jest.Mock).mockRejectedValue(new Error('Hardware missing haptics'));

      await triggerLightImpactHaptic();

      expect(console.warn).toHaveBeenCalledWith(
        '[haptics] Failed to trigger light impact',
        expect.any(Error)
      );
    });

    it('does not log warning under error conditions if __DEV__ is false', async () => {
      (global as any).__DEV__ = false;
      (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error('Hardware missing haptics'));

      await triggerLightImpactHaptic();

      expect(console.warn).not.toHaveBeenCalled();
    });
  });


  describe('triggerNotificationHaptic', () => {
    it('successfully calls Haptics.notificationAsync with specified type when on mobile platform', async () => {
      await triggerNotificationHaptic(Haptics.NotificationFeedbackType.Success);

      expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    });

    it('does nothing and skips notification haptics on web platform', async () => {
      Platform.OS = 'web';

      await triggerNotificationHaptic(Haptics.NotificationFeedbackType.Success);

      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    });

    it('logs warning but does not throw under notification error conditions during dev mode', async () => {
      (global as any).__DEV__ = true;
      (Haptics.notificationAsync as jest.Mock).mockRejectedValue(new Error('Vibration engine error'));

      await triggerNotificationHaptic(Haptics.NotificationFeedbackType.Success);

      expect(console.warn).toHaveBeenCalledWith(
        '[haptics] Failed to trigger notification',
        expect.any(Error)
      );
    });

    it('does not log warning under error conditions if __DEV__ is false', async () => {
      (global as any).__DEV__ = false;
      (Haptics.notificationAsync as jest.Mock).mockRejectedValueOnce(new Error('Vibration engine error'));

      await triggerNotificationHaptic(Haptics.NotificationFeedbackType.Success);

      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});

