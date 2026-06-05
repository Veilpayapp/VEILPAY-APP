import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import { SovereignCard } from '../SovereignCard';
import { Icon } from '../Icon';
import type { TransactionResult } from '../../utils/transactions';

type UiTxStatus = 'idle' | 'sending' | 'pending' | 'confirmed' | 'failed';

interface PaymentStatusCardProps {
  txStatus: UiTxStatus;
  txResult: TransactionResult | null;
  isProving: boolean;
  onViewOnExplorer: () => void;
}

const formatAddress = (addr: string) => {
  if (!addr) return 'Not available';
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
};

export function PaymentStatusCard({ txStatus, txResult, isProving, onViewOnExplorer }: PaymentStatusCardProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  if (txStatus === 'idle') return null;

  const getStatusInfo = () => {
    if (isProving) {
      return { text: 'GENERATING ZK PROOF...', color: colors.accent };
    }
    switch (txStatus) {
      case 'sending':
        return { text: 'SIGNING TRANSACTION...', color: colors.accent };
      case 'pending':
        return { text: 'AWAITING CONFIRMATION...', color: colors.accent };
      case 'confirmed':
        return { text: 'PAYMENT SENT', color: colors.successMuted };
      case 'failed':
        return { text: 'TRANSACTION FAILED', color: colors.error };
      default:
        return { text: 'CONFIRM & SEND', color: colors.textPrimary };
    }
  };

  const statusInfo = getStatusInfo();
  const backgroundColor = txStatus === 'confirmed' ? colors.successMuted : txStatus === 'failed' ? colors.error : colors.bgTertiary;
  const iconName = txStatus === 'confirmed' ? 'success' : txStatus === 'failed' ? 'error' : 'hourglass';
  const iconColor = txStatus === 'pending' || txStatus === 'sending' ? colors.accent : colors.textPrimary;

  return (
    <SovereignCard backgroundColor={backgroundColor} padding={0} style={{ marginBottom: 24 }}>
      <View style={styles.statusContent}>
        {(txStatus === 'sending' || txStatus === 'pending' || isProving) && (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginBottom: 12 }} />
        )}
        <Icon name={iconName} size={44} color={iconColor} style={styles.statusIcon} />
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

const themeStyles = (colors: Colors) => StyleSheet.create({
  statusContent: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIcon: {
    marginBottom: 16,
  },
  statusTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 1,
    textAlign: 'center',
  },
  explorerButton: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 0,
    alignItems: 'center',
    width: '100%',
  },
  statusHash: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  explorerLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewExplorer: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.accent,
    fontWeight: '600',
  },
  viewExplorerIcon: {
    marginTop: 1,
  },
  blockInfo: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 12,
  },
  errorText: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.bgPrimary,
    marginTop: 16,
    textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 12,
    borderRadius: 0,
  },
});
