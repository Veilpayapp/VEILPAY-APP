import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, StyleProp, ViewStyle, TextStyle } from "react-native";
import { typography, useTheme, useStyles, type Colors } from "../styles/design-tokens";
import { triggerLightImpactHaptic } from "../utils/haptics";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, runOnJS } from "react-native-reanimated";

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

  const borderRadius = 0; // Brutalist strict geometry

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

  const springConfig = { mass: 1, stiffness: 400, damping: 25 };

  const animatedStyle = useAnimatedStyle(() => {
    const targetScale = isPressed.value ? 0.95 : 1;
    const targetOpacity = isPressed.value ? 0.8 : 1;
    
    const scale = withSpring(targetScale, springConfig, (finished) => {
      // Fire haptic at the exact moment the button reaches its maximum compression (bottom out)
      if (finished && targetScale === 0.95) {
        runOnJS(triggerLightImpactHaptic)();
      }
    });
    
    return {
      transform: [{ scale }],
      opacity: withSpring(targetOpacity, { ...springConfig, damping: 20 }),
    };
  });

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    isPressed.value = true;
    // Haptic is now physics-driven in the spring callback above
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
            borderRadius,
            borderWidth: 1,
            borderColor: disabled ? colors.outlineSubtle : colors.textPrimary,
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

const themeStyles = (colors: Colors) => StyleSheet.create({
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
    fontFamily: 'JetBrainsMono_400Regular',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
