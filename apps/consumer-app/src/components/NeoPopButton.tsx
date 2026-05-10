import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ViewStyle, TextStyle } from "react-native";
import { typography, useTheme, useStyles } from "../styles/design-tokens";
import { triggerLightImpactHaptic } from "../utils/haptics";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

interface NeoPopButtonProps {
  title?: string;
  onPress?: () => void;
  style?: ViewStyle;
  textStyle?: TextStyle;
  variant?: "primary" | "secondary" | "outline" | "danger";
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  children?: React.ReactNode;
}

/**
 * NeoPopButton (Tactical Privacy & NeoPop Precision)
 * Pill-shaped (9999px), 2px black border, physical depression effect (4px/6px offset).
 * Used exclusively on Transak screens (DepositCrypto, WithdrawFiat).
 */
export function NeoPopButton({
  title,
  onPress,
  style,
  textStyle,
  variant = "primary",
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  children,
}: NeoPopButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const isPressed = useSharedValue(false);

  const depth = 4;
  const borderRadius = 9999;

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

  const getOffsetColor = () => {
    if (disabled) return colors.bgPrimary;
    if (variant === "primary") return "#000000";
    if (variant === "danger") return colors.errorMuted;
    return "#000000";
  };

  const springConfig = { mass: 1, stiffness: 1000, damping: 50 };

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: withSpring(isPressed.value ? depth : 0, springConfig) },
        { translateY: withSpring(isPressed.value ? depth : 0, springConfig) },
      ],
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
      style={[styles.buttonWrapper, { marginBottom: depth }, style]}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={disabled ? { disabled: true } : undefined}
    >
      {variant !== "outline" && (
        <View
          style={[
            styles.buttonOffset,
            {
              backgroundColor: getOffsetColor(),
              top: depth,
              left: depth,
              borderRadius,
            },
          ]}
        />
      )}

      <Animated.View
        style={[
          styles.buttonSurface,
          animatedStyle,
          {
            backgroundColor: getBackgroundColor(),
            borderRadius,
            borderWidth: 2,
            borderColor: "#000000",
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
  buttonOffset: {
    position: "absolute",
    right: 0,
    bottom: 0,
    top: 0,
    left: 0,
  },
  buttonSurface: {
    width: "100%",
    height: 56,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    letterSpacing: 0.5,
    fontWeight: "700",
  },
});
