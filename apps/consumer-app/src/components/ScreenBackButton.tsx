import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Icon } from './Icon';
import { typography, useTheme, useStyles } from '../styles/design-tokens';

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
    <TouchableOpacity
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
    </TouchableOpacity>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
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
