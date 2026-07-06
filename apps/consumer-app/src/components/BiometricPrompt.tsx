import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useBiometrics, type BiometricContext } from '../hooks/useBiometrics';
import { useTheme, useStyles, typography, type Colors } from '../styles/design-tokens';
import { Logo } from './Logo';
import { Icon } from './Icon';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BiometricPromptProps {
  /** What operation is being authorized. Drives the prompt string. */
  context?: BiometricContext;
  onSuccess: () => void;
  onCancel?: () => void;
  onFail?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BiometricPrompt({
  context = 'app_unlock',
  onSuccess,
  onCancel,
  onFail,
}: BiometricPromptProps) {
  const { isAvailable, biometricLabel, biometricType, authenticate } = useBiometrics();
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  const [phase, setPhase] = useState<'waiting' | 'prompting' | 'failed' | 'cancelled'>(
    'waiting'
  );

  const triggerAuth = useCallback(async () => {
    setPhase('prompting');
    const result = await authenticate(context);

    if (result.success) {
      onSuccess();
      return;
    }

    if (result.cancelled) {
      setPhase('cancelled');
      onCancel?.();
    } else {
      setPhase('failed');
      if (!result.retryable) {
        onFail?.();
      }
    }
  }, [authenticate, context, onSuccess, onCancel, onFail]);
  // Auto-trigger on mount once availability is confirmed
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler -- reactively starts auth when the async isAvailable flips true (no user event exists to hang this off of).
    if (isAvailable && phase === 'waiting') {
      // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- this component's job is to run the auth flow and report its result to the parent via callbacks.
      triggerAuth();
    }
  }, [isAvailable, phase, triggerAuth]);

  // ── Not available ───────────────────────────────────────────────────────────
  if (!isAvailable) {
    return (
      <View style={styles.container}>
        <Logo variant="manual" size="large" />
        <View style={styles.statusBlock}>
          <Text style={styles.titleText}>BIOMETRICS UNAVAILABLE</Text>
          <Text style={styles.subtitleText}>
            This device does not have biometric hardware enrolled.
          </Text>
        </View>
        {onCancel && (
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.6 }]}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Continue without biometrics"
            accessibilityHint="Proceeds to the app without biometric verification"
          >
            <Text style={styles.primaryButtonText}>CONTINUE</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // ── Prompting / Waiting ─────────────────────────────────────────────────────
  if (phase === 'prompting' || phase === 'waiting') {
    return (
      <View style={styles.container}>
        <Logo variant="manual" size="large" />
        <ActivityIndicator size="large" color={colors.accent} />
        <View style={styles.statusBlock}>
          <Text style={styles.titleText}>{biometricLabel.toUpperCase()} REQUIRED</Text>
          <Text style={styles.subtitleText}>
            {biometricLabel === 'Biometric Unlock'
              ? 'Verify your identity to continue'
              : biometricType === 2
              ? 'Look at your device to authenticate'
              : biometricType === 1
              ? 'Place your finger on the sensor'
              : 'Verify your identity to continue'}
          </Text>
        </View>
      </View>
    );
  }

  // ── Failed (retryable) ──────────────────────────────────────────────────────
  if (phase === 'failed') {
    return (
      <View style={styles.container}>
        <Logo variant="manual" size="large" />
        <View style={styles.failBlock}>
          <Icon name="error" size={32} color={colors.error} />
          <View style={styles.statusBlock}>
            <Text style={[styles.titleText, { color: colors.error }]}>
              AUTHENTICATION FAILED
            </Text>
            <Text style={styles.subtitleText}>
              {biometricLabel} could not verify your identity.
            </Text>
          </View>
        </View>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.6 }]}
          onPress={triggerAuth}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.primaryButtonText}>TRY AGAIN</Text>
        </Pressable>
        {onCancel && (
          <Pressable
            style={({ pressed }) => [styles.ghostButton, pressed && { opacity: 0.6 }]}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.ghostButtonText}>CANCEL</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // ── Cancelled ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Logo variant="manual" size="large" />
      <View style={styles.statusBlock}>
        <Text style={styles.titleText}>AUTHENTICATION CANCELLED</Text>
        <Text style={styles.subtitleText}>
          Tap below to try again.
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.6 }]}
        onPress={triggerAuth}
        accessibilityRole="button"
        accessibilityLabel="Authenticate again"
      >
        <Text style={styles.primaryButtonText}>AUTHENTICATE</Text>
      </Pressable>
      {onCancel && (
        <Pressable
          style={({ pressed }) => [styles.ghostButton, pressed && { opacity: 0.6 }]}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.ghostButtonText}>CANCEL</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const themeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.bgPrimary,
      paddingHorizontal: 32,
      gap: 24,
    },
    failBlock: {
      alignItems: 'center',
      gap: 16,
    },
    statusBlock: {
      alignItems: 'center',
      gap: 8,
    },
    titleText: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 14,
      fontWeight: 'bold',
      color: colors.textPrimary,
      letterSpacing: 1.5,
      textAlign: 'center',
    },
    subtitleText: {
      fontFamily: typography.fontFamily.body,
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
    },
    primaryButton: {
      backgroundColor: colors.accent,
      paddingHorizontal: 24,
      paddingVertical: 14,
      borderRadius: 0,
      minWidth: 180,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 13,
      fontWeight: 'bold',
      color: colors.bgPrimary,
      letterSpacing: 1.5,
    },
    ghostButton: {
      paddingHorizontal: 24,
      paddingVertical: 10,
      alignItems: 'center',
    },
    ghostButtonText: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.textMuted,
      letterSpacing: 1,
    },
  });
