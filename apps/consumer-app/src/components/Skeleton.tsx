import React from 'react';
import { View, StyleSheet, ViewStyle, AccessibilityProps } from 'react-native';
import { useTheme, useStyles, type Colors } from "../styles/design-tokens";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';

interface SkeletonProps extends AccessibilityProps {
  width: number;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width, height, borderRadius = 8, style, ...accessibilityProps }: SkeletonProps) {
  const opacity = useSharedValue(0.3);
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.2, { duration: 800, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
        withTiming(0.8, { duration: 800, easing: Easing.bezier(0.4, 0, 0.2, 1) })
      ),
      -1,
      true    );  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width, height, borderRadius },
        animatedStyle,
        style,
      ]}
      accessibilityLabel="Loading"
      accessibilityRole="none"
      {...accessibilityProps}
    />
  );
}

export function TransactionSkeleton() {
  const styles = useStyles(themeStyles);
  return (
    <View style={styles.transactionRow}>
      <Skeleton width={44} height={44} borderRadius={22} />
      <View style={styles.transactionContent}>
        <Skeleton width={120} height={16} />
        <Skeleton width={80} height={12} style={{ marginTop: 8 }} />
      </View>
      <View style={styles.transactionAmount}>
        <Skeleton width={60} height={16} />
      </View>
    </View>
  );
}

export function BalanceSkeleton() {
  const styles = useStyles(themeStyles);
  return (
    <View style={styles.balanceContainer}>
      <Skeleton width={200} height={40} />
      <Skeleton width={100} height={16} style={{ marginTop: 8 }} />
    </View>
  );
}

export function TokenSkeleton() {
  const styles = useStyles(themeStyles);
  return (
    <View style={styles.tokenRow}>
      <Skeleton width={40} height={40} borderRadius={20} />
      <View style={styles.tokenContent}>
        <Skeleton width={80} height={16} />
        <Skeleton width={60} height={12} style={{ marginTop: 6 }} />
      </View>
      <View style={styles.tokenValue}>
        <Skeleton width={70} height={16} />
        <Skeleton width={50} height={12} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

export function WalletSkeleton() {
  const styles = useStyles(themeStyles);
  return (
    <View style={styles.walletContainer}>
      <Skeleton width={60} height={60} borderRadius={30} />
      <Skeleton width={150} height={20} style={{ marginTop: 12 }} />
      <Skeleton width={200} height={14} style={{ marginTop: 8 }} />
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  skeleton: {
    backgroundColor: colors.bgContainerHigh,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  transactionContent: {
    flex: 1,
    marginLeft: 12,
  },
  transactionAmount: {
    alignItems: 'flex-end',
  },
  balanceContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  tokenContent: {
    flex: 1,
    marginLeft: 12,
  },
  tokenValue: {
    alignItems: 'flex-end',
  },
  walletContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
});
