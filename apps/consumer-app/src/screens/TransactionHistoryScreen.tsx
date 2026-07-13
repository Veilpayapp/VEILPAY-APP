/* istanbul ignore file */
/**
 * Veilpay Transaction History Screen
 * Displays list of past transactions with filter options
 * Uses the current hybrid structural design language for all interactive elements
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, StatusBar, RefreshControl, ActivityIndicator } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore } from '../stores/transactionStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  getPrivacyAssetById,
  canActivatePrivacyAsset,
} from '../constants/privacyAssets';
import { filterTransactionsForPrivacyMode } from '../utils/transactionPrivacyFilter';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { BottomNavBar } from '../components/BottomNavBar';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { TransactionSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import * as Haptics from 'expo-haptics';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import type { TransactionRecord } from '../types/transactions';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

// Filter options
type FilterOption = 'all' | 'sent' | 'received';

type TransactionHistoryScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'TransactionHistory'>;

interface TransactionHistoryScreenProps {
  navigation: TransactionHistoryScreenNavigationProp;
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

interface FilterButtonProps {
  label: string;
  value: FilterOption;
  activeFilter: FilterOption;
  styles: any;
  onSelect: (value: FilterOption) => void;
}

function FilterButton({ label, value, activeFilter, styles, onSelect }: FilterButtonProps) {
  const isActive = activeFilter === value;
  return (
    <PressableOpacity
      style={[styles.filterButton, isActive && styles.filterButtonActive]}
      onPress={() => onSelect(value)}
      accessibilityRole="tab"
      accessibilityLabel={`${label} transactions`}
      accessibilityHint="Filters the transaction list"
      accessibilityState={{ selected: isActive }}
    >
      <Text style={[styles.filterButtonText, isActive && styles.filterButtonTextActive]}>
        {label}
      </Text>
    </PressableOpacity>
  );
}

export function TransactionHistoryScreen({ navigation }: TransactionHistoryScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [refreshing, setRefreshing] = useState(false);
  const {
    activeChain,
    address,
  } = useWalletStore();
  const {
    transactions,
    hasMoreTransactions,
    isLoadingTransactions,
    transactionsError,
    refreshTransactions,
    loadMoreTransactions,
  } = useTransactionStore();
  const selectedPrivacyAssetId = useSettingsStore((s) => s.selectedPrivacyAssetId);
  const privacyAsset = getPrivacyAssetById(selectedPrivacyAssetId);
  const privacyMode = !!privacyAsset && canActivatePrivacyAsset(privacyAsset);
  const toast = useToast();

  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.TRANSACTION_HISTORY_VIEWED, {
      chain_key: activeChain?.key || 'unknown',
      has_address: Boolean(address),
      total_transactions: transactions.length,
    });
  }, [activeChain?.key, address, transactions.length]);

  useEffect(() => {
    if (!address || !activeChain) {
      return;
    }

    refreshTransactions();
  }, [address, activeChain, refreshTransactions]);

  useEffect(() => {
    if (!transactionsError) {
      return;
    }

    toast.show(transactionsError, 'error');
  }, [transactionsError, toast.show]);

  // Privacy mode first (private pool only), then sent/received chips.
  const filteredTransactions = useMemo(() => {
    const privacyScoped = filterTransactionsForPrivacyMode(transactions, {
      privacyMode,
      privacyChainKey: privacyAsset?.chainKey ?? activeChain?.key,
      publicChainKey: activeChain?.key,
    });
    if (filter === 'all') return privacyScoped;
    return privacyScoped.filter(
      (tx: import('../types/transactions').TransactionRecord) => tx.type === filter
    );
  }, [
    activeChain?.key,
    filter,
    privacyAsset?.chainKey,
    privacyMode,
    transactions,
  ]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRefreshing(true);
    trackEvent(ANALYTICS_EVENTS.TRANSACTION_HISTORY_REFRESH_REQUESTED, {
      chain_key: activeChain?.key || 'unknown',
      filter,
    });

    try {
      await refreshTransactions();
      toast.show('Transactions updated', 'success');
      trackEvent(ANALYTICS_EVENTS.TRANSACTION_HISTORY_REFRESH_COMPLETED, {
        chain_key: activeChain?.key || 'unknown',
        filter,
      });
    } catch {
      trackEvent(ANALYTICS_EVENTS.TRANSACTION_HISTORY_REFRESH_FAILED, {
        chain_key: activeChain?.key || 'unknown',
        filter,
      });
    } finally {
      setRefreshing(false);
    }
  }, [activeChain?.key, filter, refreshTransactions, toast]);

  const handleEndReached = useCallback(() => {
    if (isLoadingTransactions || !hasMoreTransactions) {
      return;
    }

    trackEvent(ANALYTICS_EVENTS.TRANSACTION_HISTORY_LOAD_MORE_REQUESTED, {
      chain_key: activeChain?.key || 'unknown',
      filter,
    });

    loadMoreTransactions();
  }, [activeChain?.key, filter, hasMoreTransactions, isLoadingTransactions, loadMoreTransactions]);

  // Handle transaction press
  const handleTransactionPress = useCallback((transaction: TransactionRecord) => {
    trackEvent(ANALYTICS_EVENTS.TRANSACTION_DETAILS_OPENED_FROM_HISTORY, {
      transaction_type: transaction.type,
      transaction_status: transaction.status,
      token_symbol: transaction.tokenSymbol,
      privacy_level: transaction.privacyLevel || 'standard',
    });

    navigation.navigate(SCREENS.TRANSACTION_DETAILS, { transaction });
  }, [navigation]);
  
  const handleNavPress = (screen: keyof RootStackParamList) => {
    // If it's a tab, navigate to it. History is not a tab but reached from Home.
    // However, if we are in History, we should allow navigating back to main tabs.
    navigation.navigate(screen as never);
  };

  const handleFilterSelect = useCallback((value: FilterOption) => {
    Haptics.selectionAsync().catch(() => {});
    setFilter(value);
    trackEvent(ANALYTICS_EVENTS.TRANSACTION_HISTORY_FILTER_CHANGED, {
      filter: value,
    });
  }, []);

  // Render transaction item
  const renderTransaction = useCallback(({ item }: { item: any }) => {
    const isSent = item.type === 'sent';
    const amountColor = isSent ? colors.error : colors.success;
    const amountPrefix = isSent ? '-' : '+';
    const isPrivate = item.privacyLevel === 'max' || item.privacyLevel === 'private';
    const isPrivatePoolTx = item.isPrivatePoolTx === true || item.sppOp !== undefined;
    const title = item.displayTitle || (isSent ? 'Sent' : 'Received');
    const subtitle = item.displaySubtitle || formatTime(item.timestamp);

    return (
      <PressableOpacity
        style={styles.transactionItem}
        onPress={() => handleTransactionPress(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${isSent ? 'Sent' : 'Received'} ${item.amount} ${item.tokenSymbol}, ${item.status}`}
        accessibilityHint="Opens transaction details"
      >
          <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ borderRadius: 0 }}>
          <View style={styles.transactionContent}>
            {/* Left side - Type icon and info */}
            <View style={styles.transactionLeft}>
          <View style={[styles.typeIcon, { backgroundColor: isSent ? colors.errorBg : colors.successBg }]}>
          <Icon name={isPrivatePoolTx ? 'private-lock' : isSent ? 'send' : 'receive'} size={16} color={colors.textPrimary} />
              </View>
              <View style={styles.transactionInfo}>
                <Text style={styles.transactionType}>{title}</Text>
                <Text style={styles.transactionTime}>{subtitle}</Text>
              </View>
            </View>

            {/* Right side - Amount */}
            <View style={styles.transactionRight}>
              <Text style={[styles.transactionAmount, { color: amountColor }]}>
                {amountPrefix}{item.amount} {item.tokenSymbol}
              </Text>
              <View style={styles.statusRow}>
                {item.status === 'pending' && (
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingText}>Pending</Text>
                  </View>
                )}
                {isPrivate && (
                  <View style={styles.privacyBadge}>
                    <Icon name="private" size={12} color={colors.accent} />
                    <Text style={styles.privacyText}>Private</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </SovereignCard>
      </PressableOpacity>
    );
  }, [colors, styles, handleTransactionPress]);

  // Render empty state
  const renderEmpty = () => {
    if (isLoadingTransactions) {
      return (
        <View style={styles.skeletonContainer}>
          {Array.from({ length: 5 }).map((_, index) => (
            <TransactionSkeleton key={`tx-skeleton-${index}`} />
          ))}
        </View>
      );
    }

    if (transactionsError) {
      return (
        <ErrorState
          title="Could not load history"
          description={transactionsError}
          actionLabel="Try again"
          onAction={handleRefresh}
        />
      );
    }

    return (
      <EmptyState
        icon={<Icon name="inbox" size={48} color={colors.textTertiary} />}
        title={privacyMode ? 'No private activity yet' : 'No transactions yet'}
        description={
          privacyMode
            ? filter === 'all'
              ? 'Shield, transfer, or unshield to see clean private activity here.'
              : `No ${filter} private activity for this wallet.`
            : filter === 'all'
              ? 'Payments and on-chain contract calls will appear here.'
              : `No ${filter} transactions found for this wallet.`
        }
        actionLabel={privacyMode ? undefined : 'Send payment'}
        onAction={
          privacyMode
            ? undefined
            : () => {
                trackEvent(ANALYTICS_EVENTS.TRANSACTION_HISTORY_EMPTY_SEND_PAYMENT_PRESSED, {
                  filter,
                });
                navigation.navigate(SCREENS.SEND_PAYMENT, {});
              }
        }
      />
    );
  };

  const renderFooter = () => {
    if (!isLoadingTransactions || filteredTransactions.length === 0) {
      return null;
    }

    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  };

  // Header with filter tabs
  const filterHeader = (
    <View style={styles.filterContainer}>
      <FilterButton label="All" value="all" activeFilter={filter} styles={styles} onSelect={handleFilterSelect} />
      <FilterButton label="Sent" value="sent" activeFilter={filter} styles={styles} onSelect={handleFilterSelect} />
      <FilterButton label="Received" value="received" activeFilter={filter} styles={styles} onSelect={handleFilterSelect} />
    </View>
  );

  const refreshControlEl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor={colors.accent}
        colors={[colors.accent]}
      />
    ),
    [refreshing, handleRefresh, colors.accent]
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      {/* Header */}
      <View style={styles.header}>
        <ScreenBackButton
          onPress={() => {
            trackEvent(ANALYTICS_EVENTS.TRANSACTION_HISTORY_BACK_PRESSED, {
              filter,
            });
            navigation.goBack();
          }}
        />
        <Text style={styles.headerTitle}>TRANSACTION HISTORY</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(260)} style={styles.animatedContent}>
        {/* Filter Tabs */}
        {filterHeader}

        {/* Transaction List */}
        <FlashList
          data={filteredTransactions}
          renderItem={renderTransaction}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={refreshControlEl}
        />
      </Animated.View>

      <BottomNavBar currentScreen={SCREENS.TRANSACTION_HISTORY} onNavigate={handleNavPress} />

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />
    </SafeAreaView>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    height: 64,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  backButtonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: '600',
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  animatedContent: {
    flex: 1,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 12,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    borderRadius: 0,
    backgroundColor: colors.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {
    backgroundColor: colors.accent,
  },
  filterButtonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterButtonTextActive: {
    color: colors.bgPrimary,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 140,
    flexGrow: 1,
  },
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
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  typeIconText: {
    fontSize: 18,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  transactionInfo: {
    flex: 1,
  },
  transactionType: {
    fontFamily: typography.fontFamily.body,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
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
    backgroundColor: colors.accentContainer,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 0,
  },
  pendingText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.accent,
    fontWeight: '600',
  },
  privacyBadge: {
    backgroundColor: colors.accentContainer,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 0,
  },
  privacyText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: typography.fontFamily.headline,
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  skeletonContainer: {
    paddingTop: 8,
    paddingBottom: 24,
    gap: 6,
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
