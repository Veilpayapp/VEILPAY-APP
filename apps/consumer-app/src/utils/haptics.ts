import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

function canTriggerHaptics(): boolean {
  return Platform.OS !== 'web';
}

export async function triggerLightImpactHaptic() {
  if (!canTriggerHaptics()) {
    return;
  }

  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch (error) {
    if (__DEV__) {
      console.warn('[haptics] Failed to trigger light impact', error);
    }
  }
}

export async function triggerNotificationHaptic(type: Haptics.NotificationFeedbackType) {
  if (!canTriggerHaptics()) {
    return;
  }

  try {
    await Haptics.notificationAsync(type);
  } catch (error) {
    if (__DEV__) {
      console.warn('[haptics] Failed to trigger notification', error);
    }
  }
}
