import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SovereignCard } from '../SovereignCard';
import { Icon } from '../Icon';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import type { ChainConfig } from '../../stores/walletStore';

interface DashboardQuickActionsProps {
  activeChain: ChainConfig | null;
  onSend: () => void;
  onReceive: () => void;
  onScan: () => void;
  onSwap: () => void;
  onFaucet?: () => void;
}

export function DashboardQuickActions({
  activeChain,
  onSend,
  onReceive,
  onScan,
  onSwap,
  onFaucet,
}: DashboardQuickActionsProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  const getQuickActionAccessibility = (label: string) => {
    switch (label) {
      case 'SCAN':
        return {
          label: 'Scan QR code',
          hint: 'Opens QR scanner to scan a payment QR code',
        };
      case 'SEND':
        return {
          label: 'Send payment',
          hint: 'Opens send payment screen',
        };
      case 'SWAP':
        return {
          label: 'Swap crypto',
          hint: 'Opens a swap experience in your browser',
        };
      case 'FAUCET':
        return {
          label: 'Fund Testnet',
          hint: 'Opens a faucet to get testnet tokens',
        };
      case 'RECEIVE':
        return {
          label: 'Receive payment',
          hint: 'Opens receive QR screen',
        };
      default:
        return {
          label,
          hint: `Opens ${label.toLowerCase()} action`,
        };
    }
  };

  return (
    <View style={styles.actionRow} accessibilityRole="toolbar" accessibilityLabel="Quick actions">
      {[
        { label: 'SEND' as const, iconName: 'send' as const, handler: onSend },
        ...(activeChain?.isTestnet && onFaucet
          ? [{ label: 'FAUCET' as const, iconName: 'water' as const, handler: onFaucet }]
          : []),
        { label: 'SCAN' as const, iconName: 'scan' as const, handler: onScan, prominent: true },
        ...(!activeChain?.isTestnet 
          ? [{ label: 'SWAP' as const, iconName: 'arrow-right' as const, handler: onSwap }] 
          : []),
        { label: 'RECEIVE' as const, iconName: 'receive' as const, handler: onReceive },
      ].map(({ label, iconName, handler, prominent }) => (
        <TouchableOpacity
          key={label}
          onPress={handler}
          activeOpacity={0.9}
          style={prominent ? styles.actionBtnProminent : styles.actionBtn}
          accessibilityRole="button"
          accessibilityLabel={getQuickActionAccessibility(label).label}
          accessibilityHint={getQuickActionAccessibility(label).hint}
        >
          <SovereignCard
            backgroundColor={prominent ? colors.accent : colors.bgSecondary}
            padding={0}
            style={{ borderRadius: 0 }}
          >
            <View style={[styles.actionIconBlock, prominent && styles.actionIconBlockProminent]}>
              <Icon
                name={iconName}
                size={prominent ? 28 : 22}
                color={prominent ? colors.bgPrimary : colors.textPrimary}
              />
            </View>
          </SovereignCard>
          <Text style={[styles.actionLabel, prominent && styles.actionLabelProminent]}>
            {label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 8,
  },
  actionBtnProminent: {
    alignItems: 'center',
    gap: 8,
    marginTop: -16,
  },
  actionIconBlock: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  actionIconBlockProminent: {
    width: 64,
    height: 64,
  },
  actionLabel: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 1,
    fontWeight: '700',
  },
  actionLabelProminent: {
    color: colors.accent,
    fontWeight: 'bold',
  },
});
