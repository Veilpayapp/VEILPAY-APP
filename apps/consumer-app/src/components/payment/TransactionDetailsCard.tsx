import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, useStyles, typography } from '../../styles/design-tokens';
import { SovereignCard } from '../SovereignCard';
import { Logo } from '../Logo';
import { Icon } from '../Icon';

interface TransactionDetailsCardProps {
  address: string | null;
  recipient: string;
  selectedNetwork: { name: string } | null;
  privacyLevel: 'standard' | 'max';
  memo?: string;
}

const formatAddress = (val: string) => {
  if (!val) return '0x...';
  if (val.length < 10) return val;
  return `${val.slice(0, 6)}...${val.slice(-4)}`;
};

export function TransactionDetailsCard({
  address,
  recipient,
  selectedNetwork,
  privacyLevel,
  memo,
}: TransactionDetailsCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  return (
    <>
      <Text style={styles.sectionTitle}>TRANSACTION DETAILS</Text>
      <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
        <View style={styles.detailsContent}>
          <View style={styles.detailRow}>
            <View style={styles.detailLeft}>
              <Text style={styles.detailLabel}>FROM</Text>
              <Text style={styles.detailValue}>{formatAddress(address || '')}</Text>
            </View>
            <Logo variant="icon" size="small" />
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <View style={styles.detailLeft}>
              <Text style={styles.detailLabel}>TO</Text>
              <Text style={styles.detailValue}>{formatAddress(recipient)}</Text>
            </View>
            <Icon name="receive" size={20} color={colors.accent} />
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>NETWORK</Text>
            <Text style={styles.detailValue}>{selectedNetwork?.name || 'Unknown Network'}</Text>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>PRIVACY LEVEL</Text>
            <View style={styles.privacyBadge}>
              <Icon name={privacyLevel === 'max' ? 'private-lock' : 'shield'} size={16} color={colors.accent} />
              <Text style={styles.privacyBadgeText}>
                {privacyLevel === 'max' ? 'MAX' : 'STANDARD'}
              </Text>
            </View>
          </View>

          {memo && (
            <>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>MEMO</Text>
                <Text style={styles.detailValue}>{memo}</Text>
              </View>
            </>
          )}
        </View>
      </SovereignCard>
    </>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 12,
  },
  detailsContent: {
    padding: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLeft: {
    gap: 4,
  },
  detailLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
    letterSpacing: 1,
  },
  detailValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  detailDivider: {
    height: 1,
    backgroundColor: colors.outlineSubtle,
    marginVertical: 16,
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentContainer,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0,
    gap: 6,
  },
  privacyBadgeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
  },
});
