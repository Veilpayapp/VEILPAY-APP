import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PressableOpacity } from '../PressableOpacity';
import { MotiView } from 'moti';
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
        <Text style={styles.sectionTitle}>[ ACTIVITY_LOG ]</Text>
        <PressableOpacity
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel="See all transactions"
          accessibilityHint="Opens full transaction history"
        >
          <Text style={styles.seeAll}>[ ALL ]</Text>
        </PressableOpacity>
      </View>

      {isLoading && transactions.length === 0 ? (
        <View style={styles.transactionSkeletonList}>
          {Array.from({ length: 3 }).map((_, index) => (
            <MotiView
              key={`home-tx-skeleton-${index}`}
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{
                type: 'timing',
                duration: 300,
                delay: index * 100,
              }}
            >
              <TransactionSkeleton />
            </MotiView>
          ))}
        </View>
      ) : transactions.length === 0 ? (
        <View style={styles.emptyLedger}>
          <Text style={styles.emptyLedgerArt}>[ / / / / / / / / ]</Text>
          <Text style={styles.emptyLedgerTitle}>NO TX DATA</Text>
          <Text style={styles.emptyLedgerSub}>AWAITING_STATE_CHANGE...</Text>
        </View>
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
  emptyLedger: {
    marginHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
    marginTop: 8,
  },
  emptyLedgerArt: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 24,
    color: colors.outlineVariant,
    letterSpacing: 4,
    marginBottom: 16,
  },
  emptyLedgerTitle: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 4,
  },
  emptyLedgerSub: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 1,
  },
});
