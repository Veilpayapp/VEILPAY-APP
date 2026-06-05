/**
 * Veilpay Verify Wallet Screen
 * Prompts the user to enter 3 random words from their seed phrase to ensure it was saved.
 * Uses the current hybrid structural design language.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { useWalletStore } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from '../components/Toast';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { storeMnemonic, clearStoredMnemonic } from '../utils/transactions';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';

type VerifyWalletScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'VerifyWallet'>;
type VerifyWalletScreenRouteProp = RouteProp<RootStackParamList, 'VerifyWallet'>;

interface VerifyWalletScreenProps {
  navigation: VerifyWalletScreenNavigationProp;
  route: VerifyWalletScreenRouteProp;
}

export function VerifyWalletScreen({ navigation, route }: VerifyWalletScreenProps) {
  const { seedWords, derivedAddress } = route.params;
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const toast = useToast();
  const { connect } = useWalletStore();

  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [isVerifying, setIsVerifying] = useState(false);

  // Pick 3 random indices from 0 to 11 exactly once when component mounts
  const randomIndices = useMemo(() => {
    const indices = Array.from({ length: 12 }, (_, i) => i);
    const shuffled = indices.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3).sort((a, b) => a - b);
  }, []);

  const handleInputChange = (index: number, text: string) => {
    setInputs(prev => ({
      ...prev,
      [index]: text.trim().toLowerCase(),
    }));
  };

  const handleVerify = async () => {
    // Check if all selected words match
    for (const index of randomIndices) {
      if (inputs[index] !== seedWords[index]) {
        toast.show(`Word #${index + 1} is incorrect. Please check your backup.`, 'error');
        return;
      }
    }

    setIsVerifying(true);
    let mnemonicStored = false;

    try {
      // Store the mnemonic securely for transaction signing
      await storeMnemonic(seedWords);
      mnemonicStored = true;

      // Connect wallet with the derived Ethereum address
      await connect(derivedAddress, 'evm');
      
      // Navigate to set password
      navigation.reset({ index: 0, routes: [{ name: SCREENS.SET_PASSWORD as any }] });
    } catch (error) {
      if (mnemonicStored) {
        try {
          await clearStoredMnemonic();
        } catch {
          // Ignore
        }
      }
      toast.show('Failed to verify and create wallet. Please try again.', 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const allFilled = randomIndices.every(index => (inputs[index] || '').length > 0);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <ScreenBackButton onPress={() => navigation.goBack()} />
          <Text style={styles.headerTitle}>VERIFY PHRASE</Text>
          <View style={{ width: 80 }} />
        </View>

        <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={styles.animatedContent}>
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            
            <Text style={styles.sectionTitle}>VERIFY BACKUP</Text>
            <Text style={styles.sectionSubtitle}>
              To make sure you've written it down correctly, please enter the requested words from your seed phrase.
            </Text>

            <SovereignCard backgroundColor={colors.bgSecondary} padding={16} style={{ marginBottom: 32 }}>
              <View style={styles.inputsContainer}>
                {randomIndices.map((wordIndex) => (
                  <View key={wordIndex} style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Word #{wordIndex + 1}</Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: colors.textPrimary,
                          backgroundColor: colors.bgPrimary,
                          borderColor: colors.outlineSubtle,
                        }
                      ]}
                      value={inputs[wordIndex] || ''}
                      onChangeText={(text) => handleInputChange(wordIndex, text)}
                      placeholder={`Enter word #${wordIndex + 1}`}
                      placeholderTextColor={colors.textTertiary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                    />
                  </View>
                ))}
              </View>
            </SovereignCard>

            <SovereignButton
              title={isVerifying ? 'VERIFYING...' : 'VERIFY & CONTINUE'}
              variant="primary"
              onPress={handleVerify}
              disabled={!allFilled || isVerifying}
              style={{ marginBottom: 32 }}
            />
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

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
    lineHeight: 20,
    marginBottom: 24,
  },
  inputsContainer: {
    gap: 16,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 0, // structural design language
    paddingHorizontal: 16,
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
  },
});

export default VerifyWalletScreen;
