import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SovereignCard } from '../SovereignCard';
import { Icon } from '../Icon';
import { BalanceSkeleton } from '../Skeleton';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import type { ChainConfig } from '../../stores/walletStore';
import type { MarketQuote } from '../../utils/marketData';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatFiat } from '../../utils/formatters';

interface DashboardBalanceCardProps {
  isLoadingBalance: boolean;
  balanceVisible: boolean;
  onToggleVisibility: () => void;
  displayBalance: string;
  displayCrypto: string;
  activeChain: ChainConfig | null;
  marketQuote: MarketQuote | undefined;
}

export const DashboardBalanceCard: React.FC<DashboardBalanceCardProps> = ({
  isLoadingBalance,
  balanceVisible,
  onToggleVisibility,
  displayBalance,
  displayCrypto,
  activeChain,
  marketQuote,
}) => {
  const styles = useStyles(themeStyles);
  const theme = useTheme();
  const { colors } = theme;
  
  // Use user's preferred currency setting
  const { nativeCurrency } = useSettingsStore();

  const showSkeleton = isLoadingBalance && (!marketQuote || displayBalance === '0.00');
  
  const formattedBalance = formatFiat(Number(displayBalance), nativeCurrency || 'USD');

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
                  <Text style={styles.balanceLabel}>[ LEDGER_BALANCE ]</Text>
                  <Text
                    style={styles.balanceAmount}
                    accessibilityLiveRegion="assertive"
                    accessibilityLabel={`Total balance: ${formattedBalance}`}
                  >
                    {balanceVisible
                      ? formattedBalance
                      : '••••••••••••••••••'}
                  </Text>
                  <Text style={styles.balanceCrypto}>
                    {balanceVisible
                      ? `${displayCrypto} ${activeChain?.symbol ?? 'ETH'}`
                      : '••••••••••••'}
                  </Text>
                </View>
                <View style={styles.balanceRight}>
                  <TouchableOpacity
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
                  </TouchableOpacity>
                  <View style={styles.privacyBadge}>
                    <Icon name="private" size={14} color={colors.accent} />
                    <Text style={styles.privacyBadgeText}>PRIVATE</Text>
                  </View>
                </View>
              </View>
            </>
          )}

          {/* Price indicator */}
          {!showSkeleton && marketQuote && (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>
                {activeChain?.symbol || 'ETH'} @ {formatFiat(marketQuote.price, nativeCurrency || 'USD')}
              </Text>
              <Text style={styles.priceSource}>
                {marketQuote.source} • {marketQuote.isStale ? 'stale' : 'live'}
              </Text>
            </View>
          )}

          {/* Change indicator */}
          {!showSkeleton && (
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
          )}
        </View>
      </SovereignCard>
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
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
