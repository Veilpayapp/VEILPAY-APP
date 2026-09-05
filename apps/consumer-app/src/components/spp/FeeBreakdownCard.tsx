/**
 * Veilpay Fee Breakdown Card
 *
 * Collapsible fee card for the confirm screen. Shows only the total fee (or
 * "YOU SEND" + amount for token sends) by default, with a chevron indicating
 * expandability. Tapping reveals the full breakdown (network fee, ZK prove
 * time, Soroban fee notes).
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { PressableOpacity } from '../PressableOpacity';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import { Icon } from '../Icon';
import { triggerLightImpactHaptic } from '../../utils/haptics';

export interface FeeBreakdownProps {
  networkFee: string | null;
  feeSymbol: string;
  sppTxCount: number;
  sppOp: 'shield' | 'transfer' | 'unshield';
  privacyLevel: string;
  hasFee: boolean;
  isFeeCeiling: boolean;
  totalFee: string;
  privacyFee?: string;
  isNativeSend: boolean;
  nativeTotal: string | null;
  amount: string;
  token: string;
}

export function FeeBreakdownCard({
  networkFee,
  feeSymbol,
  sppTxCount,
  sppOp,
  privacyLevel,
  hasFee,
  isFeeCeiling,
  totalFee,
  privacyFee,
  isNativeSend,
  nativeTotal,
  amount,
  token,
}: FeeBreakdownProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [expanded, setExpanded] = useState(false);
  const animValue = useRef(new Animated.Value(0)).current;

  const handleToggle = () => {
    void triggerLightImpactHaptic();
    setExpanded((prev) => !prev);
  };

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [expanded, animValue]);

  return (
    <PressableOpacity
      onPress={handleToggle}
      accessibilityRole="button"
      accessibilityLabel="Fee breakdown"
      accessibilityHint={
        expanded ? 'Collapses the fee breakdown' : 'Expands the fee breakdown'
      }
      accessibilityState={{ expanded }}
      activeOpacity={0.9}
    >
      <View style={styles.feeContent}>
        {/* Collapsed summary row — always visible. */}
        {isNativeSend ? (
          <View style={styles.feeRow}>
            <Text style={styles.feeLabelTotal}>TOTAL</Text>
            <View style={styles.feeTotalRight}>
              <Text style={styles.feeValueTotal}>
                {hasFee
                  ? `${nativeTotal} ${feeSymbol}`
                  : `${amount || '0'} ${feeSymbol} + fee`}
              </Text>
              <Icon
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.accent}
              />
            </View>
          </View>
        ) : (
          <View style={styles.feeRow}>
            <Text style={styles.feeLabelTotal}>YOU SEND</Text>
            <View style={styles.feeTotalRight}>
              <Text style={styles.feeValueTotal}>{amount} {token}</Text>
              <Icon
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.accent}
              />
            </View>
          </View>
        )}

        {/* Expanded breakdown. */}
        {expanded && (
          <>
            <View style={styles.feeDivider} />

            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>
                {isFeeCeiling ? 'Network fee (max)' : 'Network fee (estimated)'}
              </Text>
              <Text style={styles.feeValue}>
                {!hasFee
                  ? '—'
                  : isFeeCeiling
                    ? `up to ~${networkFee} ${feeSymbol}`
                    : `${networkFee} ${feeSymbol}`}
              </Text>
            </View>

            {!hasFee && (
              <Text style={styles.feeNote}>
                Fee unavailable right now. The exact amount is set when the
                transaction is signed.
              </Text>
            )}

            {isFeeCeiling && (
              <Text style={styles.feeNote}>
                {sppOp === 'shield'
                  ? `Soroban fee for ${sppTxCount} pool transaction${sppTxCount === 1 ? '' : 's'}. Charged from your public ${feeSymbol}. Exact amount is set when the proof is simulated.`
                  : sppOp === 'unshield'
                    ? `Soroban fee for ${sppTxCount} pool transaction${sppTxCount === 1 ? '' : 's'}. Charged from your public ${feeSymbol}; the amount you receive is not reduced.`
                    : `Soroban fee for ${sppTxCount} pool transaction${sppTxCount === 1 ? '' : 's'}. Charged from your public ${feeSymbol}, not your private balance.`}
              </Text>
            )}

            {privacyLevel === 'max' && (
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Privacy Pool Fee</Text>
                <Text style={styles.feeValue}>{privacyFee} {feeSymbol}</Text>
              </View>
            )}
            {privacyLevel === 'private' && (
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>ZK prove (est.)</Text>
                <Text style={styles.feeValue}>~10s · local</Text>
              </View>
            )}

            {/* Token sends always show the separate native fee row. */}
            {!isNativeSend && (
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Network fee, paid separately</Text>
                <Text style={styles.feeValue}>
                  {hasFee ? `${totalFee} ${feeSymbol}` : `— ${feeSymbol}`}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </PressableOpacity>
  );
}

const themeStyles = (colors: Colors) =>
  StyleSheet.create({
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
    feeNote: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 11,
      lineHeight: 15,
      color: colors.textMuted,
      marginTop: 6,
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
    feeTotalRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
  });
