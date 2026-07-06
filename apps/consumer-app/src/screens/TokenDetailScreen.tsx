import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { SCREENS } from '../constants/screens';
import { typography, useTheme, useStyles, type Colors } from '../styles/design-tokens';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { SovereignButton } from '../components/SovereignButton';
import { TransactionItem } from '../components/TransactionItem';
import { useWalletStore, SUPPORTED_CHAINS } from '../stores/walletStore';
import { useTransactionStore } from '../stores/transactionStore';
import { useBalance } from '../hooks/useBalance';
import type { TransactionRecord } from '../types/transactions';

type Props = NativeStackScreenProps<RootStackParamList, typeof SCREENS.TOKEN_DETAIL>;

export function TokenDetailScreen({ route, navigation }: Props) {
  const { tokenSymbol, chainKey } = route.params;
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);

  const { activeChain } = useWalletStore();
  const { nativeBalance, tokenBalances } = useBalance();
  const transactions = useTransactionStore((state) => state.transactions);

  // Compute balance
  const balance = useMemo(() => {
    if (nativeBalance && nativeBalance.symbol === tokenSymbol) {
      return nativeBalance.balanceFormatted;
    }
    const token = tokenBalances?.find(t => t.symbol === tokenSymbol);
    return token ? token.balanceFormatted || token.balance : '0.00';
  }, [nativeBalance, tokenBalances, tokenSymbol]);

  const tokenTransactions = useMemo(() => {
    return transactions
      .filter((tx) => tx.tokenSymbol === tokenSymbol && (tx.network === chainKey || tx.network === activeChain?.key))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [transactions, tokenSymbol, chainKey, activeChain]);

  const handleSend = () => {
    navigation.navigate(SCREENS.SEND_PAYMENT, { amount: '' });
  };

  const handleReceive = () => {
    navigation.navigate(SCREENS.RECEIVE_QR);
  };

  const handleTransactionPress = useCallback((transaction: TransactionRecord) => {
    navigation.navigate(SCREENS.TRANSACTION_DETAILS, { transaction });
  }, [navigation]);

  const renderTransaction = useCallback(
    ({ item }: { item: TransactionRecord }) => (
      <TransactionItem item={item} onPress={handleTransactionPress} />
    ),
    [handleTransactionPress]
  );

  const chain = SUPPORTED_CHAINS.find(c => c.key === chainKey);
  const env = chain?.isTestnet ? 'TESTNET' : 'MAINNET';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>[ {tokenSymbol.toUpperCase()} • {env} ]</Text>
        <View style={{ width: 80 }} />
      </View>

      <View style={styles.balanceSection}>
        <Text style={styles.balanceLabel}>CURRENT BALANCE</Text>
        <Text style={styles.balanceAmount}>{balance} {tokenSymbol}</Text>
      </View>

      <View style={styles.actionRow}>
        <SovereignButton title="SEND" onPress={handleSend} variant="primary" style={styles.actionButton} />
        <SovereignButton title="RECEIVE" onPress={handleReceive} variant="secondary" style={styles.actionButton} />
      </View>

      <View style={styles.historyContainer}>
        <Text style={styles.historyTitle}>[ TRANSACTION HISTORY ]</Text>
        <FlatList
          data={tokenTransactions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={renderTransaction}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>NO TRANSACTIONS FOUND FOR {tokenSymbol}</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    height: 64,
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  balanceSection: {
    alignItems: 'center',
    paddingVertical: 32,
    borderBottomWidth: 1,
    borderBottomColor: colors.textPrimary,
  },
  balanceLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.small,
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  balanceAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 32,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  actionRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.textPrimary,
  },
  actionButton: {
    flex: 1,
  },
  historyContainer: {
    flex: 1,
  },
  historyTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.small,
    color: colors.textSecondary,
    letterSpacing: 1,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.textPrimary,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.textPrimary,
    marginTop: 16,
  },
  emptyText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.small,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
