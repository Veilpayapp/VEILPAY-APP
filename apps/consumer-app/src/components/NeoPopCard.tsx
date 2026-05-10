import React from "react";
import { View, StyleSheet, TouchableOpacity, ViewStyle } from "react-native";
import { useTheme, useStyles } from "../styles/design-tokens";
import { triggerLightImpactHaptic } from "../utils/haptics";

interface NeoPopCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: number;
  backgroundColor?: string;
  onPress?: () => void;
  offset?: 4 | 6;
  borderRadius?: number;
}

/**
 * NeoPopCard (Tactical Privacy & NeoPop Precision)
 * Brutalist 2px black borders, 4px/6px offset shadow, rugged edges.
 * Used exclusively on Transak screens (DepositCrypto, WithdrawFiat).
 */
export function NeoPopCard({
  children,
  style,
  padding = 24,
  backgroundColor,
  onPress,
  offset = 4,
  borderRadius = 0,
}: NeoPopCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const actualBackgroundColor = backgroundColor === undefined ? colors.surfaceCard : backgroundColor;

  const content = (
    <View style={[styles.cardWrapper, style]}>
      <View
        style={[
          styles.cardOffset,
          {
            top: offset,
            left: offset,
            borderRadius,
          },
        ]}
      />
      <View
        style={[
          styles.cardSurface,
          {
            padding,
            backgroundColor: actualBackgroundColor,
            borderRadius,
          },
        ]}
      >
        {children}
      </View>
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
  cardWrapper: {
    position: "relative",
    width: "100%",
    marginBottom: 2,
  },
  cardOffset: {
    position: "absolute",
    right: 0,
    bottom: 0,
    top: 0,
    left: 0,
    backgroundColor: "#000000",
  },
  cardSurface: {
    width: "100%",
    borderWidth: 2,
    borderColor: "#000000",
    justifyContent: "center",
    overflow: "hidden",
  },
});
