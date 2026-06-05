import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import { SovereignCard } from '../SovereignCard';
import { Icon } from '../Icon';
import { Logo } from '../Logo';

interface PaymentDetailsCardProps {
  address: string | null;
  recipient: string;
  selectedNetwork: any;
  privacyLevel: string;
  memo: string;
}

const formatAddress = (addr: string) => {
  if (!addr) return 'Not available';
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
};

export function PaymentDetailsCard({ address, recipient, selectedNetwork, privacyLevel, memo }: PaymentDetailsCardProps) {
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

const themeStyles = (colors: Colors) => StyleSheet.create({
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textTertiary,
    marginBottom: 12,
    letterSpacing: 1,
  },
  detailsContent: {
    padding: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLeft: {
    flex: 1,
  },
  detailLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 4,
    letterSpacing: 1,
  },
  detailValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 0,
    gap: 6,
  },
  privacyBadgeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
