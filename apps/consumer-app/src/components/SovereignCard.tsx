import React, { useCallback } from "react";
import { View, StyleSheet, Pressable, ViewStyle, AccessibilityRole, Platform } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, runOnJS } from "react-native-reanimated";
import { useTheme, useStyles, type Colors } from "../styles/design-tokens";
import { triggerLightImpactHaptic } from "../utils/haptics";

interface SovereignCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: number;
  backgroundColor?: string;
  onPress?: () => void;
  borderColor?: string;
  borderRadius?: number;
  /** Defaults to 'button' when onPress is provided */
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Disable haptic feedback for high-frequency presses (e.g. lists) */
  disableHaptic?: boolean;
}

// Reuse spring config object to avoid re-allocation on every render
const SPRING_CONFIG = { mass: 1, stiffness: 400, damping: 25 };

/**
 * SovereignCard (The Sovereign Minimalist)
 * Custom tactile spring-press animation when clickable and soft premium ambient occlusion shadows.
 * No borders, pure tonal layering with spatial separation.
 */
export function SovereignCard({
  children,
  style,
  padding = 24,
  backgroundColor,
  onPress,
  borderColor = "transparent",
  borderRadius = 24,
  accessibilityRole: accessibilityRoleProp,
  accessibilityLabel,
  accessibilityHint,
  disableHaptic,
}: SovereignCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const isPressed = useSharedValue(false);
  const actualBackgroundColor = backgroundColor === undefined ? colors.bgTertiary : backgroundColor;

  const animatedStyle = useAnimatedStyle(() => {
    const scale = withSpring(isPressed.value ? 0.98 : 1, SPRING_CONFIG);
    return {
      transform: [{ scale }],
    };
  });

  const handlePressIn = useCallback(() => {
    if (!onPress) return;
    isPressed.value = true;
    if (!disableHaptic) {
      // Use runOnJS to safely call haptic from worklet context
      runOnJS(triggerLightImpactHaptic)();
    }
  }, [onPress, isPressed, disableHaptic]);

  const handlePressOut = useCallback(() => {
    isPressed.value = false;
  }, [isPressed]);

  const content = (
    <View
      style={[
        styles.cardSurface,
        style,
        {
          padding,
          backgroundColor: actualBackgroundColor,
          borderColor,
          borderRadius,
        },
      ]}
    >
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onPress}
        accessibilityRole={accessibilityRoleProp ?? 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={styles.clickableWrapper}
      >
        <Animated.View style={[animatedStyle, styles.fullWidth]}>
          {content}
        </Animated.View>
      </Pressable>
    );
  }

  return content;
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  clickableWrapper: {
    width: "100%",
  },
  fullWidth: {
    width: "100%",
  },
  cardSurface: {
    width: "100%",
    justifyContent: "center",
    // Use a subtle border on Android to avoid harsh elevation shadows and opacity animation bugs.
    // On iOS, use an extremely soft ambient shadow.
    ...(Platform.OS === 'ios'
      ? {
          borderWidth: 0,
          borderColor: "transparent",
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.04,
          shadowRadius: 12,
        }
      : {
          elevation: 0,
          borderWidth: 1,
          borderColor: colors.outlineSubtle,
        }),
  },
});
