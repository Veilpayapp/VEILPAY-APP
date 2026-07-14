/**
 * Veilpay Onboarding Screen
 * First-time user onboarding with feature highlights
 * 
 * UPDATED: Now uses premium SVG icons instead of emojis
 */

import React from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { SCREENS } from '../constants/screens';
import { Logo } from '../components/Logo';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import { FeatureCard } from '../components/FeatureCard';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import { t } from '../i18n';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type OnboardingScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

interface OnboardingScreenProps {
  navigation: OnboardingScreenNavigationProp;
}

const FEATURES = [
  { id: '1', iconName: 'shield' as const, title: 'STEALTH ADDRESS', description: 'Generated one-time addresses for every transaction to break on-chain links.' },
  { id: '2', iconName: 'zk-proof' as const, title: 'ZK PROOFS', description: 'Mathematical privacy guarantees while ensuring total integrity limits.' },
  { id: '3', iconName: 'globe' as const, title: 'MULTI-CHAIN', description: 'Seamless support for EVM, Solana, and Stellar ecosystems within a single vault.' },
];

export function OnboardingScreen({ navigation }: OnboardingScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const handleGetStarted = () => {
    trackEvent(ANALYTICS_EVENTS.ONBOARDING_GET_STARTED);
    navigation.navigate(SCREENS.WALLET_CONNECT);
  };

  const handleRestoreVault = () => {
    trackEvent(ANALYTICS_EVENTS.ONBOARDING_RESTORE_VAULT);
    navigation.navigate(SCREENS.WALLET_CONNECT);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={styles.animatedContent}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Logo variant="manual" size="small" />
          </View>

          <View style={styles.heroSection}>
            <Text style={styles.headline}>{t('onboarding.headline')}</Text>

            <View style={styles.badgeWrapper}>
              <Text style={styles.badgeText}>{t('onboarding.badge')}</Text>
            </View>
          </View>

          <View style={styles.featuresStack}>
            {FEATURES.map((item) => (
              <FeatureCard
                key={item.id}
                title={item.title}
                description={item.description}
                iconName={item.iconName}
              />
            ))}
          </View>

          <View style={styles.footer}>
            <SovereignButton
              title={t('onboarding.getStarted')}
              variant="primary"
              style={{ width: '100%' }}
              onPress={handleGetStarted}
              testID="onboarding-get-started"
              accessibilityLabel={t('onboarding.a11y.getStarted')}
            />

            <PressableOpacity
              style={styles.secondaryButton}
              onPress={handleRestoreVault}
              activeOpacity={0.6}
              testID="onboarding-restore-vault"
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.a11y.restoreVault')}
              accessibilityHint="Opens wallet restore flow"
            >
              <Text style={styles.secondaryButtonText}>{t('onboarding.restoreVault')}</Text>
            </PressableOpacity>
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceScreen },
  animatedContent: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 48, paddingTop: 12 },
  header: { height: 64, justifyContent: 'center', alignItems: 'center' },

  heroSection: { alignItems: 'center', paddingTop: 12, paddingBottom: 16 },
  headline: { fontFamily: typography.fontFamily.headlineSovereign, fontSize: 32, lineHeight: 40,     color: colors.textPrimary, textAlign: 'center', textTransform: 'uppercase', marginBottom: 24 },

  badgeWrapper: {
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  badgeText: { fontFamily: typography.fontFamily.mono, fontSize: 13, color: colors.textMuted, fontWeight: 'bold', letterSpacing: 1 },

  featuresStack: { gap: 12, marginTop: 48, marginBottom: 32 },

  footer: { paddingTop: 16, alignItems: 'center', gap: 32 },

  secondaryButton: {
    borderBottomWidth: 2,
    borderColor: colors.textMuted,
    paddingBottom: 2,
    marginTop: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonText: { fontFamily: typography.fontFamily.mono, fontSize: 14,     color: colors.textMuted, letterSpacing: 1, fontWeight: 'bold' }
});

export default OnboardingScreen;
