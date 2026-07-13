/**
 * Veilpay Privacy Level Screen
 * Chain-aware options:
 *   - EVM (Sepolia + stack): Standard / Stealth / Max
 *   - Stellar testnet (SPP): Standard / Private
 *   - Stellar mainnet: Standard; Private disabled (fail-closed)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { useSettingsStore, type PrivacyLevel } from '../stores/settingsStore';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from '../components/SovereignCard';
import { SovereignButton } from '../components/SovereignButton';
import Toast, { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { usePrivacyOptions } from '../hooks/usePrivacyOptions';

type PrivacyLevelScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'PrivacyLevel'
>;
type PrivacyLevelScreenRoute = RouteProp<RootStackParamList, 'PrivacyLevel'>;

interface PrivacyLevelScreenProps {
  navigation: PrivacyLevelScreenNavigationProp;
  route: PrivacyLevelScreenRoute;
}

export function PrivacyLevelScreen({ navigation, route }: PrivacyLevelScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { defaultPrivacyLevel, setPrivacyLevel } = useSettingsStore();
  const toast = useToast();

  const preferredFromRoute = route?.params?.preferredPrivacyLevel;
  const recipient = route?.params?.recipient || '';
  const amount = route?.params?.amount || '';
  const memo = route?.params?.memo || '';
  const token = route?.params?.token || 'ETH';
  const tokenAddress = route?.params?.tokenAddress;
  const tokenDecimals = route?.params?.tokenDecimals;

  // Token-aware: USDC (etc.) cannot use SPP Private — options clamp accordingly.
  const { options, clamp, isEnabled } = usePrivacyOptions(token);

  const initialLevel = useMemo<PrivacyLevel>(
    () => clamp(preferredFromRoute ?? defaultPrivacyLevel),
    [clamp, defaultPrivacyLevel, preferredFromRoute]
  );

  const [levelSelection, setSelectedLevel] = useState<PrivacyLevel>(initialLevel);
  const selectedLevel: PrivacyLevel = isEnabled(levelSelection)
    ? levelSelection
    : clamp(levelSelection);

  useEffect(() => {
    // When chain options change (user switched network mid-flow), re-clamp.
    setSelectedLevel((prev) => clamp(prev));
  }, [clamp]);

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
    const opt = options.find((o) => o.id === level);
    if (!opt?.enabled) {
      if (opt?.disabledReason) {
        toast.show(opt.disabledReason, 'error');
      }
      return;
    }
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

    navigation.navigate(SCREENS.PAYMENT_CONFIRMATION, {
      recipient,
      amount,
      memo,
      token,
      tokenAddress,
      tokenDecimals,
      privacyLevel: selectedLevel,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.header}>
        <ScreenBackButton onPress={handleBack} />
        <Text style={styles.headerTitle}>PRIVACY LEVEL</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(260)} style={styles.animatedContent}>
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <SovereignCard
            backgroundColor={colors.surfaceCard}
            padding={16}
            style={{ marginBottom: 24 }}
          >
            <View style={styles.infoBanner}>
              <Icon name="info" size={24} color={colors.accent} />
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>CHOOSE YOUR PRIVACY</Text>
                <Text style={styles.infoDesc}>
                  Options adapt to the active network. Stellar Private uses the SPP
                  pool; EVM stealth/max need the Sepolia privacy stack.
                </Text>
              </View>
            </View>
          </SovereignCard>

          {options.map((option) => {
            const disabled = !option.enabled;
            const selected = selectedLevel === option.id;
            return (
              <PressableOpacity
                key={option.id}
                onPress={() => handleSelect(option.id)}
                activeOpacity={disabled ? 1 : 0.9}
                disabled={disabled}
                style={{ marginBottom: 16, opacity: disabled ? 0.5 : 1 }}
                accessibilityRole="radio"
                accessibilityLabel={`${option.title} privacy. ${option.subtitle}`}
                accessibilityHint={
                  disabled
                    ? option.disabledReason ?? 'Unavailable on the current network'
                    : 'Selects this privacy mode for the transaction'
                }
                accessibilityState={{ selected, disabled }}
                testID={`privacy-level-row-${option.id}`}
              >
                <SovereignCard
                  backgroundColor={selected ? colors.textPrimary : colors.bgSecondary}
                  padding={16}
                >
                  <View style={styles.optionContent}>
                    <View style={styles.optionHeader}>
                      <View
                        style={[styles.optionIconBox, selected && styles.optionIconBoxActive]}
                      >
                        {/*
                          Icon chip uses bgPrimary when selected. Pair with textPrimary
                          (white-on-black in dark, dark-on-ivory in light). Never use
                          textOnPrimary here — in dark theme it is near-black and made
                          private-lock invisible on the dark chip.
                        */}
                        <Icon
                          name={option.iconName}
                          size={24}
                          color={colors.textPrimary}
                        />
                      </View>
                      <View style={styles.optionHeaderText}>
                        <View style={styles.optionTitleRow}>
                          <Text
                            style={[styles.optionTitle, selected && styles.optionTitleActive]}
                          >
                            {option.title}
                          </Text>
                          {option.recommended && !disabled && (
                            <View style={styles.recommendedBadge}>
                              <Text style={styles.recommendedText}>RECOMMENDED</Text>
                            </View>
                          )}
                        </View>
                        <Text
                          style={[
                            styles.optionSubtitle,
                            selected && styles.optionSubtitleActive,
                          ]}
                        >
                          {option.subtitle}
                        </Text>
                      </View>
                      {selected && (
                        <View style={styles.checkmarkBox}>
                          {/* Dark check on light selected card */}
                          <Icon name="success" size={20} color={colors.bgPrimary} />
                        </View>
                      )}
                    </View>

                    {option.description ? (
                      <Text
                        style={[
                          styles.optionDescription,
                          selected && styles.optionDescriptionActive,
                        ]}
                        testID={`privacy-level-description-${option.id}`}
                      >
                        {option.description}
                      </Text>
                    ) : null}

                    <View style={styles.featuresList}>
                      {option.features.map((feature) => (
                        <View key={feature} style={styles.featureRow}>
                          <Text
                            style={[
                              styles.featureBullet,
                              selected && styles.featureBulletActive,
                            ]}
                          >
                            •
                          </Text>
                          <Text
                            style={[styles.featureText, selected && styles.featureTextActive]}
                          >
                            {feature}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {disabled && option.disabledReason ? (
                      <Text
                        style={styles.unsupportedReason}
                        testID={`privacy-level-unsupported-${option.id}`}
                      >
                        {option.disabledReason}
                      </Text>
                    ) : null}
                  </View>
                </SovereignCard>
              </PressableOpacity>
            );
          })}

          <View style={styles.summarySection}>
            <Text style={styles.summaryTitle}>TRANSACTION SUMMARY</Text>
            <SovereignCard
              backgroundColor={colors.surfaceCard}
              padding={16}
              style={{ marginBottom: 24 }}
            >
              <View style={styles.summaryContent}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>To</Text>
                  <Text style={styles.summaryValue}>
                    {recipient.slice(0, 10)}…{recipient.slice(-6)}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Amount</Text>
                  <Text style={styles.summaryValue}>
                    {amount} {token}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Privacy</Text>
                  <Text style={[styles.summaryValue, { color: colors.accent }]}>
                    {selectedLevel.toUpperCase()}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>
                    {selectedLevel === 'private' ? 'Prove + network' : 'Network Fee'}
                  </Text>
                  <Text style={styles.summaryValue}>
                    {selectedLevel === 'private' ? '~10s prove · testnet' : `~0.001 ${token}`}
                  </Text>
                </View>
              </View>
            </SovereignCard>
          </View>

          <SovereignButton
            title="CONFIRM & SEND"
            variant="primary"
            onPress={handleContinue}
            style={{ marginBottom: 32 }}
            accessibilityLabel="Confirm privacy level and continue"
          />
        </ScrollView>
      </Animated.View>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />
    </SafeAreaView>
  );
}

