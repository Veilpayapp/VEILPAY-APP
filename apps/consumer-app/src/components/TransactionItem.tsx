import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useTheme, useStyles, typography, type Colors } from '../styles/design-tokens';
import { SovereignCard } from './SovereignCard';
import { Icon } from './Icon';
import type { TransactionRecord } from '../types/transactions';

interface TransactionItemProps {
  item: TransactionRecord;
  onPress: (transaction: TransactionRecord) => void;
}

// Format timestamp to readable string
const formatTime = (timestamp: number) => {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
};

const formatAddress = (value: string) => {
  if (!value) {
    return '0x...';
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

function TransactionItemComponent({ item, onPress }: TransactionItemProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  const isSent = item.type === 'sent';
  const amountColor = isSent ? colors.error : colors.success;
  const amountPrefix = isSent ? '-' : '+';
  
  // Logic to handle counterparty address for HomeDashboard variant (optional)
  const isReceived = item.type === 'received';
  const counterparty = isReceived ? item.from : item.to;

  const renderRightActions = () => {
    return (
      <TouchableOpacity 
        style={[styles.quickAction, { backgroundColor: colors.accent }]} 
        onPress={() => onPress(item)}
      >
        <Icon name="arrow-right" size={24} color={colors.bgPrimary} />
      </TouchableOpacity>
    );
  };

  return (
    <TouchableOpacity
      style={styles.transactionItem}
      onPress={() => onPress(item)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${isSent ? 'Sent' : 'Received'} ${item.amount} ${item.tokenSymbol}, ${item.status}`}
      accessibilityHint="Opens transaction details"
    >
      <Swipeable renderRightActions={renderRightActions} containerStyle={styles.swipeableContainer}>
        <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ borderRadius: 0 }}>
          <View style={styles.transactionContent}>
            {/* Left side - Type icon and info */}
            <View style={styles.transactionLeft}>
              <Animated.View 
                sharedTransitionTag={`txIcon-${item.id}`}
                style={[styles.typeIcon, { backgroundColor: isSent ? colors.errorBg : colors.successBg }]}
              >
                <Icon name={isSent ? 'send' : 'receive'} size={16} color={colors.textPrimary} />
              </Animated.View>
              <View style={styles.transactionInfo}>
              <Text style={styles.transactionType}>
                {counterparty ? formatAddress(counterparty) : (isSent ? 'SENT' : 'RECEIVED')}
              </Text>
              <Text style={styles.transactionTime}>{formatTime(item.timestamp)}</Text>
            </View>
          </View>

          {/* Right side - Amount */}
          <View style={styles.transactionRight}>
            <Animated.Text 
              sharedTransitionTag={`txAmount-${item.id}`}
              style={[styles.transactionAmount, { color: amountColor }]}
            >
              {amountPrefix}{item.amount} {item.tokenSymbol}
            </Animated.Text>
            <View style={styles.statusRow}>
              {item.status === 'pending' && (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingText}>Pending</Text>
                </View>
              )}
              {item.privacyLevel === 'max' && (
                <View style={styles.privacyBadge}>
                  <Icon name="private" size={12} color={colors.accent} />
                  <Text style={styles.privacyText}>Private</Text>
                </View>
              )}
            </View>
          </View>
          </View>
        </SovereignCard>
      </Swipeable>
    </TouchableOpacity>
  );
}

// React.memo to prevent unnecessary re-renders in FlashList / ScrollView
export const TransactionItem = memo(TransactionItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.status === nextProps.item.status &&
    prevProps.item.timestamp === nextProps.item.timestamp
  );
});

const themeStyles = (colors: Colors) => StyleSheet.create({
  transactionItem: {
    marginBottom: 12,
  },
  transactionContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  transactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionType: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  transactionTime: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pendingBadge: {
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  pendingText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.accent,
    fontWeight: '600',
  },
  privacyBadge: {
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  privacyText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  swipeableContainer: {
    borderRadius: 0,
    overflow: 'hidden',
  },
  quickAction: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
});
