/**
 * Veilpay Import Wallet Screen (C2b)
 * Allows importing an existing wallet via seed phrase
 * Uses the current hybrid structural design language for all interactive elements
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,  StyleSheet,  TouchableOpacity,
  ScrollView,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { useWalletStore } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from '../components/Toast';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { validateMnemonic, deriveAddressFromMnemonic } from '../utils/bip39';
import { clearStoredMnemonic, storeMnemonic } from '../utils/transactions';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type ImportWalletScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ImportWallet'>;

type WordCount = 12 | 24;

interface ImportWalletScreenProps {
  navigation: ImportWalletScreenNavigationProp;}export function ImportWalletScreen({ navigation }: ImportWalletScreenProps) {  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [wordCount, setWordCount] = useState<WordCount>(12);  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const [passphrase, setPassphrase] = useState('');
  const [isPhraseTouched, setIsPhraseTouched] = useState(false);
  const [mnemonicValidationState, setMnemonicValidationState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [importing, setImporting] = useState(false);
  const { connect } = useWalletStore();
  const inputRefs = useRef<TextInput[]>([]);
  const toast = useToast();

  const filledWords = words.filter((word) => word.trim().length > 0).length;
  const hasAllWords = filledWords === wordCount;
  const hasAnyShortWord = words.some((word) => {
    const normalized = word.trim();
    return normalized.length > 0 && normalized.length < 2;
  });

  useEffect(() => {
    let cancelled = false;
    let timerId: NodeJS.Timeout | undefined;

    if (!hasAllWords || hasAnyShortWord) {
      setMnemonicValidationState('idle');
      return () => {
        cancelled = true;
      };
    }

    setMnemonicValidationState('checking');

    const validatePhrase = async () => {
      try {
        // Yield to the UI thread so that pasted words render before blocking on validation
        await new Promise(resolve => { timerId = setTimeout(resolve, 50); });
        if (cancelled) return;

        const isValidMnemonic = await validateMnemonic(words.slice(0, wordCount));
        if (!cancelled) {
          setMnemonicValidationState(isValidMnemonic ? 'valid' : 'invalid');
        }
      } catch {
        if (!cancelled) {
          setMnemonicValidationState('invalid');
        }
      }
    };

    void validatePhrase();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [hasAllWords, hasAnyShortWord, wordCount, words]);

  const handleWordChange = (index: number, value: string) => {
    setIsPhraseTouched(true);

    const updated = [...words];
    // Handle paste of full seed phrase
    if (value.includes(' ')) {
      const pasted = value.trim().split(/\s+/);
      if (pasted.length >= wordCount) {
        const newWords = pasted.slice(0, wordCount);
        setWords(newWords);
        inputRefs.current[wordCount - 1]?.focus();
        return;
      }
    }
    updated[index] = value.toLowerCase().trim();
    setWords(updated);
    // Auto-advance on space
    if (value.endsWith(' ') && index < wordCount - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleWordCountChange = (count: WordCount) => {
    setWordCount(count);
    setWords(Array(count).fill(''));
    setIsPhraseTouched(false);
    setMnemonicValidationState('idle');
  };

  const phraseError = !isPhraseTouched
    ? ''
    : hasAnyShortWord
      ? 'Each recovery word should be at least 2 characters.'
      : !hasAllWords
        ? `Enter all ${wordCount} words (${filledWords}/${wordCount} complete).`
        : mnemonicValidationState === 'invalid'
          ? 'Recovery phrase checksum is invalid. Re-check spelling and word order.'
          : '';

  const phraseHint = mnemonicValidationState === 'checking'
    ? 'Validating recovery phrase checksum...'
    : mnemonicValidationState === 'valid'
      ? 'Recovery phrase checksum is valid.'
      : '';

  const isValid = hasAllWords && !hasAnyShortWord && mnemonicValidationState === 'valid';

  const handleImport = async () => {
    if (!isValid) {
      setIsPhraseTouched(true);

      if (mnemonicValidationState === 'checking') {
        toast.show('Validation in progress. Please wait a moment.', 'error');
      } else {
        toast.show('Enter a valid recovery phrase to continue.', 'error');
      }
      return;
    }

    setImporting(true);
    let mnemonicStored = false;

    try {
      // Validate the mnemonic phrase using BIP-39
      const mnemonicWords = words.slice(0, wordCount);
      const isValidMnemonic = await validateMnemonic(mnemonicWords);

      if (!isValidMnemonic) {
        toast.show('Invalid seed phrase. Please check your words and try again.', 'error');
        return;
      }

      // Store the mnemonic securely for transaction signing
      await storeMnemonic(mnemonicWords);
      mnemonicStored = true;

      // Derive the Ethereum address from the mnemonic
      const address = await deriveAddressFromMnemonic(mnemonicWords);
      await connect(address, 'evm');
      navigation.reset({ index: 0, routes: [{ name: SCREENS.SET_PASSWORD as any }] });
    } catch (error) {
      if (mnemonicStored) {
        try {
          await clearStoredMnemonic();
        } catch {
          // Keep original import failure message for user flow simplicity.
        }
      }

      const errorMessage = error instanceof Error ? error.message : 'Could not restore wallet from this seed phrase.';
      toast.show(errorMessage, 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <SafeAreaView style={styles.container}>

        <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      {/* Header */}
      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>IMPORT WALLET</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={styles.animatedContent}>
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Word Count Toggle - NeoPop */}
          <View style={styles.toggleRow}>
            {([12, 24] as WordCount[]).map((count) => (
              <TouchableOpacity
                key={count}
                onPress={() => handleWordCountChange(count)}
                activeOpacity={0.9}
                style={styles.toggleButton}
                accessibilityRole="button"
                accessibilityLabel={`Use ${count} word recovery phrase`}
                accessibilityHint="Changes the number of words to import"
                accessibilityState={{ selected: wordCount === count }}
              >
                  <SovereignCard
                    backgroundColor={wordCount === count ? colors.textPrimary : 'transparent'}
                    padding={0}
                    style={{ borderRadius: 0, borderWidth: 1, borderColor: colors.textPrimary }}
                  >
                  <Text
                    style={[
                      styles.toggleChipText,
                      wordCount === count && { color: colors.bgPrimary },
                    ]}
                  >
                    {count} WORDS
                  </Text>
                </SovereignCard>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.hint}>Enter your recovery phrase below</Text>

          {/* Word Input Grid - Sovereign */}
<SovereignCard backgroundColor={colors.surfaceCard} padding={12} style={{ marginBottom: 24 }}>
      <View style={styles.wordGrid}>
              {Array.from({ length: wordCount }).map((_, index) => (
                <View key={index} style={styles.wordCell}>
                  <Text style={styles.wordNumber}>{index + 1}</Text>
                  <TextInput
                    ref={(r) => {
                      if (r) inputRefs.current[index] = r;
                    }}
                    style={styles.wordInput}
                    value={words[index]}
                    onChangeText={(val) => handleWordChange(index, val)}
                    onBlur={() => setIsPhraseTouched(true)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType={index < wordCount - 1 ? 'next' : 'done'}
                    onSubmitEditing={() => {
                      if (index < wordCount - 1) inputRefs.current[index + 1]?.focus();
                    }}
          placeholderTextColor={colors.textFaint}
          placeholder="word"
        />
      </View>
    ))}
  </View>
</SovereignCard>
{phraseError ? <Text style={styles.validationError}>{phraseError}</Text> : null}
{!phraseError && phraseHint ? <Text style={styles.validationHint}>{phraseHint}</Text> : null}

{/* Optional Passphrase */}
<Text style={styles.sectionLabel}>OPTIONAL PASSPHRASE (BIP39)</Text>
<SovereignCard backgroundColor={colors.surfaceCard} padding={4} style={{ marginBottom: 24 }}>
  <TextInput
    style={styles.passphraseInput}
    value={passphrase}
    onChangeText={setPassphrase}
    placeholder="Leave blank if none"
    placeholderTextColor={colors.textFaint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </SovereignCard>

          {/* Import Button - Sovereign */}
          <SovereignButton
            title={importing ? 'IMPORTING...' : 'IMPORT WALLET'}
            variant="primary"
            onPress={handleImport}
            disabled={!isValid || importing}
            style={{ marginBottom: 32 }}
          />
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
    </KeyboardAvoidingView>
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
  toggleRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  toggleButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  toggleChipText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textMuted,
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  toggleChipTextActive: {
    color: colors.textPrimary,
  },
  hint: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 16,
  },
  validationError: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: 12,
    color: colors.error,
    marginBottom: 12,
    marginTop: -10,
  },
  validationHint: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: 12,
    color: colors.success,
    marginBottom: 12,
    marginTop: -10,
  },
  wordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  wordCell: {
    width: '31%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.textPrimary,
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  wordNumber: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    width: 16,
  },
  wordInput: {
    flex: 1,
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    padding: 0,
  },
  sectionLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  passphraseInput: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 16,
  },
});

export default ImportWalletScreen;
