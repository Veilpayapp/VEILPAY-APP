/**
 * Veilpay Privacy Level Screen
 * Allows users to select their privacy level for transactions
 * Uses the current hybrid structural design language for all interactive elements
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { useWalletStore, PrivacyLevel } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from '../components/Toast';
import { Icon, IconName } from '../components/Icon';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';

type PrivacyLevelScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'PrivacyLevel'>;
type PrivacyLevelScreenRoute = RouteProp<RootStackParamList, 'PrivacyLevel'>;

interface PrivacyLevelScreenProps {
  navigation: PrivacyLevelScreenNavigationProp;
  route: PrivacyLevelScreenRoute;
}

interface PrivacyOption {
  id: PrivacyLevel;
  title: string;
  subtitle: string;
  iconName: IconName;
  features: string[];
  recommended?: boolean;
}

const PRIVACY_OPTIONS: PrivacyOption[] = [
  {
    id: 'standard',
    title: 'STANDARD',
    subtitle: 'Stealth Address Privacy',
    iconName: 'shield',
    features: [
      'One-time stealth addresses',
      'Breaks on-chain linkability',
      'Fast confirmation',
      'Low gas fees',
    ],
  },
  {
    id: 'max',
    title: 'MAXIMUM',
    subtitle: 'ZK Proof Privacy Pool',
    iconName: 'private-lock',
    features: [
      'Zero-knowledge proofs',
      'Complete transaction privacy',
      'Untraceable deposits',
      'Mathematical guarantees',
    ],
    recommended: true,
  },
];

export function PrivacyLevelScreen({ navigation, route }: PrivacyLevelScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { defaultPrivacyLevel, setPrivacyLevel } = useWalletStore();
  const [selectedLevel, setSelectedLevel] = useState<PrivacyLevel>(defaultPrivacyLevel);
  const toast = useToast();

  // Payment data from previous screen
  const recipient = route?.params?.recipient || '';
  const amount = route?.params?.amount || '';
  const memo = route?.params?.memo || '';
  const token = route?.params?.token || 'ETH';

  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.PRIVACY_LEVEL_VIEWED, {
      default_privacy_level: defaultPrivacyLevel,
      selected_privacy_level: selectedLevel,
      token,
    });
  }, [defaultPrivacyLevel, selectedLevel, token]);

  const handleBack = () => {
    trackEvent(ANALYTICS_EVENTS.PRIVACY_LEVEL_BACK_PRESSED, {
      selected_privacy_level: selectedLevel,
    });
    navigation.goBack();
  };

  const handleSelect = (level: PrivacyLevel) => {
    setSelectedLevel(level);
    trackEvent(ANALYTICS_EVENTS.PRIVACY_LEVEL_SELECTED, {
      privacy_level: level,
    });
  };

  const handleContinue = () => {
    setPrivacyLevel(selectedLevel);
    trackEvent(ANALYTICS_EVENTS.PRIVACY_LEVEL_CONTINUE_PRESSED, {
      privacy_level: selectedLevel,
      token,
      has_memo: Boolean(memo),
    });

    // Navigate to payment confirmation
    navigation.navigate(SCREENS.PAYMENT_CONFIRMATION, {
      recipient,
      amount,
      memo,
      token,
      privacyLevel: selectedLevel,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      {/* Header */}
      <View style={styles.header}>
        <ScreenBackButton onPress={handleBack} />
        <Text style={styles.headerTitle}>PRIVACY LEVEL</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(260)} style={styles.animatedContent}>
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Info Banner */}
<SovereignCard backgroundColor={colors.surfaceCard} padding={16} style={{ marginBottom: 24 }}>
      <View style={styles.infoBanner}>
        <Icon name="info" size={24} color={colors.accent} />
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>CHOOSE YOUR PRIVACY</Text>
                <Text style={styles.infoDesc}>
                  All transactions are private by default. Select how much privacy you need.
                </Text>
              </View>
            </View>
          </SovereignCard>

          {/* Privacy Options */}
          {PRIVACY_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.id}
              onPress={() => handleSelect(option.id)}
              activeOpacity={0.9}
              style={{ marginBottom: 16 }}
              accessibilityRole="radio"
              accessibilityLabel={`${option.title} privacy. ${option.subtitle}`}
              accessibilityHint="Selects this privacy mode for the transaction"
              accessibilityState={{ selected: selectedLevel === option.id }}
            >
              <SovereignCard
                backgroundColor={selectedLevel === option.id ? colors.textPrimary : colors.bgSecondary}
                padding={16}
              >
                <View style={styles.optionContent}>
                  <View style={styles.optionHeader}>
                    <View style={[
                      styles.optionIconBox,
                      selectedLevel === option.id && styles.optionIconBoxActive
                    ]}>
                      <Icon name={option.iconName} size={24} color={selectedLevel === option.id ? colors.accent : colors.textPrimary} />
                    </View>
                    <View style={styles.optionHeaderText}>
                      <View style={styles.optionTitleRow}>
                        <Text style={[
                          styles.optionTitle,
                          selectedLevel === option.id && styles.optionTitleActive
                        ]}>
                          {option.title}
                        </Text>
                        {option.recommended && (
                          <View style={styles.recommendedBadge}>
                            <Text style={styles.recommendedText}>RECOMMENDED</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[
                        styles.optionSubtitle,
                        selectedLevel === option.id && styles.optionSubtitleActive
                      ]}>
                        {option.subtitle}
                      </Text>
                    </View>
                    {selectedLevel === option.id && (
                      <View style={styles.checkmarkBox}>
                        <Icon name="success" size={20} color={colors.success} />
                      </View>
                    )}
                  </View>

                  <View style={styles.featuresList}>
                    {option.features.map((feature, index) => (
                      <View key={index} style={styles.featureRow}>
                        <Text style={[
                          styles.featureBullet,
                          selectedLevel === option.id && styles.featureBulletActive
                        ]}>
                          •
                        </Text>
                        <Text style={[
                          styles.featureText,
                          selectedLevel === option.id && styles.featureTextActive
                        ]}>
                          {feature}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              </SovereignCard>
            </TouchableOpacity>
          ))}

          {/* Transaction Summary */}
          <View style={styles.summarySection}>
            <Text style={styles.summaryTitle}>TRANSACTION SUMMARY</Text>
<SovereignCard backgroundColor={colors.surfaceCard} padding={16} style={{ marginBottom: 24 }}>
      <View style={styles.summaryContent}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>To</Text>
          <Text style={styles.summaryValue}>
            {recipient.slice(0, 10)}…{recipient.slice(-6)}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Amount</Text>
          <Text style={styles.summaryValue}>{amount} {token}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Privacy</Text>
          <Text style={[styles.summaryValue, { color: colors.accent }]}>
                    {selectedLevel.toUpperCase()}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Network Fee</Text>
                  <Text style={styles.summaryValue}>~0.001 {token}</Text>
                </View>
              </View>
            </SovereignCard>
          </View>

          {/* Continue Button */}
          <SovereignButton
            title="CONFIRM & SEND"
            variant="primary"
            onPress={handleContinue}
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
    borderBottomWidth: 1,
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
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoIcon: {
    fontSize: 20,
  },
  infoTextContainer: {
    flex: 1,
    gap: 4,
  },
  infoTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  infoDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  optionContent: {},
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  optionIconBox: {
    width: 44,
    height: 44,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconBoxActive: {
    backgroundColor: colors.accent,
  },
  optionIcon: {
    fontSize: 24,
  },
  optionHeaderText: {
    flex: 1,
    gap: 4,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  optionTitleActive: {
    color: colors.textOnPrimary,
  },
  recommendedBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recommendedText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textOnPrimary,
    fontWeight: 'bold',
  },
  optionSubtitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
  },
  optionSubtitleActive: {
    color: colors.textTertiary,
  },
  checkmarkBox: {
    width: 24,
    height: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  checkmark: {
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  featuresList: {
    gap: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureBullet: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
  },
  featureBulletActive: {
    color: colors.textTertiary,
  },
  featureText: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.textMuted,
  },
  featureTextActive: {
    color: colors.outlineDefault,
  },
  summarySection: {
    marginTop: 8,
  },
  summaryTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  summaryContent: {
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
  },
  summaryValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
});

export default PrivacyLevelScreen;
