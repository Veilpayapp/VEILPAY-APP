import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useTheme, useStyles, typography } from '../../styles/design-tokens';
import { SovereignCard } from '../SovereignCard';
import { Icon } from '../Icon';

export type UiTxStatus = 'idle' | 'stealth_deriving' | 'proving' | 'relaying' | 'sending' | 'pending' | 'confirmed' | 'failed';

interface TransactionStatusCardProps {
  txStatus: UiTxStatus;
  statusInfo: { text: string; color: string };
  txResult: any;
  onViewOnExplorer: () => void;
  formatAddress: (addr: string) => string;
}

export function TransactionStatusCard({
  txStatus,
  statusInfo,
  txResult,
  onViewOnExplorer,
  formatAddress,
}: TransactionStatusCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  if (txStatus !== 'stealth_deriving' && txStatus !== 'proving' && txStatus !== 'relaying' && txStatus !== 'sending' && txStatus !== 'pending' && txStatus !== 'confirmed' && txStatus !== 'failed') {
    return null;
  }

  return (
    <SovereignCard
      backgroundColor={txStatus === 'confirmed' ? colors.successMuted : txStatus === 'failed' ? colors.error : colors.bgTertiary}
      padding={0}
      style={{ marginBottom: 24 }}
    >
      <View style={styles.statusContent}>
        {(txStatus === 'stealth_deriving' || txStatus === 'proving' || txStatus === 'relaying' || txStatus === 'sending' || txStatus === 'pending') && (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginBottom: 12 }} />
        )}
        <Icon
          name={txStatus === 'confirmed' ? 'success' : txStatus === 'failed' ? 'error' : 'hourglass'}
          size={44}
          color={txStatus === 'stealth_deriving' || txStatus === 'proving' || txStatus === 'relaying' || txStatus === 'pending' || txStatus === 'sending' ? colors.accent : colors.textPrimary}
          style={styles.statusIcon}
        />
        <Text style={styles.statusTitle}>{statusInfo.text}</Text>
        {txResult?.hash && (
          <TouchableOpacity
            onPress={onViewOnExplorer}
            style={styles.explorerButton}
            accessibilityRole="button"
            accessibilityLabel="View transaction on explorer"
            accessibilityHint="Opens block explorer for this transaction"
          >
            <Text style={styles.statusHash}>TX: {formatAddress(txResult.hash)}</Text>
            <View style={styles.explorerLinkRow}>
              <Text style={styles.viewExplorer}>View on Explorer</Text>
              <Icon name="chevron-right" size={12} color={colors.accent} style={styles.viewExplorerIcon} />
            </View>
          </TouchableOpacity>
        )}
        {txStatus === 'confirmed' && txResult?.blockNumber && (
          <Text style={styles.blockInfo}>Block: {txResult.blockNumber}</Text>
        )}
        {txStatus === 'failed' && txResult?.error && (
          <Text style={styles.errorText}>{txResult.error}</Text>
        )}
      </View>
    </SovereignCard>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  statusContent: {
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  statusIcon: {
    marginBottom: 4,
  },
  statusTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  statusHash: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    opacity: 0.8,
  },
  viewExplorer: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.accent,
    marginTop: 4,
  },
  explorerButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  explorerLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  viewExplorerIcon: {
    marginLeft: 4,
  },
  blockInfo: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textPrimary,
    opacity: 0.6,
    marginTop: 4,
  },
  errorText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.errorMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});
