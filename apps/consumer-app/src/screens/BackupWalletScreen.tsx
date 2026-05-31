/**
 * Veilpay Backup Wallet Screen
 * Allows users to securely view and backup their recovery phrase (mnemonic)
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,  StyleSheet,  TouchableOpacity,
  ScrollView,
  StatusBar,
  Alert,
} from 'react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography, spacing } from '../styles/design-tokens';
import { useWalletStore } from '../stores/walletStore';
import { getStoredMnemonic } from '../utils/transactions';
import { useBiometrics } from '../hooks/useBiometrics';
import { useSettingsStore } from '../stores/settingsStore';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import { ScreenBackButton } from '../components/ScreenBackButton';
import { Icon } from '../components/Icon';
import Toast, { useToast } from '../components/Toast';
import { setClipboardString } from '../utils/clipboard';
import { SecurityWarningModal } from '../components/SecurityWarningModal';

export function BackupWalletScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const toast = useToast();
  const { isAvailable, authenticate } = useBiometrics();
  const { biometricsEnabled } = useSettingsStore();  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [isRevealed, setIsRevealed] = useState(false);  const [isLoading, setIsLoading] = useState(true);  useEffect(() => {    loadMnemonic();  }, []);

  const loadMnemonic = async () => {
    try {
      const words = await getStoredMnemonic();
      if (words) {
        setMnemonic(words);
      }
    } catch (error) {
      toast.show('Failed to load recovery phrase', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReveal = async () => {
    // ALWAYS require authentication to view recovery phrase (fallback to Device PIN if no biometrics)
    const result = await authenticate('backup_seed', true);
    if (!result.success) {
      toast.show(
        result.cancelled ? 'Authentication cancelled' : 'Authentication failed',
        'error'
      );
      return;
    }
    setIsRevealed(true);
  };

  const [showWarning, setShowWarning] = useState(false);

  const handleCopyRequest = () => {
    if (!isRevealed) return;
    setShowWarning(true);
  };

  const handleCopyConfirm = async () => {
    setShowWarning(false);
    await setClipboardString(mnemonic.join(' '));
    toast.show('Phrase copied to clipboard', 'success');
  };

  const handleCopyCancel = () => {
    setShowWarning(false);  };

  const handleBack = () => navigation.goBack();

  return (    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.header}>
        <ScreenBackButton onPress={handleBack} />
        <Text style={styles.headerTitle}>BACKUP WALLET</Text>
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
              <Text style={styles.warningTitle}>SECRET RECOVERY PHRASE</Text>
              <Text style={styles.warningDesc}>
                Never share this phrase with anyone. Veilpay will never ask for it. Anyone with these 12 words can access your funds from anywhere.
              </Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>YOUR 12-WORD PHRASE</Text>
          
          <SovereignCard backgroundColor={colors.surfaceCard} padding={20} style={styles.mnemonicCard}>
            {!isRevealed ? (
              <View style={styles.hiddenOverlay}>
                <View style={styles.blurEffect} />
                <Icon name="private" size={48} color={colors.textFaint} style={{ marginBottom: 16 }} />                <Text style={styles.hiddenText}>Tap below to reveal your phrase</Text>
                <Text style={styles.hiddenSubtext}>Make sure no one is watching your screen</Text>
              </View>
            ) : (
              <Animated.View entering={FadeIn} style={styles.wordsGrid}>
                {mnemonic.map((word, index) => (                  <View key={index} style={styles.wordContainer}>
                    <Text style={styles.wordNumber}>{index + 1}.</Text>
                    <Text style={styles.wordText}>{word}</Text>
                  </View>
                ))}
              </Animated.View>
            )}
          </SovereignCard>

          {!isRevealed ? (
            <SovereignButton 
              title="REVEAL PHRASE" 
              variant="primary" 
              onPress={handleReveal}
              style={styles.actionButton}
            />
          ) : (
            <View style={styles.revealedActions}>
              <SovereignButton 
                title="COPY TO CLIPBOARD" 
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
          )}

          <View style={styles.infoBox}>
            <Icon name="info" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>
              Write these words down on paper and store them in a secure place. Do not save them in emails or cloud storage.
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
        title="Security Warning"
        message="Copying your recovery phrase to the clipboard is risky. Other apps may be able to read it. Are you sure?"
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
    backgroundColor: colors.warningBg + '15',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.warningBg + '30',
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
    letterSpacing: 1,
  },
  mnemonicCard: {
    minHeight: 280,
    justifyContent: 'center',
    marginBottom: 32,
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
  wordsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  wordContainer: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  wordNumber: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textFaint,
    marginRight: 8,
    width: 20,
  },
  wordText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.accent,
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
    backgroundColor: colors.bgTertiary,
    padding: 16,
    borderRadius: 12,
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
});
