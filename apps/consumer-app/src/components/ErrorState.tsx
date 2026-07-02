import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { MotiView, MotiText } from 'moti';
import * as Haptics from 'expo-haptics';
import { SovereignButton } from './SovereignButton';
import { Icon } from './Icon';
import { typography, useTheme, useStyles, type Colors } from "../styles/design-tokens";

interface ErrorStateProps {
  title?: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  description,
  actionLabel = "Try again",
  onAction,
}: ErrorStateProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  useEffect(() => {
    // Fire error haptic when component mounts
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  }, []);

  return (
    <View style={styles.container} accessibilityRole="alert" accessibilityLabel={`${title}. ${description}`}>
      <MotiView
        from={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', delay: 100 }}
        style={styles.iconContainer}
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.errorBg }]}>
          <Icon name="error" size={32} color={colors.error} />
        </View>
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
      {onAction && (
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', delay: 400 }}
          style={styles.actionContainer}
        >
          <SovereignButton
            title={actionLabel}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onAction();
            }}
            variant="outline"
            accessibilityLabel={actionLabel}
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
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
