import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MotiView, MotiText } from 'moti';
import { SovereignButton } from './SovereignButton';
import { typography, useTheme, useStyles, type Colors } from "../styles/design-tokens";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  return (
    <View style={styles.container} accessibilityRole="summary" accessibilityLabel={`${title}. ${description}`}>
      <MotiView
        from={{ opacity: 0, translateY: 20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', delay: 100 }}
        style={styles.iconContainer}
      >
        {icon}
      </MotiView>
      <MotiText
        from={{ opacity: 0, translateY: 20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', delay: 200 }}
        style={styles.title}
      >
        {title}
      </MotiText>
      <MotiText
        from={{ opacity: 0, translateY: 20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', delay: 300 }}
        style={styles.description}
      >
        {description}
      </MotiText>
      {actionLabel && onAction && (
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', delay: 400 }}
          style={styles.actionContainer}
        >
          <SovereignButton
            title={actionLabel}
            onPress={onAction}
            variant="primary"
            accessibilityLabel={actionLabel}
            accessibilityRole="button"
          />
        </MotiView>
      )}
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  iconContainer: {
    marginBottom: 24,
  },
  title: {
    fontFamily: typography.fontFamily.headline,
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  actionContainer: {
    marginTop: 24,
    width: '100%',
  },
});
