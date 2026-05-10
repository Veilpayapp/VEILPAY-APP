import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, StyleProp, ViewStyle, TextStyle } from "react-native";
import { typography, useTheme, useStyles } from "../styles/design-tokens";
import { triggerLightImpactHaptic } from "../utils/haptics";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

interface SovereignButtonProps {
  title?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: TextStyle;
  variant?: "primary" | "secondary" | "outline" | "danger";
  disabled?: boolean;
  shape?: "pill" | "rounded";
  accessibilityLabel?: string;
  accessibilityHint?: string;
  children?: React.ReactNode;
}

/**
 * SovereignButton (The Sovereign Minimalist)
 * Elegant typography with subtle press animation. No neo-brutalist offsets.
 * Manrope for headlines, Inter for body.
 */
export function SovereignButton({
  title,
  onPress,
  style,
  textStyle,
  variant = "primary",
  disabled = false,
  shape = "pill",
  accessibilityLabel,
  accessibilityHint,
  children,
}: SovereignButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const isPressed = useSharedValue(false);

  const borderRadius = shape === "pill" ? 9999 : 16;

  const getBackgroundColor = () => {
    if (disabled) return colors.bgContainerHigh;
    if (variant === "primary") return colors.accent;
    if (variant === "secondary") return colors.bgTertiary;
    if (variant === "danger") return colors.error + "20";
    return "transparent";
  };

  const getTextColor = () => {
    if (disabled) return colors.textTertiary;
    if (variant === "primary") return colors.bgPrimary;
    if (variant === "danger") return colors.error;
    if (variant === "outline" || variant === "secondary") return colors.textPrimary;
    return colors.textPrimary;
  };

  const getBorderColor = () => {
    if (disabled) return "rgba(255, 255, 255, 0.1)";
    if (variant === "primary") return colors.accent;
    if (variant === "outline") return "rgba(255, 255, 255, 0.1)";
    return "rgba(255, 255, 255, 0.1)";
  };

  const springConfig = { mass: 1, stiffness: 600, damping: 40 };

  const animatedStyle = useAnimatedStyle(() => {
    const scale = withSpring(isPressed.value ? 0.97 : 1, springConfig);
    return {
      transform: [{ scale }],
    };
  });

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    isPressed.value = true;
    void triggerLightImpactHaptic();
  }, [disabled, isPressed]);

  const handlePressOut = useCallback(() => {
    isPressed.value = false;
  }, [isPressed]);

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      style={[styles.buttonWrapper, style]}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={disabled ? { disabled: true } : undefined}
    >
      <Animated.View
        style={[
          styles.buttonSurface,
          animatedStyle,
          {
            backgroundColor: getBackgroundColor(),
            borderColor: getBorderColor(),
            borderRadius,
            borderWidth: 1,
            paddingHorizontal: children ? 0 : 24,
          },
        ]}
      >
        {children || (
          <Text style={[styles.buttonText, { color: getTextColor() }, textStyle]}>
            {title}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  buttonWrapper: {
    position: "relative",
    width: "100%",
  },
  buttonSurface: {
    width: "100%",
    height: 56,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 16,
    letterSpacing: 0.5,
  },
});
