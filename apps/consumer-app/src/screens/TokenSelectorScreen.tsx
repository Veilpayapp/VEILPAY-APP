/**
 * Veilpay Token Selector Screen
 * Public chain tokens + Privacy section (SPP Private XLM, future pools).
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { SovereignCard } from '../components/SovereignCard';
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
import {
  listPrivacyAssetsForSelector,
  privacyAssetToPaymentToken,
} from '../constants/privacyAssets';
import { ensureSppAccountReady, getLocalPrivateBalance } from '../utils/stellarSpp';

type TokenSelectorScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TokenSelector'>;
  route: RouteProp<RootStackParamList, 'TokenSelector'>;
};

type ListRow =
  | { kind: 'header'; id: string; title: string }
  | { kind: 'token'; id: string; token: PaymentToken };

const TOKEN_METADATA: Omit<PaymentToken, 'balance' | 'usdPrice'>[] = [
  { id: 'eth', name: 'Ether', symbol: 'ETH', chainTypes: ['evm'], icon: '◆' },
  { id: 'usdt', name: 'Tether USD', symbol: 'USDT', chainTypes: ['evm', 'svm'], icon: '◉' },
  { id: 'usdc', name: 'USD Coin', symbol: 'USDC', chainTypes: ['evm', 'svm'], icon: '●' },
  { id: 'matic', name: 'MATIC', symbol: 'MATIC', chainTypes: ['evm'], icon: '⬢' },
  { id: 'sol', name: 'Solana', symbol: 'SOL', chainTypes: ['svm'], icon: '◍' },
  { id: 'xlm', name: 'Stellar Lumens', symbol: 'XLM', chainTypes: ['xlm'], icon: '✦' },
];

const MARKET_SYMBOLS = [...new Set(TOKEN_METADATA.map((t) => t.symbol).concat(['XLM']))];

const MIN_TOUCH_TARGET = 44;

const safeParseFloat = (value: string | undefined | null, fallback = 0): number => {
  if (!value) return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatBalance = (balance: string | undefined, symbol: string): string => {
  const num = safeParseFloat(balance);
  if (num === 0) return `0.00 ${symbol}`;
  if (num < 0.01) return `${num.toFixed(6)} ${symbol}`;
  return `${num.toFixed(2)} ${symbol}`;
};

const formatFiatDisplay = (
  balance: string | undefined,
  price: number,
  fiatRate: number,
  nativeCurrency: string
): string => {
  const num = safeParseFloat(balance) * price * fiatRate;
  if (num === 0) return formatFiatValue(0, nativeCurrency);
  if (num < 0.01) return `< ${formatFiatValue(0.01, nativeCurrency)}`;
  return formatFiatValue(num, nativeCurrency);
};

export function TokenSelectorScreen({ navigation, route }: TokenSelectorScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [query, setQuery] = useState('');

  const { activeChain, address } = useWalletStore();
  const { quotes: marketQuotes } = useMarketData(MARKET_SYMBOLS);
  const { nativeCurrency, selectedPrivacyAssetId } = useSettingsStore();
  const [fiatRate, setFiatRate] = useState(1);
  const [privacyBalances, setPrivacyBalances] = useState<Record<string, string>>({});

  useEffect(() => {
    getFiatExchangeRate(nativeCurrency || 'USD').then(setFiatRate);
  }, [nativeCurrency]);

  const selectedSymbol = route.params?.selectedSymbol;
  const chainKey = route.params?.chainKey || activeChain?.key;
  const onSelect = route.params?.onSelect;

  const chainType = useMemo(() => {
    const routeChain = SUPPORTED_CHAINS.find((chain) => chain.key === chainKey);
    return routeChain?.type || activeChain?.type || 'evm';
  }, [activeChain?.type, chainKey]);

  const { tokens: liveTokenBalances, isLoading, error } = useTokenBalances(chainKey || activeChain?.key);

  const privacyCatalog = useMemo(() => listPrivacyAssetsForSelector(chainKey), [chainKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!address || privacyCatalog.length === 0) {
        setPrivacyBalances({});
        return;
      }
      const next: Record<string, string> = {};
      for (const asset of privacyCatalog) {
        if (asset.protocol === 'spp' && asset.enabled) {
          const { amount } = await getLocalPrivateBalance(asset.chainKey, address);
          next[asset.id] = amount;
        } else {
          next[asset.id] = '0';
        }
      }
      if (!cancelled) setPrivacyBalances(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [address, privacyCatalog]);

  const publicTokens = useMemo((): PaymentToken[] => {
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

  const privacyTokens = useMemo((): PaymentToken[] => {
    return privacyCatalog.map((asset) =>
      privacyAssetToPaymentToken(
        asset,
        privacyBalances[asset.id] || '0',
        marketQuotes[asset.quoteSymbol]?.price || 0
      )
    );
  }, [privacyCatalog, privacyBalances, marketQuotes]);

  const listRows = useMemo((): ListRow[] => {
    const normalizedQuery = query.trim().toLowerCase();
    const match = (t: PaymentToken) => {
      if (!normalizedQuery) return true;
      return (
        t.name.toLowerCase().includes(normalizedQuery) ||
        t.symbol.toLowerCase().includes(normalizedQuery) ||
        (t.privacySubtitle?.toLowerCase().includes(normalizedQuery) ?? false)
      );
    };

    const rows: ListRow[] = [];

    const privacyFiltered = privacyTokens.filter(match);
    if (privacyFiltered.length > 0) {
      rows.push({ kind: 'header', id: 'hdr-privacy', title: 'Privacy' });
      for (const token of privacyFiltered) {
        rows.push({ kind: 'token', id: token.id, token });
      }
    }

    const publicFiltered = publicTokens.filter(
      (token) => token.chainTypes.includes(chainType) && match(token)
    );
    if (publicFiltered.length > 0) {
      rows.push({ kind: 'header', id: 'hdr-public', title: 'Assets' });
      for (const token of publicFiltered) {
        rows.push({ kind: 'token', id: token.id, token });
      }
    }

    return rows;
  }, [chainType, privacyTokens, publicTokens, query]);

  const handleSelect = useCallback(
    (token: PaymentToken) => {
      if (token.isPrivacyAsset && token.privacyEnabled === false) {
        return;
      }

      // Privacy section: select asset for home + payments; setup is automatic.
      if (token.isPrivacyAsset && token.privacyAssetId) {
        useSettingsStore.getState().setSelectedPrivacyAssetId(token.privacyAssetId);
        if (token.privacyProtocol === 'spp' && address && token.privacyChainKey) {
          void ensureSppAccountReady(token.privacyChainKey, address).catch(() => {
            /* non-blocking */
          });
        }
      } else if (!token.isPrivacyAsset) {
        // Choosing a public asset leaves privacy mode on Home.
        useSettingsStore.getState().setSelectedPrivacyAssetId(null);
      }

      if (onSelect) {
        onSelect(token);
      }
      navigation.goBack();
    },
    [address, navigation, onSelect]
  );

  const renderRow = useCallback(
    ({ item }: { item: ListRow }) => {
      if (item.kind === 'header') {
        return (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{item.title}</Text>
          </View>
        );
      }

      const token = item.token;
      const isPrivacy = !!token.isPrivacyAsset;
      const isSelected = isPrivacy
        ? token.privacyAssetId === selectedPrivacyAssetId || token.symbol === selectedSymbol
        : token.symbol === selectedSymbol;
      const disabled = isPrivacy && token.privacyEnabled === false;
      const marketQuote = marketQuotes[isPrivacy ? (token.symbol === 'pXLM' ? 'XLM' : token.symbol) : token.symbol]
        || marketQuotes['XLM'];
      const change24h = marketQuote?.change24h;
      const hasChange = typeof change24h === 'number' && !isPrivacy;
      const changeLabel = isPrivacy
        ? token.privacySubtitle || 'Private'
        : hasChange
          ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}% 24h`
          : '24h unavailable';

      return (
        <PressableOpacity
          activeOpacity={disabled ? 1 : 0.8}
          onPress={() => handleSelect(token)}
          style={[styles.tokenTouchable, disabled && styles.tokenDisabled]}
          accessibilityRole="button"
          accessibilityLabel={`${token.symbol} ${isPrivacy ? 'privacy asset' : 'token'}`}
          accessibilityHint={
            disabled
              ? token.privacyDisabledReason || 'Not available'
              : isPrivacy
                ? 'Select private balance for home and payments'
                : `Select ${token.name} for this payment`
          }
          accessibilityState={{ selected: isSelected, disabled }}
        >
          <SovereignCard
            backgroundColor={isSelected ? colors.bgTertiary : colors.bgSecondary}
            style={{
              ...styles.tokenCard,
              ...(isPrivacy ? styles.privacyCard : null),
              ...(isSelected && isPrivacy ? styles.privacyCardSelected : null),
            }}
          >
            <View style={styles.tokenRow}>
              <View style={styles.tokenLeft}>
                <View style={[styles.tokenIconWrap, isPrivacy && styles.privacyIconWrap]}>
                  <Text style={styles.tokenIcon}>{token.icon || '◉'}</Text>
                </View>
                <View style={styles.tokenMeta}>
                  <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                  <Text style={styles.tokenName}>{token.name}</Text>
                  {disabled && token.privacyDisabledReason ? (
                    <Text style={styles.disabledReason} numberOfLines={2}>
                      {token.privacyDisabledReason}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.tokenRight}>
                <Text style={styles.tokenBalance}>
                  {formatBalance(token.balance, token.symbol)}
                </Text>
                <Text style={styles.tokenUsd}>
                  {formatFiatDisplay(
                    token.balance,
                    token.usdPrice,
                    fiatRate,
                    nativeCurrency || 'USD'
                  )}
                </Text>
                <View style={styles.changeRow}>
                  {isPrivacy ? (
                    <>
                      <Icon name="private" size={10} color={colors.accent} />
                      <Text style={styles.privacyTag}>PRIVATE</Text>
                    </>
                  ) : (
                    <Text
                      style={[
                        styles.tokenChange,
                        hasChange && change24h !== null && change24h < 0 && styles.tokenChangeNegative,
                        !hasChange && styles.tokenChangeMuted,
                      ]}
                    >
                      {changeLabel}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          </SovereignCard>
        </PressableOpacity>
      );
    },
    [
      colors,
      fiatRate,
      handleSelect,
      marketQuotes,
      nativeCurrency,
      selectedPrivacyAssetId,
      selectedSymbol,
      styles,
    ]
  );

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
            placeholder="SEARCH TOKEN OR PRIVACY…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search token"
            accessibilityHint="Filters public tokens and privacy assets"
          />
          {query.length > 0 && (
            <PressableOpacity onPress={() => setQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={16} color={colors.textTertiary} />
            </PressableOpacity>
          )}
        </View>

        {isLoading && listRows.length === 0 ? (
          <View style={styles.loadingContainer}>
            {Array.from({ length: 6 }).map((_, index) => (
              <TokenSkeleton key={`token-skeleton-${index}`} />
            ))}
          </View>
        ) : (
          <FlashList
            data={listRows}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <EmptyState
                icon={<Icon name="inbox" size={48} color={colors.textTertiary} />}
                title="No tokens found"
                description={
                  error
                    ? 'Could not load balances. Try again.'
                    : 'Try a different search term or clear the current filter.'
                }
                actionLabel="Clear search"
                onAction={() => setQuery('')}
              />
            }
            renderItem={renderRow}
            getItemType={(item) => item.kind}
          />
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

const themeStyles = (colors: any) =>
  StyleSheet.create({
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
    headerTitle: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 16,
      color: colors.textPrimary,
      fontWeight: 'bold',
      letterSpacing: 1,
    },
    content: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 16,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.bgSecondary,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.fontFamily.mono,
      fontSize: 13,
      color: colors.textPrimary,
      padding: 0,
    },
    loadingContainer: {
      gap: 8,
    },
    listContent: {
      paddingBottom: 40,
    },
    sectionHeader: {
      paddingTop: 8,
      paddingBottom: 10,
    },
    sectionTitle: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.textMuted,
      letterSpacing: 1,
      fontWeight: 'bold',
    },
    tokenTouchable: {
      marginBottom: 10,
      minHeight: MIN_TOUCH_TARGET,
    },
    tokenDisabled: {
      opacity: 0.55,
    },
    tokenCard: {
      borderRadius: 0,
    },
    privacyCard: {
      borderWidth: 1,
      borderColor: colors.outline,
    },
    privacyCardSelected: {
      borderColor: colors.accent,
    },
    tokenRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 14,
    },
    tokenLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
    },
    tokenMeta: {
      flex: 1,
      paddingRight: 8,
    },
    tokenIconWrap: {
      width: 40,
      height: 40,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      alignItems: 'center',
      justifyContent: 'center',
    },
    privacyIconWrap: {
      borderColor: colors.accent,
    },
    tokenIcon: {
      fontSize: 16,
      color: colors.textPrimary,
    },
    tokenSymbol: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 14,
      color: colors.textPrimary,
      fontWeight: 'bold',
    },
    tokenName: {
      fontFamily: typography.fontFamily.body,
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    disabledReason: {
      fontFamily: typography.fontFamily.body,
      fontSize: 11,
      color: colors.warning,
      marginTop: 4,
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
      fontFamily: typography.fontFamily.mono,
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
    },
    changeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 4,
    },
    tokenChange: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 10,
      color: colors.success,
    },
    tokenChangeNegative: {
      color: colors.error,
    },
    tokenChangeMuted: {
      color: colors.textTertiary,
    },
    privacyTag: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 9,
      color: colors.accent,
      letterSpacing: 0.5,
      fontWeight: 'bold',
    },
  });
