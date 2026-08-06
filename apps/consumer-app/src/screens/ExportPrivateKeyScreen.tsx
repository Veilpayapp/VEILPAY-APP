/**
 * Veilpay Export Private Key Screen
 * Allows users to securely view and export their raw private key
 * SEC-003: Private key loaded ONLY after successful biometric authentication
 */

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar, Alert } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography, spacing } from '../styles/design-tokens';
import { useWalletStore } from '../stores/walletStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getStoredMnemonic } from '../utils/transactions';
import { mnemonicToAccount } from 'viem/accounts';
import { Buffer } from 'buffer';
import { useBiometrics } from '../hooks/useBiometrics';
import { useClipboardAutoWipe } from '../hooks/useClipboardAutoWipe';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import { ScreenBackButton } from '../components/ScreenBackButton';
import { Icon } from '../components/Icon';
import Toast, { useToast } from '../components/Toast';
import { setClipboardString } from '../utils/clipboard';
import { SecurityWarningModal } from '../components/SecurityWarningModal';
import { useSecureScreen } from '../hooks/useSecureScreen';

export function ExportPrivateKeyScreen({ navigation }: any) {
  useSecureScreen('ExportPrivateKey');
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const toast = useToast();
  const { isAvailable, authenticate } = useBiometrics();
  const { address, activeChain } = useWalletStore();
  const biometricsEnabled = useSettingsStore((state: any) => state.biometricsEnabled);

  // SEC-011: Use clipboard auto-wipe hook to clear clipboard after 30 seconds
  const {
    copy: clipboardCopy,
    clear: clipboardClear,
    isClipboardActive,
    countdownText,
  } = useClipboardAutoWipe(30000);

  // SEC-003: Use useRef instead of useState to avoid re-renders and React snapshots
  // This prevents the private key from being captured in component snapshots or state logs
  const privateKeyRef = useRef<string>('');
  const [isRevealed, setIsRevealed] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  // SEC-003: Do NOT load private key on mount. Only load after biometric auth succeeds.
  useEffect(() => {
    return () => {
      // SEC-003: Cleanup on unmount - clear sensitive data from memory
      if (privateKeyRef.current) {
        privateKeyRef.current = '';
      }
    };
  }, []);

  /**
   * SEC-003: Load private key ONLY after successful biometric authentication.
   * This ensures the private key is never exposed in React state before authentication,
   * preventing DevTools inspection or state snapshots from revealing the key.
   */
  const loadPrivateKeyAfterAuth = async () => {
    try {
      const words = await getStoredMnemonic();
      if (words && words.length > 0) {
        const phrase = words.join(' ');
        const account = mnemonicToAccount(phrase, { path: "m/44'/60'/0'/0/0" });
        const hdKey = account.getHdKey();
        if (hdKey.privateKey) {
          // Store in ref, not state - prevents React snapshots
          privateKeyRef.current = '0x' + Buffer.from(hdKey.privateKey).toString('hex');
        }

        // SEC-003: Clear mnemonic array after use
        for (let i = 0; i < words.length; i++) {
          words[i] = '';
        }
        words.length = 0;
      }
    } catch (error) {
      toast.show('Failed to load private key', 'error');
      privateKeyRef.current = '';
      throw error;
    }
  };

  /**
   * SEC-003: Handle reveal button press.
   * Step 1: Authenticate user with biometrics/PIN
   * Step 2: Only if auth succeeds, load the private key into memory
   * Step 3: Show revealed UI
   */
  const handleReveal = async () => {
    // ALWAYS require authentication to view private key (fallback to Device PIN if no biometrics)
    const result = await authenticate('export_key', true);
    if (!result.success) {
      toast.show(
        result.cancelled ? 'Authentication cancelled' : 'Authentication failed',
        'error'
      );
      return;
    }

    // SEC-003: ONLY load key after successful authentication
    try {
      await loadPrivateKeyAfterAuth();
      setIsRevealed(true);
    } catch (error) {
      toast.show('Failed to load private key after authentication', 'error');
      setIsRevealed(false);
      privateKeyRef.current = '';
    }
  };

  const handleCopyRequest = () => {
    if (!isRevealed) return;
    setShowWarning(true);
  };

  const handleCopyConfirm = async () => {
    setShowWarning(false);
    if (privateKeyRef.current) {
      // SEC-011: Use clipboard auto-wipe to clear clipboard after 30 seconds
      await clipboardCopy(privateKeyRef.current);
      toast.show('Private key copied to clipboard - will clear in 30s', 'success');
    }
  };

  const handleCopyCancel = () => {
    setShowWarning(false);
  };

  /**
   * SEC-003: Clear private key when leaving the screen.
   * This ensures the key is not held in memory after navigation.
   */
  const handleBack = () => {
    if (isRevealed) {
      privateKeyRef.current = '';
      setIsRevealed(false);
    }
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.header}>
        <ScreenBackButton onPress={handleBack} />
        <Text style={styles.headerTitle}>EXPORT PRIVATE KEY</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={styles.content}>

          {/* Warning Banner */}
          <View style={styles.warningBanner}>
            <View style={styles.warningIconContainer}>
              <Icon name="info" size={20} color={colors.warning} />
            </View>
            <View style={styles.warningTextContainer}>
              <Text style={styles.warningTitle}>CRITICAL SECURITY WARNING</Text>
              <Text style={styles.warningDesc}>
                Your private key provides absolute control over your funds. If you lose it, your funds are gone forever. If someone else gets it, they can take everything.
              </Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>FOR ADDRESS ({activeChain?.name})</Text>
          <SovereignCard backgroundColor={colors.surfaceCard} padding={16} style={styles.addressCard}>
            <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="middle">
              {address}
            </Text>
          </SovereignCard>

          <Text style={styles.sectionTitle}>RAW PRIVATE KEY</Text>
          <SovereignCard backgroundColor={colors.surfaceCard} padding={20} style={styles.keyCard}>
            {!isRevealed ? (
              <View style={styles.hiddenOverlay}>
                <View style={styles.blurEffect} />
                <Icon name="private" size={48} color={colors.textFaint} style={{ marginBottom: 16 }} />
                <Text style={styles.hiddenText}>Tap to reveal private key</Text>
                <Text style={styles.hiddenSubtext}>Only reveal when you are in a private area</Text>
              </View>
            ) : (
              <Animated.View entering={FadeIn} style={styles.revealedKeyContainer}>
                <Text style={styles.privateKeyText}>{privateKeyRef.current}</Text>
              </Animated.View>
            )}
          </SovereignCard>

          {!isRevealed ? (
            <SovereignButton
              title="REVEAL PRIVATE KEY"
              variant="primary"
              onPress={handleReveal}
              style={styles.actionButton}
            />
          ) : (
            <View>
              <View style={styles.revealedActions}>
                <SovereignButton
                  title="COPY KEY"
                  variant="outline"
                  onPress={handleCopyRequest}
                  style={[styles.actionButton, { flex: 1 }]}
                />
                <SovereignButton
                  title="DONE"
                  variant="primary"
                  onPress={handleBack}
                  style={[styles.actionButton, { flex: 0.8 }]}
                />
              </View>
              {isClipboardActive && countdownText && (
                <View style={styles.clipboardClearAlert}>
                  <Icon name="info" size={16} color={colors.textMuted} />
                  <Text style={styles.clipboardClearText}>
                    {countdownText}
                  </Text>
                  <SovereignButton
                    title="CLEAR NOW"
                    variant="outline"
                    onPress={clipboardClear}
                    style={styles.clearNowButton}
                  />
                </View>
              )}
            </View>
          )}

          <View style={styles.infoBox}>
            <Icon name="info" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>
              This private key is derived from your recovery phrase. You only need this if you want to import this specific account into a different wallet software.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />

      <SecurityWarningModal
        visible={showWarning}
        title="Critical Warning"
        message="Sharing your private key gives full control of your funds to anyone. Never share it. Are you sure you want to copy it?"
        onCancel={handleCopyCancel}
        onConfirm={handleCopyConfirm}
        confirmText="COPY ANYWAY"
      />
    </SafeAreaView>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    height: 64,
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  warningBanner: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    borderRadius: 0,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.error,
    marginBottom: 32,
  },
  warningIconContainer: {
    marginRight: 16,
    paddingTop: 2,
  },
  warningTextContainer: {
    flex: 1,
  },
  warningTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.warning,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  warningDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
    marginBottom: 16,
    marginTop: 8,
    letterSpacing: 1,
  },
  addressCard: {
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  addressText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  keyCard: {
    minHeight: 200,
    justifyContent: 'center',
    marginBottom: 32,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  hiddenOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  blurEffect: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surfaceCard,
    opacity: 0.9,
  },
  hiddenText: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  hiddenSubtext: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  revealedKeyContainer: {
    backgroundColor: 'transparent',
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.textPrimary,
  },
  privateKeyText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.accent,
    lineHeight: 22,
    textAlign: 'center',
  },
  actionButton: {
    marginBottom: 16,
  },
  revealedActions: {
    flexDirection: 'row',
    gap: 12,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    marginTop: 16,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  clipboardClearAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg + '15',
    padding: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.warningBg + '30',
    marginTop: 12,
    gap: 8,
  },
  clipboardClearText: {
    flex: 1,
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  clearNowButton: {
    minHeight: 32,
  },
});
