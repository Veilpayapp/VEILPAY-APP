import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../../styles/design-tokens';
import { SovereignButton } from '../SovereignButton';

interface PaymentActionButtonsProps {
  txStatus: 'idle' | 'sending' | 'pending' | 'confirmed' | 'failed';
  isWalletVerificationPending: boolean;
  isSendDisabled: boolean;
  handleConfirmSend: () => void;
  handleViewOnExplorer: () => void;
  handleGoHome: () => void;
  statusInfo: { text: string; color?: string; [key: string]: any };
}

export function PaymentActionButtons({
  txStatus,
  isWalletVerificationPending,
  isSendDisabled,
  handleConfirmSend,
  handleViewOnExplorer,
  handleGoHome,
  statusInfo,
}: PaymentActionButtonsProps) {
  const { colors } = useTheme();

  return (
    <>
      {txStatus === 'idle' && (
        <SovereignButton
          title={isWalletVerificationPending ? 'VERIFYING WALLET...' : 'CONFIRM & SEND'}
          variant={isSendDisabled ? 'outline' : 'primary'}
          onPress={handleConfirmSend}
          disabled={isSendDisabled}
          style={styles.marginBottom}
        />
      )}

      {(txStatus === 'sending' || txStatus === 'pending') && (
        <View style={styles.marginBottom}>
          <SovereignButton
            title={statusInfo.text}
            variant="outline"
            onPress={() => {}}
            disabled={true}
            style={styles.marginBottomSmall}
          />
          <ActivityIndicator size="small" color={colors.accent} style={styles.marginTopSmall} />
        </View>
      )}

      {txStatus === 'confirmed' && (
        <View style={styles.actionGroup}>
          <SovereignButton
            title="VIEW ON EXPLORER"
            variant="primary"
            onPress={handleViewOnExplorer}
          />
          <SovereignButton
            title="BACK TO HOME"
            variant="outline"
            onPress={handleGoHome}
          />
        </View>
      )}

      {txStatus === 'failed' && (
        <View style={styles.actionGroup}>
          <SovereignButton
            title="TRY AGAIN"
            variant="primary"
            onPress={handleConfirmSend}
          />
          <SovereignButton
            title="BACK TO HOME"
            variant="outline"
            onPress={handleGoHome}
          />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  marginBottom: {
    marginBottom: 32,
  },
  marginBottomSmall: {
    marginBottom: 8,
  },
  marginTopSmall: {
    marginTop: 8,
  },
  actionGroup: {
    marginBottom: 32,
    gap: 12,
  },
});
