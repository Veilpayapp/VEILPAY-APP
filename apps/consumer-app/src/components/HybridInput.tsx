import React from "react";
import { View, Text, TextInput, StyleSheet, TextInputProps, ViewStyle, AccessibilityProps } from "react-native";
import { typography, useTheme, useStyles } from "../styles/design-tokens";

interface HybridInputProps extends TextInputProps, AccessibilityProps {
  label?: string;
  wrapperStyle?: ViewStyle;
  variant?: "standard" | "massive";
  leftAdornment?: React.ReactNode;
  rightAdornment?: React.ReactNode;
}

export function HybridInput({
  label,
  wrapperStyle,
  variant = "standard",
  leftAdornment,
  rightAdornment,
  accessibilityLabel,
  ...props
}: HybridInputProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const isMassive = variant === "massive";

  return (
    <View style={[styles.wrapper, wrapperStyle]}>
      {label && (
        <Text style={styles.label}>
          {label.toUpperCase()}
        </Text>
      )}
      <View
        style={[
          styles.inputContainer,
          isMassive && styles.inputContainerMassive,
          (leftAdornment || rightAdornment) ? { flexDirection: "row", alignItems: "center" } : undefined,
          isMassive && (leftAdornment || rightAdornment) ? { justifyContent: "center" } : undefined
        ]}
      >
        {leftAdornment}
        <TextInput
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.accent}
          accessibilityLabel={accessibilityLabel ?? (label ? label : undefined)}
          style={[
            styles.input,
            isMassive ? styles.textMassive : styles.textStandard,
            (leftAdornment || rightAdornment) ? { width: "auto", flex: isMassive ? 0 : 1 } : undefined,
          ]}
          {...props}
        />
        {rightAdornment}
      </View>
    </View>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  wrapper: {
    width: "100%",
    marginVertical: 8,
  },
  label: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textSecondary,
    letterSpacing: 1.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  inputContainer: {
    width: "100%",
    backgroundColor: colors.surfaceInput,
    borderRadius: 16,
    borderWidth: 0,
    borderColor: "transparent",
    overflow: "hidden",
  },
  inputContainerMassive: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
    borderRadius: 0,
    paddingBottom: 8,
  },
  input: {
    width: "100%",
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  textStandard: {
    fontFamily: typography.fontFamily.body,
    fontSize: 16,
  },
  textMassive: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 56,
    textAlign: "center",
    paddingVertical: 8,
  },
});
