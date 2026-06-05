import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";

// ─── SelectablePill ──────────────────────────────────────────────────────────

interface SelectablePillProps {
  label: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}

export function SelectablePill({ label, active, onPress, testID }: SelectablePillProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── SelectableCard ──────────────────────────────────────────────────────────

interface SelectableCardProps {
  children: React.ReactNode;
  active?: boolean;
  onPress: () => void;
}

export function SelectableCard({ children, active, onPress }: SelectableCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.choiceCard, active && styles.choiceCardActive]}
    >
      {children}
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const themeStyles = (colors: Colors) => StyleSheet.create({
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 0,
    backgroundColor: colors.bgTertiary,
    borderWidth: 0,
    borderColor: 'transparent',
    marginRight: 8,
    marginBottom: 8,
  },
  pillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pillText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '700',
  },
  pillTextActive: {
    color: colors.accentContainer,
  },
  choiceCard: {
    padding: 16,
    borderRadius: 0,
    backgroundColor: colors.surfaceCard,
    borderWidth: 2,
    borderColor: colors.surfaceElevated,
    marginBottom: 12,
  },
  choiceCardActive: {
    backgroundColor: colors.bgContainerHigh,
    borderColor: colors.accent,
  },
});
