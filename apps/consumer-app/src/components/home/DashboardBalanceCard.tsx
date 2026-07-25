import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PressableOpacity } from '../PressableOpacity';
import { SovereignCard } from '../SovereignCard';
import { Icon } from '../Icon';
import { BalanceSkeleton } from '../Skeleton';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import { PrivacyStatusBanner } from './PrivacyStatusBanner';
import type { ChainConfig } from '../../stores/walletStore';
import type { MarketQuote } from '../../utils/marketData';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatFiat } from '../../utils/formatters';

/** Soft readiness for private mode — shown only when not fully ready. */
export type PrivacyReadyStatus = 'ready' | 'setting_up' | 'unavailable' | null;

interface DashboardBalanceCardProps {
  isLoadingBalance: boolean;
  balanceVisible: boolean;
  onToggleVisibility: () => void;
  displayBalance: string;
  displayCrypto: string;
  activeChain: ChainConfig | null;
  marketQuote: MarketQuote | undefined;
  /**
   * When true, Home is in privacy-pool mode (e.g. Private XLM).
   * Same card chrome; labels emphasize private balance without protocol jargon.
   */
  privacyMode?: boolean;
  /** Crypto ticker for the second line (default: active chain symbol). */
  cryptoSymbol?: string;
  /**
   * @deprecated Feature bullets were removed from the premium home card.
   * Kept optional so callers can stop passing without a breaking type error.
   */
  privacyFeatures?: string[];
  /**
   * Optional private-mode readiness chip on the balance card.
   * `ready` → subtle "Private XLM ready"; setting_up / unavailable → status line.
   */
  privacyReadyStatus?: PrivacyReadyStatus;
  /** Optional recovery / status detail under the crypto amount (e.g. restore result). */
  privacyStatusDetail?: string | null;
}

export const DashboardBalanceCard: React.FC<DashboardBalanceCardProps> = ({
  isLoadingBalance,
  balanceVisible,
  onToggleVisibility,
  displayBalance,
  displayCrypto,
  activeChain,
  marketQuote,
  privacyMode = false,
  cryptoSymbol,
  privacyReadyStatus = null,
  privacyStatusDetail = null,
}) => {
  const styles = useStyles(themeStyles);
  const theme = useTheme();
  const { colors } = theme;

  const { nativeCurrency } = useSettingsStore();

  // Skeleton only when loading AND we have no usable numbers yet.
  // Never skeleton in private mode once we have a crypto amount or ready status —
  // Settings→Home remounts were flashing a permanent loading card.
  const cryptoEmpty =
    !displayCrypto ||
    displayCrypto === '0' ||
    displayCrypto === '0.0' ||
    displayCrypto === '0.00' ||
    displayCrypto === '0.000';
  const showSkeleton =
    isLoadingBalance &&
    cryptoEmpty &&
    (!marketQuote || displayBalance === '0.00') &&
    !(privacyMode && (privacyReadyStatus === 'ready' || privacyStatusDetail));

  const formattedBalance = formatFiat(Number(displayBalance), nativeCurrency || 'USD');
  const symbol = cryptoSymbol || activeChain?.symbol || 'ETH';
  const balanceLabel = privacyMode ? 'Private balance' : 'Total balance';
  // Quiet private marker — not "Shielded" (protocol-y).
  const badgeText = privacyMode ? 'Private' : 'Wallet';

  const statusLine =
    privacyMode && privacyReadyStatus === 'setting_up'
      ? 'Setting up…'
      : privacyMode && privacyReadyStatus === 'unavailable'
        ? 'Private sends unavailable'
        : privacyMode && privacyReadyStatus === 'ready'
          ? 'Private XLM ready'
          : null;

  return (
    <View style={styles.balanceCardWrapper}>
      <SovereignCard backgroundColor={colors.bgSecondary} padding={0}>
        <View style={styles.balanceContent}>
          {showSkeleton ? (
            <View style={styles.balanceSkeletonWrap}>
              <BalanceSkeleton />
            </View>
          ) : (
            <>
              <View style={styles.balanceRow}>
                <View>
                  <Text style={styles.balanceLabel}>{balanceLabel}</Text>
                  <Text
                    style={styles.balanceAmount}
                    accessibilityLiveRegion="assertive"
                    accessibilityLabel={
                      privacyMode
                        ? `Private balance: ${formattedBalance}`
                        : `Total balance: ${formattedBalance}`
                    }
                  >
                    {balanceVisible ? formattedBalance : '••••••••••••••••••'}
                  </Text>
                  <Text style={styles.balanceCrypto}>
                    {balanceVisible
                      ? `${displayCrypto} ${symbol}`
                      : '••••••••••••'}
                  </Text>
                  {privacyMode ? (
                    <PrivacyStatusBanner
                      readyStatus={privacyReadyStatus}
                      statusDetail={privacyStatusDetail}
                      privacyMode={privacyMode}
                    />
                  ) : null}
                </View>
                <View style={styles.balanceRight}>
                  <PressableOpacity
                    style={styles.visibilityBtn}
                    onPress={onToggleVisibility}
                    accessibilityRole="button"
                    accessibilityLabel={balanceVisible ? 'Hide balance' : 'Show balance'}
                    accessibilityHint={
                      balanceVisible
                        ? 'Hides your wallet balance for privacy'
                        : 'Shows your wallet balance'
                    }
                  >
                    <Icon
                      name={balanceVisible ? 'visibility' : 'visibility-off'}
                      size={20}
                      color={colors.textPrimary}
                    />
                  </PressableOpacity>
                  <Animated.View
                    key={privacyMode ? 'badge-private' : 'badge-wallet'}
                    entering={FadeIn.duration(200)}
                    style={[styles.privacyBadge, privacyMode && styles.privacyBadgeActive]}
                  >
                    <Icon name="private" size={14} color={colors.accent} />
                    <Text style={styles.privacyBadgeText}>{badgeText}</Text>
                  </Animated.View>
                </View>
              </View>
            </>
          )}

          {/* Price row — same shape public / private; no custody jargon */}
          {!showSkeleton && marketQuote && (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>
                {symbol}
                {' '}@ {formatFiat(marketQuote.price, nativeCurrency || 'USD')}
              </Text>
              <Text
                style={[
                  styles.priceSource,
                  statusLine ? styles.statusMuted : null,
                ]}
                accessibilityLabel={statusLine || undefined}
              >
                {statusLine
                  ? statusLine
                  : marketQuote.isStale
                    ? 'Price may be delayed'
                    : 'Live price'}
              </Text>
            </View>
          )}

          {/* Status-only fallback when no market quote (private mode) */}
          {!showSkeleton && !marketQuote && statusLine ? (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}> </Text>
              <Text style={[styles.priceSource, styles.statusMuted]}>{statusLine}</Text>
            </View>
          ) : null}

          {/* Public: 24h change. Private: no feature bullets (actions carry meaning). */}
          {!showSkeleton && !privacyMode ? (
            <View style={styles.changeRow}>
              {marketQuote?.change24h !== null && marketQuote?.change24h !== undefined ? (
                <>
                  <Icon
                    name={marketQuote.change24h >= 0 ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={marketQuote.change24h >= 0 ? colors.success : colors.error}
                  />
                  <Text
                    style={[
                      styles.changePositive,
                      marketQuote.change24h < 0 && styles.changeNegative,
                    ]}
                  >
                    {marketQuote.change24h >= 0 ? '+' : ''}
                    {marketQuote.change24h.toFixed(2)}%
                  </Text>
                </>
              ) : (
                <Text style={styles.changePlaceholder}>24h change unavailable</Text>
              )}
              <Text style={styles.changeLabel}>Today</Text>
            </View>
          ) : null}
        </View>
      </SovereignCard>
    </View>
  );
};

