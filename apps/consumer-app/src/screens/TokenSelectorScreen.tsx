/**
 * Veilpay Token Selector Screen
 * Allows users to search and select chain-compatible tokens.
 * 
 * UPDATED: Now uses dynamic token data from walletStore
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import { SUPPORTED_CHAINS, useWalletStore } from '../stores/walletStore';
import { TokenSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { useTokenBalances } from '../hooks/useBalance';
import { useMarketData } from '../hooks/useMarketData';
import { useSettingsStore } from '../stores/settingsStore';
import { formatFiatValue, getFiatExchangeRate } from '../utils/priceFeed';
import type { PaymentToken } from '../types/tokens';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import Animated, { FadeInDown } from 'react-native-reanimated';

// Properly typed props
type TokenSelectorScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TokenSelector'>;
  route: RouteProp<RootStackParamList, 'TokenSelector'>;
};

// Token metadata (static data - balances come from API)
const TOKEN_METADATA: Omit<PaymentToken, 'balance' | 'usdPrice'>[] = [
  {
    id: 'eth',
    name: 'Ether',
    symbol: 'ETH',
    chainTypes: ['evm'],
    icon: '◆',
  },
  {
    id: 'usdt',
    name: 'Tether USD',
    symbol: 'USDT',
    chainTypes: ['evm', 'svm', 'mvm'],
    icon: '◉',
  },
  {
    id: 'usdc',
    name: 'USD Coin',
    symbol: 'USDC',
    chainTypes: ['evm', 'svm', 'mvm'],
    icon: '●',
  },
  {
    id: 'matic',
    name: 'MATIC',
    symbol: 'MATIC',
    chainTypes: ['evm'],
    icon: '⬢',
  },
  {
    id: 'sol',
    name: 'Solana',
    symbol: 'SOL',
    chainTypes: ['svm'],
    icon: '◍',
  },
  {
    id: 'apt',
    name: 'Aptos',
    symbol: 'APT',
    chainTypes: ['mvm'],
    icon: '◈',
  },
];

const MARKET_SYMBOLS = TOKEN_METADATA.map((token) => token.symbol);

const MIN_TOUCH_TARGET = 44;

// Safe parse float with validation
const safeParseFloat = (value: string | undefined | null, fallback = 0): number => {
  if (!value) return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Format balance for display
const formatBalance = (balance: string | undefined, symbol: string): string => {
  const num = safeParseFloat(balance);
  if (num === 0) return `0.00 ${symbol}`;
  
  // Format with appropriate decimal places
  if (num < 0.01) {
    return `${num.toFixed(6)} ${symbol}`;
  }
  return `${num.toFixed(2)} ${symbol}`;
};

// Format Fiat value for display
const formatFiatDisplay = (balance: string | undefined, price: number, fiatRate: number, nativeCurrency: string): string => {
  const num = safeParseFloat(balance) * price * fiatRate;
  if (num === 0) return formatFiatValue(0, nativeCurrency);
  if (num < 0.01) return `< ${formatFiatValue(0.01, nativeCurrency)}`;
  return formatFiatValue(num, nativeCurrency);
};

export function TokenSelectorScreen({ navigation, route }: TokenSelectorScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [query, setQuery] = useState('');

  const { activeChain } = useWalletStore();
  const { quotes: marketQuotes } = useMarketData(MARKET_SYMBOLS);
  const { nativeCurrency } = useSettingsStore();
  const [fiatRate, setFiatRate] = useState(1);

  useEffect(() => {
    getFiatExchangeRate(nativeCurrency || 'USD').then(setFiatRate);
  }, [nativeCurrency]);

  // Get params with proper typing
  const selectedSymbol = route.params?.selectedSymbol;
  const chainKey = route.params?.chainKey;
  const onSelect = route.params?.onSelect;

  // Determine chain type
  const chainType = useMemo(() => {
    const routeChain = SUPPORTED_CHAINS.find((chain) => chain.key === chainKey);
    return routeChain?.type || activeChain?.type || 'evm';
  }, [activeChain?.type, chainKey]);

  // Use live token balances hook
  const { tokens: liveTokenBalances, isLoading, error } = useTokenBalances(chainKey || activeChain?.key);

  // Build token list with live data
  const tokens = useMemo((): PaymentToken[] => {
    const balanceMap: Record<string, string> = {};
    for (const token of liveTokenBalances) {
      balanceMap[token.tokenSymbol] = token.balanceFormatted;
    }

    return TOKEN_METADATA.map((meta) => ({
      ...meta,
      balance: balanceMap[meta.symbol] || '0.00',
      usdPrice: marketQuotes[meta.symbol]?.price || 0,
    }));
  }, [liveTokenBalances, marketQuotes]);

  // Filter tokens by chain and search query
  const filteredTokens = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tokens.filter((token) => {
      const matchesChain = token.chainTypes.includes(chainType);
      if (!matchesChain) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return (
        token.name.toLowerCase().includes(normalizedQuery) ||
        token.symbol.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [chainType, query, tokens]);

  const handleSelect = useCallback((token: PaymentToken) => {
    if (onSelect) {
      onSelect(token);
    }
    navigation.goBack();
  }, [navigation, onSelect]);

  const renderToken = useCallback(({ item }: { item: PaymentToken }) => {
    const isSelected = item.symbol === selectedSymbol;
    const marketQuote = marketQuotes[item.symbol];
    const change24h = marketQuote?.change24h;
    const hasChange = typeof change24h === 'number';
    const changeLabel = hasChange
      ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}% 24h`
      : '24h unavailable';

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => handleSelect(item)}
        style={styles.tokenTouchable}
        accessibilityRole="button"
        accessibilityLabel={`${item.symbol} token`}
        accessibilityHint={`Select ${item.name} for this payment`}
        accessibilityState={isSelected ? { selected: true } : undefined}
      >
        <SovereignCard
backgroundColor={isSelected ? colors.bgTertiary : colors.bgSecondary}
          style={styles.tokenCard}
        >
          <View style={styles.tokenRow}>
            <View style={styles.tokenLeft}>
              <View style={styles.tokenIconWrap}>
                <Text style={styles.tokenIcon}>{item.icon || '◉'}</Text>
              </View>
              <View>
                <Text style={styles.tokenSymbol}>{item.symbol}</Text>
                <Text style={styles.tokenName}>{item.name}</Text>
              </View>
            </View>
            <View style={styles.tokenRight}>
              <Text style={styles.tokenBalance}>
                {formatBalance(item.balance, item.symbol)}
              </Text>
              <Text style={styles.tokenUsd}>
                {formatFiatDisplay(item.balance, item.usdPrice, fiatRate, nativeCurrency || 'USD')}
              </Text>
              <Text
                style={[
                  styles.tokenChange,
                  hasChange && change24h !== null && change24h < 0 && styles.tokenChangeNegative,
                  !hasChange && styles.tokenChangeMuted,
                ]}
              >
                {changeLabel}
              </Text>
            </View>
          </View>
        </SovereignCard>
      </TouchableOpacity>
    );
  }, [marketQuotes, selectedSymbol, handleSelect]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>SELECT TOKEN</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(260)} style={styles.content}>
        <View style={styles.searchContainer}>
          <Icon name="search" size={18} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="SEARCH TOKEN..."
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search token"
            accessibilityHint="Filters the token list by name or symbol"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            {Array.from({ length: 6 }).map((_, index) => (
              <TokenSkeleton key={`token-skeleton-${index}`} />
            ))}
          </View>
        ) : (
          <FlashList
            data={filteredTokens}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <EmptyState
                icon={<Icon name="inbox" size={48} color={colors.textTertiary} />}
                title="No tokens found"
                description="Try a different search term or clear the current filter."
                actionLabel="Clear search"
                onAction={() => setQuery('')}
              />
            }
            renderItem={renderToken}
          />
        )}
      </Animated.View>
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
    borderBottomWidth: 2,
    borderBottomColor: colors.outlineSubtle,
  },
  backButton: {
    width: 80,
    paddingVertical: 8,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  backButtonText: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  headerSpacer: {
    width: 80,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
    borderRadius: 0,
    borderWidth: 1,
    borderBottomWidth: 3,
    borderColor: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    marginBottom: 24,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 13,
    color: colors.textPrimary,
    paddingVertical: 0,
    textTransform: 'uppercase',
  },
  listContent: {
    paddingBottom: 24,
    gap: 10,
  },
  tokenCard: {
    marginBottom: 10,
  },
  tokenTouchable: {
    minHeight: MIN_TOUCH_TARGET,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  tokenLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tokenIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  tokenIcon: {
    fontSize: 16,
    color: colors.accent,
  },
  tokenSymbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  tokenName: {
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  tokenRight: {
    alignItems: 'flex-end',
  },
  tokenBalance: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  tokenUsd: {
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  tokenChange: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.success,
    marginTop: 2,
    textAlign: 'right',
  },
  tokenChangeNegative: {
    color: colors.error,
  },
  tokenChangeMuted: {
    color: colors.textTertiary,
  },
  loadingContainer: {
    paddingTop: 6,
    gap: 8,
  },
  loadingText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 12,
  },
  emptyContainer: {
    marginTop: 40,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
});

export default TokenSelectorScreen;
