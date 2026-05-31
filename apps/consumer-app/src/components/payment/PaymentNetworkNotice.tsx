import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import { SovereignCard } from '../SovereignCard';
import { Icon } from '../Icon';

interface PaymentNetworkNoticeProps {
  selectedNetwork: any;
  faucetUrl: string | null;
  onGetTestnetETH: () => void;
}

export function PaymentNetworkNotice({ selectedNetwork, faucetUrl, onGetTestnetETH }: PaymentNetworkNoticeProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  return (
    <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
      <View style={styles.testnetNotice}>
        <Icon name="testtube" size={24} color={colors.accent} />
        <View style={styles.testnetNoticeText}>
          <Text style={styles.testnetNoticeTitle}>
            {selectedNetwork?.isTestnet ? 'TESTNET MODE' : 'MAINNET MODE'}
          </Text>
          <Text style={styles.testnetNoticeDesc}>
            This transaction will be sent on {selectedNetwork?.name || 'the selected network'}.
            {selectedNetwork?.isTestnet
              ? ' Get faucet funds when supported.'
              : ' Mainnet sends are enabled via EXPO_PUBLIC_ENABLE_MAINNET_TRANSACTIONS=true.'}
          </Text>
          <TouchableOpacity
            onPress={onGetTestnetETH}
            disabled={!faucetUrl}
            style={styles.faucetButton}
            accessibilityRole="button"
            accessibilityLabel="Get testnet funds"
            accessibilityHint="Opens faucet website to request test funds"
            accessibilityState={{ disabled: !faucetUrl }}
          >
            <View style={styles.faucetLinkRow}>
              <Text style={[styles.faucetLink, !faucetUrl && styles.faucetLinkDisabled]}>
                Get Test ETH
              </Text>
              <Icon
                name="chevron-right"
                size={12}
                color={faucetUrl ? colors.accent : colors.textFaint}
                style={styles.faucetLinkIcon}
              />
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </SovereignCard>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  testnetNotice: {
    flexDirection: 'row',
    padding: 16,
    gap: 16,
  },
  testnetNoticeText: {
    flex: 1,
    gap: 4,
  },
  testnetNoticeTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.accent,
    letterSpacing: 0.5,
  },
  testnetNoticeDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  faucetButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  faucetLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  faucetLink: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
  },
  faucetLinkDisabled: {
    color: colors.textFaint,
  },
  faucetLinkIcon: {
    marginTop: 1,
  },
});