const themeStyles = (colors: Colors) =>
  StyleSheet.create({
    balanceCardWrapper: {
      paddingHorizontal: 24,
      marginBottom: 24,
    },
    balanceContent: {
      padding: 20,
    },
    balanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 16,
    },
    balanceLabel: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.textMuted,
      letterSpacing: 1,
      marginBottom: 4,
    },
    balanceAmount: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 36,
      color: colors.textPrimary,
      fontWeight: 'bold',
      letterSpacing: -1,
    },
    balanceCrypto: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 14,
      color: colors.textMuted,
      marginTop: 4,
    },
    privacyDetail: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 11,
      color: colors.accent,
      marginTop: 6,
      maxWidth: 220,
      lineHeight: 15,
    },
    balanceRight: {
      alignItems: 'flex-end',
      gap: 12,
    },
    visibilityBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    privacyBadge: {
      backgroundColor: colors.bgPrimary,
      borderWidth: 1,
      borderColor: colors.accent,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    privacyBadgeActive: {
      backgroundColor: colors.accentContainer,
    },
    privacyBadgeText: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 10,
      color: colors.accent,
      letterSpacing: 0.5,
      fontWeight: 'bold',
    },
    priceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    priceLabel: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.textMuted,
    },
    priceSource: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 10,
      color: colors.textTertiary,
    },
    statusMuted: {
      color: colors.textMuted,
    },
    changeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    changePositive: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.success,
    },
    changeNegative: {
      color: colors.error,
    },
    changePlaceholder: {
      fontFamily: typography.fontFamily.body,
      fontSize: 12,
      color: colors.textTertiary,
    },
    changeLabel: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.textTertiary,
    },
    balanceSkeletonWrap: {
      alignItems: 'center',
      paddingVertical: 8,
      marginBottom: 10,
    },
  });
