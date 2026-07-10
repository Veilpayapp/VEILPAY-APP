import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { PressableOpacity } from '../PressableOpacity';
import { SovereignCard } from '../SovereignCard';
import { Icon, type IconName } from '../Icon';
import { useTheme, useStyles, typography, type Colors } from '../../styles/design-tokens';
import type { ChainConfig } from '../../stores/walletStore';

function getQuickActionAccessibility(label: string) {
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
    case 'SHIELD':
      return {
        label: 'Shield into private pool',
        hint: 'Deposit public funds into the privacy pool',
      };
    case 'TRANSFER':
      return {
        label: 'Private transfer',
        hint: 'Send privately inside the privacy pool',
      };
    case 'UNSHIELD':
      return {
        label: 'Unshield to public',
        hint: 'Withdraw from the privacy pool to a public address',
      };
    case 'PUBLIC':
      return {
        label: 'Back to public balance',
        hint: 'Leaves private balance mode on the home screen',
      };
    default:
      return {
        label,
        hint: `Opens ${label.toLowerCase()} action`,
      };
  }
}

type ActionDef = {
  label: string;
  iconName: IconName;
  handler: () => void;
  prominent?: boolean;
};

interface DashboardQuickActionsProps {
  activeChain: ChainConfig | null;
  onSend: () => void;
  onReceive: () => void;
  onScan: () => void;
  onSwap: () => void;
  onFaucet?: () => void;
  /** Privacy-pool home mode (SPP Private XLM, etc.). */
  privacyMode?: boolean;
  onShield?: () => void;
  onPrivateTransfer?: () => void;
  onUnshield?: () => void;
  onExitPrivacy?: () => void;
}

export function DashboardQuickActions({
  activeChain,
  onSend,
  onReceive,
  onScan,
  onSwap,
  onFaucet,
  privacyMode = false,
  onShield,
  onPrivateTransfer,
  onUnshield,
  onExitPrivacy,
}: DashboardQuickActionsProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  const actions: ActionDef[] = privacyMode
    ? [
        { label: 'SHIELD', iconName: 'private-lock', handler: onShield || onSend },
        { label: 'TRANSFER', iconName: 'send', handler: onPrivateTransfer || onSend },
        { label: 'SCAN', iconName: 'scan', handler: onScan, prominent: true },
        { label: 'UNSHIELD', iconName: 'export', handler: onUnshield || onReceive },
        ...(onExitPrivacy
          ? [{ label: 'PUBLIC', iconName: 'globe' as const, handler: onExitPrivacy }]
          : [{ label: 'RECEIVE', iconName: 'receive' as const, handler: onReceive }]),
      ]
    : [
        { label: 'SEND', iconName: 'send', handler: onSend },
        ...(activeChain?.isTestnet && onFaucet
          ? [{ label: 'FAUCET', iconName: 'water' as const, handler: onFaucet }]
          : []),
        { label: 'SCAN', iconName: 'scan', handler: onScan, prominent: true },
        ...(!activeChain?.isTestnet
          ? [{ label: 'SWAP', iconName: 'arrow-right' as const, handler: onSwap }]
          : []),
        { label: 'RECEIVE', iconName: 'receive', handler: onReceive },
      ];

  return (
    <View
      style={styles.actionRow}
      accessibilityRole="toolbar"
      accessibilityLabel={privacyMode ? 'Private pool quick actions' : 'Quick actions'}
    >
      {actions.map(({ label, iconName, handler, prominent }, index) => (
        <Animated.View
          key={`${privacyMode ? 'p' : 'g'}-${label}`}
          entering={FadeIn.delay(index * 40).duration(200)}
          exiting={FadeOut.duration(120)}
          layout={LinearTransition.duration(220)}
        >
          <PressableOpacity
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
          </PressableOpacity>
        </Animated.View>
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
    marginTop: -8,
  },
  actionIconBlock: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBlockProminent: {
    width: 64,
    height: 64,
  },
  actionLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 0.5,
    fontWeight: 'bold',
  },
  actionLabelProminent: {
    color: colors.accent,
  },
});
