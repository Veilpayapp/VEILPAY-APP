import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme, useStyles, typography } from '../../styles/design-tokens';
import { TransactionItem } from '../TransactionItem';
import { TransactionSkeleton } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { Icon } from '../Icon';
import type { TransactionRecord } from '../../types/transactions';

interface RecentTransactionsListProps {
  isLoading: boolean;
  transactions: TransactionRecord[];
  onSeeAll: () => void;
  onTransactionPress: (tx: TransactionRecord) => void;
  onSend: () => void;
}

function RecentTransactionsListComponent({
  isLoading,
  transactions,
  onSeeAll,
  onTransactionPress,
  onSend,
}: RecentTransactionsListProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>
        <TouchableOpacity
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel="See all transactions"
          accessibilityHint="Opens full transaction history"
        >
          <Text style={styles.seeAll}>See all</Text>
        </TouchableOpacity>
      </View>

      {isLoading && transactions.length === 0 ? (
        <View style={styles.transactionSkeletonList}>
          {Array.from({ length: 3 }).map((_, index) => (
            <TransactionSkeleton key={`home-tx-skeleton-${index}`} />
          ))}
        </View>
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={<Icon name="inbox" size={48} color={colors.textTertiary} />}
          title="No transactions yet"
          description="Your activity will appear here once you send or receive funds."
          actionLabel="Send payment"
          onAction={onSend}
        />
      ) : (
        transactions.slice(0, 5).map((tx) => (
          <View key={tx.id} style={styles.transactionItemWrapper}>
            <TransactionItem 
              item={tx} 
              onPress={onTransactionPress} 
            />
          </View>
        ))
      )}
    </View>
  );
}

export const RecentTransactionsList = memo(RecentTransactionsListComponent);

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  seeAll: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: "bold",
  },
  transactionSkeletonList: {
    marginHorizontal: 24,
    gap: 8,
    paddingVertical: 8,
  },
  transactionItemWrapper: {
    marginHorizontal: 24,
    marginBottom: 8,
  },
});
