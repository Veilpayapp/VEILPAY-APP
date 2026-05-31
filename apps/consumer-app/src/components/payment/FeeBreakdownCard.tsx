import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, useStyles, typography } from '../../styles/design-tokens';
import { SovereignCard } from '../SovereignCard';

interface FeeBreakdownCardProps {
  networkFee: string;
  privacyFee: string;
  totalAmount: string;
  token: string;
  privacyLevel: string;
}

export function FeeBreakdownCard({
  networkFee,
  privacyFee,
  totalAmount,
  token,
  privacyLevel,
}: FeeBreakdownCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  return (
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
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  feeContent: {
    padding: 16,
    gap: 12,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feeLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
  },
  feeValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
  },
  feeDivider: {
    height: 1,
    backgroundColor: colors.outlineSubtle,
  },
  feeLabelTotal: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  feeValueTotal: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: 'bold',
  },
});
