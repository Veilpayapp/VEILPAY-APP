import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { SCREENS } from '../constants/screens';
import { SovereignButton } from "../components/SovereignButton";
import { SovereignCard } from "../components/SovereignCard";
import { ScreenBackButton } from '../components/ScreenBackButton';
import * as SecureStore from 'expo-secure-store';
import { useSettingsStore } from '../stores/settingsStore';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import Toast, { useToast } from '../components/Toast';

type SetPasswordScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SetPassword'>;

interface SetPasswordScreenProps {
  navigation: SetPasswordScreenNavigationProp;
}

export function SetPasswordScreen({ navigation }: SetPasswordScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const toast = useToast();
  const setHasAppPassword = useSettingsStore((state) => state.setHasAppPassword);

  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Focus input on mount
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 400);
    return () => clearTimeout(timer);
  }, [step]);

  const handleNext = async () => {
    if (step === 'create') {
      if (password.length < 4) {
        toast.show('Password must be at least 4 characters.', 'error');
        return;
      }
      setStep('confirm');
    } else {
      if (password !== confirmPassword) {
        toast.show('Passwords do not match. Try again.', 'error');
        setStep('create');
        setPassword('');
        setConfirmPassword('');
        return;
      }

      // Save password
      setIsSaving(true);
      try {
        await SecureStore.setItemAsync('veilpay_app_password', password);
        setHasAppPassword(true);
        navigation.replace(SCREENS.BIOMETRIC_SETUP as any);
      } catch (error) {
        console.error('Failed to save password:', error);
        toast.show('Failed to secure vault. Try again.', 'error');
        setIsSaving(false);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />
      
      <View style={styles.header}>
        {step === 'confirm' ? (
          <ScreenBackButton onPress={() => {
            setStep('create');
            setConfirmPassword('');
          }} />
        ) : (
          <View style={styles.backButtonPlaceholder} />
        )}
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={styles.content}>
          <Text style={styles.title}>
            {step === 'create' ? 'SET CIPHER' : 'CONFIRM CIPHER'}
          </Text>
          <Text style={styles.subtitle}>
            {step === 'create' 
              ? 'This password encrypts your local vault. Do not lose it.' 
              : 'Re-enter your cipher to confirm.'}
          </Text>

          <SovereignCard 
            backgroundColor={colors.surfaceCard} 
            padding={4} 
            style={styles.inputCard}
          >
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={step === 'create' ? password : confirmPassword}
              onChangeText={step === 'create' ? setPassword : setConfirmPassword}
              secureTextEntry
              autoFocus
              placeholder="••••••••"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handleNext}
              editable={!isSaving}
            />
          </SovereignCard>

          <SovereignButton
            title={isSaving ? "SECURING..." : (step === 'create' ? 'CONTINUE' : 'LOCK VAULT')}
            variant="primary"
            onPress={handleNext}
            disabled={isSaving || (step === 'create' ? password.length < 4 : confirmPassword.length < 4)}
            style={styles.submitButton}
          />
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

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  header: {
    height: 64,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  backButtonPlaceholder: {
    width: 80,
    height: 44,
  },
  keyboardAvoid: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingBottom: 60, // extra padding for keyboard
  },
  title: {
    fontFamily: typography.fontFamily.headlineSovereign,
    fontSize: 40,
    color: colors.textPrimary,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  subtitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 48,
  },
  inputCard: {
    marginBottom: 32,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
  },
  input: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 24,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 16,
    textAlign: 'center',
    letterSpacing: 8,
  },
  submitButton: {
    width: '100%',
  },
});

export default SetPasswordScreen;