const themeStyles = (colors: any) =>
  StyleSheet.create({
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
      color: colors.textPrimary,
      fontWeight: 'bold',
      letterSpacing: 1,
    },
    animatedContent: {
      flex: 1,
    },
    content: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 20,
    },
    infoBanner: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'flex-start',
    },
    infoTextContainer: {
      flex: 1,
    },
    infoTitle: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.accent,
      letterSpacing: 1,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    infoDesc: {
      fontFamily: typography.fontFamily.body,
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
    },
    optionContent: {
      gap: 12,
    },
    optionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    optionIconBox: {
      width: 44,
      height: 44,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionIconBoxActive: {
      borderColor: colors.bgPrimary,
      backgroundColor: colors.bgPrimary,
    },
    optionHeaderText: {
      flex: 1,
    },
    optionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    },
    optionTitle: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 15,
      color: colors.textPrimary,
      fontWeight: 'bold',
      letterSpacing: 0.5,
    },
    optionTitleActive: {
      color: colors.bgPrimary,
    },
    optionSubtitle: {
      fontFamily: typography.fontFamily.body,
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    optionSubtitleActive: {
      color: colors.bgSecondary,
    },
    recommendedBadge: {
      backgroundColor: colors.accent,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    recommendedText: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 9,
      color: colors.bgPrimary,
      fontWeight: 'bold',
      letterSpacing: 0.5,
    },
    checkmarkBox: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionDescription: {
      fontFamily: typography.fontFamily.body,
      fontSize: 12,
      color: colors.textMuted,
      lineHeight: 18,
    },
    optionDescriptionActive: {
      color: colors.bgSecondary,
    },
    featuresList: {
      gap: 6,
    },
    featureRow: {
      flexDirection: 'row',
      gap: 8,
    },
    featureBullet: {
      fontFamily: typography.fontFamily.mono,
      color: colors.accent,
      fontSize: 12,
    },
    featureBulletActive: {
      color: colors.accent,
    },
    featureText: {
      flex: 1,
      fontFamily: typography.fontFamily.body,
      fontSize: 12,
      color: colors.textMuted,
    },
    featureTextActive: {
      color: colors.bgSecondary,
    },
    unsupportedReason: {
      fontFamily: typography.fontFamily.body,
      fontSize: 12,
      color: colors.warning,
      marginTop: 4,
    },
    summarySection: {
      marginTop: 8,
    },
    summaryTitle: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.textMuted,
      letterSpacing: 1,
      marginBottom: 12,
      fontWeight: 'bold',
    },
    summaryContent: {
      gap: 10,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    summaryLabel: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.textMuted,
    },
    summaryValue: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.textPrimary,
      fontWeight: 'bold',
    },
  });

export default PrivacyLevelScreen;
