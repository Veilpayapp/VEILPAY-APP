import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useBiometrics } from '../hooks/useBiometrics';
import { useTheme, useStyles } from '../styles/design-tokens';
import { Logo } from './Logo';

interface BiometricPromptProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

export function BiometricPrompt({ onSuccess, onCancel }: BiometricPromptProps) {
  const { isAvailable, isAuthenticated, authenticate, biometricType } = useBiometrics();
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  useEffect(() => {
    if (isAuthenticated) {
      onSuccess();
      return;
    }
    if (isAvailable) {
      authenticate();
    }
  }, [isAvailable, isAuthenticated]);

  if (!isAvailable) {
    return (
      <View style={styles.container}>
        <Logo variant="manual" size="large" />
        <Text style={styles.subtitle}>Biometrics unavailable on this device</Text>
        {onCancel && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={onCancel}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Continue without biometrics"
            accessibilityHint="Disables biometric unlock and continues to the app"
          >
            <Text style={styles.actionButtonText}>Continue</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Logo variant="manual" size="large" />
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.subtitle}>
        {biometricType === 1 ? 'Face ID required' : 'Touch ID required'}
      </Text>
    </View>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
    gap: 16,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
  },
  actionButton: {
    marginTop: 12,
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.bgPrimary,
  },
});
