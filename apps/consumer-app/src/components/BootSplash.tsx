import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { Logo } from './Logo';

interface BootSplashProps {
  title?: string;
  subtitle?: string;
}

export function BootSplash({ title = 'Veilpay', subtitle }: BootSplashProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  // Pulse animation for the logo
  const opacity = useSharedValue(0.4);
  const scale = useSharedValue(0.95);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    scale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.95, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
      transform: [{ scale: scale.value }],
    };
  });

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.logoContainer, animatedStyle]}>
        <Logo variant="icon" size="large" />
      </Animated.View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceScreen,
    gap: 16,
  },
  logoContainer: {
    marginBottom: 24,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontFamily: typography.fontFamily.headlineBold,
    letterSpacing: 1,
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: 14,
    fontFamily: typography.fontFamily.mono,
  },
});
