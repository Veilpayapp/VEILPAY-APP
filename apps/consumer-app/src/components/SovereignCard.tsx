import React from "react";
import { View, StyleSheet, TouchableOpacity, ViewStyle } from "react-native";
import { useTheme, useStyles } from "../styles/design-tokens";
import { triggerLightImpactHaptic } from "../utils/haptics";

interface SovereignCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: number;
  backgroundColor?: string;
  onPress?: () => void;
  borderColor?: string;
  borderRadius?: number;
}

/**
 * SovereignCard (The Sovereign Minimalist)
 * No borders, no shadows — pure tonal layering (#201f1f on #131313).
 * Relies on spacing and background color shifts to separate content.
 */
export function SovereignCard({
  children,
  style,
  padding = 24,
  backgroundColor,
  onPress,
  borderColor = "transparent",
  borderRadius = 24,
}: SovereignCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const actualBackgroundColor = backgroundColor === undefined ? colors.bgTertiary : backgroundColor;
  
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
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          void triggerLightImpactHaptic();
          onPress();
        }}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const themeStyles = (colors: any) => StyleSheet.create({
  cardSurface: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 0,
    borderColor: "transparent",
    justifyContent: "center",
    overflow: "hidden",
  },
});
