import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useStyles, typography, type Colors } from '../../styles/design-tokens';
import { Skeleton } from '../Skeleton';
import { FALLBACK_ETH_PRICE, formatFiatValue, formatLastUpdated, getFiatExchangeRate } from '../../utils/priceFeed';
import { useSettingsStore } from '../../stores/settingsStore';
import { useEffect, useState } from 'react';

interface PaymentAmountDisplayProps {
  amount: string;
  token: string;
  priceLoading: boolean;
  ethPrice: number | null;
  lastUpdated: number | null;
  isStale: boolean;
  priceError: string | null;
}

export function PaymentAmountDisplay({
  amount,
  token,
  priceLoading,
  ethPrice,
  lastUpdated,
  isStale,
  priceError,
}: PaymentAmountDisplayProps) {
  const styles = useStyles(themeStyles);
  const { nativeCurrency } = useSettingsStore();
  const [fiatRate, setFiatRate] = useState(1);

  useEffect(() => {
    getFiatExchangeRate(nativeCurrency || 'USD').then(setFiatRate);
  }, [nativeCurrency]);

  return (
    <View style={styles.amountSection}>
      <Text style={styles.amountLabel}>YOU ARE SENDING</Text>
      <View style={styles.amountDisplay}>
        <Text style={styles.amountValue} accessibilityLiveRegion="assertive">{amount}</Text>
        <Text style={styles.amountToken}>{token}</Text>
      </View>

      {/* USD Value with live price */}
      <View style={styles.usdValueContainer}>
        {priceLoading && ethPrice === null ? (
          <View style={styles.priceLoadingContainer}>
            <Skeleton width={110} height={14} borderRadius={4} />
            <Skeleton width={80} height={14} borderRadius={4} />
          </View>
        ) : (
          <>
            <Text style={styles.usdValue}>
              ≈ {formatFiatValue(parseFloat(amount || '0') * (ethPrice ?? FALLBACK_ETH_PRICE) * fiatRate, nativeCurrency || 'USD')}
            </Text>
            {lastUpdated && (
              <Text style={styles.priceUpdated}>
                @ {formatFiatValue((ethPrice ?? FALLBACK_ETH_PRICE) * fiatRate, nativeCurrency || 'USD')}/{token}
                {' • '}
                {formatLastUpdated(lastUpdated)}
                {isStale && <Text style={styles.staleWarning}> (cached)</Text>}
              </Text>
            )}
            {priceError && (
              <Text style={styles.priceErrorText}>Live price unavailable. Using fallback value.</Text>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  amountSection: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 16,
  },
  amountLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 16,
    letterSpacing: 2,
  },
  amountDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  amountValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 48,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  amountToken: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 24,
    color: colors.accent,
    fontWeight: '600',
  },
  usdValueContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  usdValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  priceUpdated: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textTertiary,
  },
  staleWarning: {
    color: colors.warning,
  },
  priceErrorText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.warning,
    marginTop: 4,
  },
  priceLoadingContainer: {
    alignItems: 'center',
    gap: 8,
  },
});
