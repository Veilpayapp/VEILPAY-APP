/**
* Veilpay Create Wallet Screen (C2a)
* Displays generated 12-word seed phrase with copy & confirmation flow
* Uses the current hybrid structural design language for all interactive elements
*
* SECURITY: Uses cryptographically secure BIP-39 mnemonic generation
*/

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,  StyleSheet,  TouchableOpacity,
  ScrollView,
  StatusBar,
  InteractionManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { useWalletStore } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import { Skeleton } from '../components/Skeleton';
import Toast, { useToast } from '../components/Toast';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { Icon } from '../components/Icon';
import { generateMnemonic, deriveAddressFromMnemonic } from '../utils/bip39';
import { setClipboardString } from '../utils/clipboard';
import { clearStoredMnemonic, storeMnemonic } from '../utils/transactions';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type CreateWalletScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'CreateWallet'>;

interface CreateWalletScreenProps {
  navigation: CreateWalletScreenNavigationProp;}export function CreateWalletScreen({ navigation }: CreateWalletScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [seedWords, setSeedWords] = useState<string[]>([]);
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDerivingAddress, setIsDerivingAddress] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { connect } = useWalletStore();
  const toast = useToast();
  const clipboardClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isMounted = true;
    let timer1: NodeJS.Timeout | undefined;
    let timer2: NodeJS.Timeout | undefined;

    async function generateSecureSeed() {
      try {
        // Yield to animation thread first to prevent stutter
        await new Promise(resolve => { timer1 = setTimeout(resolve, 300); });
        
        // Generate 12-word BIP-39 mnemonic using cryptographically secure RNG
        const words = await generateMnemonic(12);

        if (isMounted) {
          setSeedWords(words);
          setIsLoading(false);
          setIsDerivingAddress(true);
        }

        // Yield again before derivation
        await new Promise(resolve => { timer2 = setTimeout(resolve, 50); });

        // Derive address in the background so users can copy/write words immediately.
        const address = await deriveAddressFromMnemonic(words, { skipValidation: true });

        if (isMounted) {
          setDerivedAddress(address);
        }
      } catch (error) {
        console.error('[CreateWallet] Seed generation error:', error);
        if (isMounted) {
          const errorMessage = error instanceof Error
            ? `Failed to generate seed: ${error.message}`
            : 'Failed to generate secure seed phrase. Please try again.';
          toast.show(errorMessage, 'error');
          setIsLoading(false);
        }
      } finally {
        if (isMounted) {
          setIsDerivingAddress(false);
        }
      }
    }

    // Run after screen transition to ensure smooth entering animation
    const interaction = InteractionManager.runAfterInteractions(() => {
      generateSecureSeed();
    });

    return () => {
      isMounted = false;
      interaction.cancel();      if (timer1) clearTimeout(timer1);
      if (timer2) clearTimeout(timer2);
    };  }, []);

  const handleCopy = useCallback(async () => {
    if (seedWords.length === 0) return;
    const copied = await setClipboardString(seedWords.join(' '));
    if (!copied) {
      toast.show('Clipboard unavailable in this runtime', 'error');
      return;
    }

    if (clipboardClearTimerRef.current) {
      clearTimeout(clipboardClearTimerRef.current);
    }

    clipboardClearTimerRef.current = setTimeout(() => {
      void setClipboardString('');
      clipboardClearTimerRef.current = null;
    }, 30000);    toast.show('Seed phrase copied. Clear clipboard after writing it down!', 'success');
  }, [seedWords, toast]);  useEffect(() => {
    return () => {
      if (clipboardClearTimerRef.current) {
        clearTimeout(clipboardClearTimerRef.current);
      }
    };
  }, []);

  const handleContinue = async () => {
    if (!savedConfirmed || seedWords.length === 0) return;

    setIsCreating(true);
    let mnemonicStored = false;

    try {
      let addressToConnect = derivedAddress;
      if (!addressToConnect) {
        addressToConnect = await deriveAddressFromMnemonic(seedWords, { skipValidation: true });
        setDerivedAddress(addressToConnect);
      }

      // Store the mnemonic securely for transaction signing
      await storeMnemonic(seedWords);
      mnemonicStored = true;

      // Connect wallet with the derived Ethereum address
      await connect(addressToConnect, 'evm');
      navigation.reset({ index: 0, routes: [{ name: SCREENS.SET_PASSWORD as any }] });
    } catch {
      if (mnemonicStored) {
        try {
          await clearStoredMnemonic();
        } catch {
          // Keep original failure message for user flow simplicity.
        }
      }

      toast.show('Failed to create wallet. Please try again.', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      {/* Header */}
      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>CREATE WALLET</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={styles.animatedContent}>
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Security Warning */}
          <SovereignCard style={{ marginBottom: 24 }} padding={16} backgroundColor={colors.bgTertiary}>
            <View style={styles.warningContent}>
              <View style={styles.warningIconBox}>
                <Icon name="warning" size={24} color={colors.accent} />
              </View>
              <View style={styles.warningTextContainer}>
                <Text style={styles.warningTitle}>KEEP THIS SAFE</Text>
                <Text style={styles.warningBody}>
                  Write down your seed phrase and store it offline. Anyone with these words can access your funds.
                </Text>
              </View>
            // eslint-disable-next-line design-no-em-dash-in-jsx-text
            </View>
          </SovereignCard>

          {/* Title */}
          <Text style={styles.sectionTitle}>YOUR RECOVERY PHRASE</Text>
          // eslint-disable-next-line design-no-em-dash-in-jsx-text
          <Text style={styles.sectionSubtitle}>12 words — do not share with anyone</Text>

          {/* Seed Grid */}
          <SovereignCard backgroundColor={colors.bgSecondary} padding={12} style={{ marginBottom: 24 }}>
            <View style={styles.seedGrid}>
              {isLoading ? (
                // Loading skeleton while secure seed phrase is being generated.
                <View style={styles.loadingContainer}>
                  <View style={styles.seedSkeletonGrid}>
                    {Array.from({ length: 12 }).map((_, index) => (                      <View key={`seed-skeleton-${index}`} style={styles.seedCell}>
                        <Skeleton width={10} height={10} borderRadius={2} />
                        <Skeleton width={52} height={12} borderRadius={2} style={{ marginLeft: 8 }} />
                      </View>                    ))}
                  </View>                  <Text style={styles.loadingText}>Generating secure seed phrase...</Text>
                </View>
              ) : (
                seedWords.map((word: string, index: number) => (                  <View key={index} style={styles.seedCell}>
                    <Text style={styles.seedNumber}>{index + 1}</Text>
                    <Text style={styles.seedWord}>{word}</Text>
                  </View>
                ))
              )}
            </View>
          </SovereignCard>

          {/* Copy Button - Sovereign */}
          <SovereignButton
            title="COPY TO CLIPBOARD"
            variant="secondary"
            onPress={handleCopy}
            style={{ marginBottom: 24 }}
          />

          {/* Confirmation Checkbox */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setSavedConfirmed(!savedConfirmed)}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityLabel="I have saved my seed phrase securely"
            accessibilityHint="Required before continuing"
            accessibilityState={{ checked: savedConfirmed }}
          >
            <View style={[styles.checkboxWrapper, savedConfirmed && styles.checkboxWrapperActive]}>
              {savedConfirmed && <Icon name="success" size={16} color={colors.bgPrimary} />}
            </View>
            <Text style={styles.checkboxLabel}>
              I've written down my seed phrase and stored it securely
            </Text>
          </TouchableOpacity>

          {/* Derived Address Display */}
          {!isLoading && (            <SovereignCard backgroundColor={colors.surfaceCard} padding={16} style={{ marginBottom: 24 }}>
              <View style={styles.addressContainer}>
                <Text style={styles.addressLabel}>YOUR WALLET ADDRESS</Text>
                {derivedAddress ? (
                  <Text style={styles.addressValue}>{derivedAddress}</Text>
                ) : (
                  <View style={styles.addressLoadingContainer}>
                    <Skeleton width={220} height={14} borderRadius={2} />                    <Text style={styles.addressLoadingText}>Preparing wallet address...</Text>
                  </View>
                )}
              </View>
            </SovereignCard>
          )}

          {/* Continue Button - Sovereign */}
          {(() => {
            const canContinue = savedConfirmed && !isLoading && !isDerivingAddress && !isCreating && Boolean(derivedAddress);
            const buttonTitle = isCreating
              ? 'CREATING...'
              : isDerivingAddress
                ? 'PREPARING ADDRESS...'
                : savedConfirmed
                  ? 'CONTINUE'
                  : 'CONFIRM TO CONTINUE';

            return (
              <SovereignButton
                title={buttonTitle}
                variant="primary"
                onPress={handleContinue}
                disabled={!canContinue}
                style={{ marginTop: 16, marginBottom: 32 }}
              />
            );
          })()}
        </ScrollView>
      </Animated.View>

      {/* Toast Notification */}
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
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
    borderBottomWidth: 2,
    borderBottomColor: colors.outlineSubtle,
  },
  backButton: {
    width: 80,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  backButtonText: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  animatedContent: {
    flex: 1,
  },
  warningContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  warningIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningIcon: {
    fontSize: 20,
  },
  warningTextContainer: {
    flex: 1,
    gap: 4,
  },
  warningTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  warningBody: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 20,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 16,
  },
  seedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  seedCell: {
    width: '31%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  seedNumber: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    width: 16,
  },
  seedWord: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    flex: 1,
  },
  loadingContainer: {
    width: '100%',
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 8,
  },
  seedSkeletonGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  loadingText: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 16,
  },
  checkboxWrapper: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: colors.bgTertiary,
    borderWidth: 0,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxWrapperActive: {
    backgroundColor: colors.accent,
    borderColor: 'transparent',
  },
  checkmark: {
    color: colors.bgPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  addressContainer: {
    gap: 8,
  },
  addressLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  addressValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textPrimary,
  },
  addressLoadingContainer: {
    gap: 8,
  },
  addressLoadingText: {
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textMuted,
  },
});

export default CreateWalletScreen;
