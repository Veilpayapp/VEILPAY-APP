import React from 'react';import { View, Text, StyleSheet } from 'react-native';
import { PressableOpacity } from './PressableOpacity';
import { Icon } from './Icon';
import { typography, useTheme, useStyles, type Colors } from "../styles/design-tokens";

interface ScreenBackButtonProps {
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function ScreenBackButton({
  onPress,
  accessibilityLabel = 'Go back',
  accessibilityHint = 'Returns to the previous screen',
}: ScreenBackButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  
  return (
    <PressableOpacity
      onPress={onPress}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <View style={styles.content}>
        <Icon name="back" size={16} color={colors.textMuted} />
        <Text style={styles.label}>BACK</Text>
      </View>
    </PressableOpacity>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  button: {
    width: 80,
    minHeight: 44,
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: 'bold',
  },
});

export default ScreenBackButton;
