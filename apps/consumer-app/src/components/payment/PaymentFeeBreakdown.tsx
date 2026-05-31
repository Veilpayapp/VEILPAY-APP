import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import { SovereignCard } from '../SovereignCard';

interface PaymentFeeBreakdownProps {
  networkFee: string;
  privacyFee: string;
  totalAmount: string;
  privacyLevel: string;
  token: string;
}

export function PaymentFeeBreakdown({ networkFee, privacyFee, totalAmount, privacyLevel, token }: PaymentFeeBreakdownProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  return (
    <>
      <Text style={styles.sectionTitle}>FEE BREAKDOWN</Text>
      <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
        <View style={styles.feeContent}>
          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>Network Fee (estimated)</Text>
            <Text style={styles.feeValue}>{networkFee} {token}</Text>
          </View>
          {privacyLevel === 'max' && (
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>Privacy Pool Fee</Text>
              <Text style={styles.feeValue}>{privacyFee} {token}</Text>
            </View>
          )}
          <View style={styles.feeDivider} />
          <View style={styles.feeRow}>
            <Text style={styles.feeLabelTotal}>TOTAL AMOUNT</Text>
            <Text style={styles.feeValueTotal}>{totalAmount} {token}</Text>
          </View>
        </View>
      </SovereignCard>
    </>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textTertiary,
    marginBottom: 12,
    letterSpacing: 1,
  },
  feeContent: {
    padding: 20,
    gap: 16,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feeLabel: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textSecondary,
  },
  feeValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
  },
  feeDivider: {
    height: 1,
    backgroundColor: colors.outlineSubtle,
    marginVertical: 4,
  },
  feeLabelTotal: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  feeValueTotal: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.accent,
  },
});
