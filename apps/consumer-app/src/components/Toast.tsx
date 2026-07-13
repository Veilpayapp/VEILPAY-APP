/**
 * Veilpay Toast Component
 * Hybrid structural toast notifications for user feedback
 *
 * UPDATED: Now uses premium SVG icons
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { PressableOpacity } from './PressableOpacity';
import { typography, useTheme, useStyles, type Colors } from "../styles/design-tokens";
import { Icon, IconName } from './Icon';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  visible: boolean;
  message: string;
  type?: ToastType;
  duration?: number;
  onDismiss: () => void;
}

const getToastConfig = (colors: Colors): Record<ToastType, { iconName: IconName; bgColor: string; shadowColor: string; textColor: string }> => ({
  success: {
    iconName: 'success',
    bgColor: colors.successMuted,
    shadowColor: colors.successMuted,
    textColor: colors.textPrimary,
  },
  error: {
    iconName: 'error',
    bgColor: colors.error,
    shadowColor: colors.error,
    textColor: colors.textPrimary,
  },
  info: {
    iconName: 'info',
    bgColor: colors.bgTertiary,
    shadowColor: colors.accent,
    textColor: colors.textPrimary,
  },
  warning: {
    iconName: 'warning',
    bgColor: colors.accent,
    shadowColor: colors.accent,
    textColor: colors.textPrimary,
  },
});

export function Toast({
  visible,
  message,
  type = 'info',
  duration = 3000,
  onDismiss,
}: ToastProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const translateYRef = useRef<Animated.Value | null>(null);
  if (translateYRef.current === null) translateYRef.current = new Animated.Value(100);
  const translateY = translateYRef.current;
  const opacityRef = useRef<Animated.Value | null>(null);
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(0);
  const opacity = opacityRef.current;
  const config = getToastConfig(colors)[type];

  // Keep the latest onDismiss without destabilizing handleDismiss (which the effect depends on).
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const handleDismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismissRef.current();
    });
  }, [translateY, opacity]);

  // Latest handleDismiss, read inside the auto-dismiss timer so the effect
  // doesn't re-subscribe (and restart the timer) when the callback identity changes.
  const handleDismissRef = useRef(handleDismiss);
  handleDismissRef.current = handleDismiss;

  // Re-run when `message` changes so rapid successive toasts (select → ready → recover)
  // actually re-show instead of leaving a dismissed/invisible first toast.
  useEffect(() => {
    if (visible) {
      translateY.setValue(100);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        handleDismissRef.current();
      }, duration);

      return () => clearTimeout(timer);
    } else {
      translateY.setValue(100);
      opacity.setValue(0);
    }
  }, [visible, message, duration, translateY, opacity]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <PressableOpacity
        activeOpacity={0.9}
        onPress={handleDismiss}
        style={styles.touchable}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
        accessibilityHint="Closes this toast message"
      >
        {/* Shadow layer */}
        <View style={[styles.shadow, { backgroundColor: config.shadowColor }]} />

        {/* Surface layer */}
        <View style={[styles.surface, { backgroundColor: config.bgColor }]}>
          <View style={styles.iconBox}>
            <Icon name={config.iconName} size={18} color={config.textColor} />
          </View>
          <Text style={[styles.message, { color: config.textColor }]}>
            {message}
          </Text>
        </View>
      </PressableOpacity>
    </Animated.View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    position: 'absolute',
    // Sit above BottomNavBar (~72px + safe area); previously bottom:24 hid every toast.
    bottom: 100,
    left: 20,
    right: 20,
    zIndex: 99999,
    elevation: 48,
  },
  touchable: {
    width: '100%',
    minHeight: 44,
    justifyContent: 'center',
  },
  shadow: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 0,
    bottom: 0,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  surface: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 0,
    borderColor: 'transparent',
    gap: 12,
  },
  iconBox: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  message: {
    flex: 1,
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});

// Hook for easy toast usage

interface UseToastReturn {
  visible: boolean;
  message: string;
  type: ToastType;
  show: (msg: string, toastType?: ToastType) => void;
  hide: () => void;
}

export function useToast(): UseToastReturn {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [type, setType] = useState<ToastType>('info');

  const show = useCallback((msg: string, toastType: ToastType = 'info') => {
    // Force a visibility edge so the Toast effect always restarts (even same msg).
    setVisible(false);
    // RN-safe defer so hide commits before show (rapid multi-toast path).
    setTimeout(() => {
      setMessage(msg);
      setType(toastType);
      setVisible(true);
    }, 30);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  return { visible, message, type, show, hide };
}

export default Toast;
