import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { Logo } from './Logo';

const GLOW_SIZE = 320;
const TRACK_WIDTH = 160;
const SEGMENT_WIDTH = 56;

interface BootSplashProps {
  title?: string;
  subtitle?: string;
}

/**
 * Branded launch / loading screen.
 *
 * Shown while the app hydrates and the wallet session bootstraps. The soft
 * amber glow + pulsing shield + sliding progress bar make the (unavoidable)
 * SecureStore/font load time read as an intentional splash rather than a blank,
 * near-black frozen screen.
 */
export function BootSplash({ title = 'Veilpay', subtitle }: BootSplashProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  const opacity = useSharedValue(0.5);
  const scale = useSharedValue(0.96);
  const glow = useSharedValue(0.45);
  const progress = useSharedValue(0);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 1100, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    scale.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.96, { duration: 1100, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.45, { duration: 1100, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    // Indeterminate bar: a segment sweeps left→right on a loop.
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- mount-only animation setup; Reanimated shared values (opacity/scale/glow/progress) are stable refs.
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: interpolate(glow.value, [0.45, 1], [0.9, 1.1]) }],
  }));

  const barStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-SEGMENT_WIDTH, TRACK_WIDTH]) },
    ],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none">
          <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
            <Defs>
              <RadialGradient id="bootGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={colors.accent} stopOpacity={0.22} />
                <Stop offset="55%" stopColor={colors.accent} stopOpacity={0.06} />
                <Stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle
              cx={GLOW_SIZE / 2}
              cy={GLOW_SIZE / 2}
              r={GLOW_SIZE / 2}
              fill="url(#bootGlow)"
            />
          </Svg>
        </Animated.View>

        <Animated.View style={logoStyle}>
          <Logo variant="icon" size="large" />
        </Animated.View>
      </View>

      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <View style={styles.track}>
        <Animated.View style={[styles.segment, barStyle]} />
      </View>
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
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  glow: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontFamily: typography.fontFamily.headlineBold,
    letterSpacing: 2,
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: 13,
    fontFamily: typography.fontFamily.mono,
    letterSpacing: 0.5,
  },
  track: {
    marginTop: 12,
    width: TRACK_WIDTH,
    height: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  segment: {
    width: SEGMENT_WIDTH,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
});
