import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PressableOpacity } from '../PressableOpacity';
import { useTheme, useStyles, typography } from '../../styles/design-tokens';
import { SovereignCard } from '../SovereignCard';
import { TokenSkeleton } from '../Skeleton';
import { Icon } from '../Icon';
import type { BalanceResult, TokenBalance } from '../../utils/balanceFetcher';
import { useMarketData } from '../../hooks/useMarketData';
import { Swipeable } from 'react-native-gesture-handler';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatFiatValue } from '../../utils/priceFeed';

// Helper to get standard token icon based on symbol
const getTokenIcon = (symbol: string) => {
  const map: Record<string, string> = {
    ETH: '◆', USDT: '◉', USDC: '●', MATIC: '⬢', SOL: '◍'
  };
  return map[symbol?.toUpperCase()] || '●';
};

interface TokenAssetItemProps {
  asset: BalanceResult | TokenBalance;
  price: number;
  onSend: (symbol: string) => void;
  onPress: (symbol: string) => void;
  fiatRate: number;
  nativeCurrency: string;
  colors: any;
  styles: any;
}

const TokenAssetItemComponent = ({ asset, price, onSend, onPress, fiatRate, nativeCurrency, colors, styles }: TokenAssetItemProps) => {
  const isNative = !('tokenAddress' in asset);
  const symbol = asset.symbol || 'UNK';
  const name = isNative ? symbol : (asset as TokenBalance).tokenName;
  const balanceNum = parseFloat(asset.balanceFormatted);
  const usdValue = balanceNum * price;
  const fiatValue = usdValue * fiatRate;
  const displayUsd = fiatValue >= 0.01 ? formatFiatValue(fiatValue, nativeCurrency) : (fiatValue > 0 ? `< ${formatFiatValue(0.01, nativeCurrency)}` : formatFiatValue(0, nativeCurrency));

  const renderRightActions = () => {
    return (
      <PressableOpacity 
        style={[styles.quickAction, { backgroundColor: colors.accent }]} 
        onPress={() => onSend(symbol)}
      >
        <Icon name="arrow-up" size={24} color={colors.bgPrimary} />
      </PressableOpacity>
    );
  };

  return (
    <View style={styles.itemWrapper}>
      <Swipeable renderRightActions={renderRightActions} containerStyle={styles.swipeableContainer}>
        <PressableOpacity activeOpacity={0.7} onPress={() => onPress(symbol)}>
          <SovereignCard backgroundColor={colors.bgPrimary} padding={0} style={{ borderRadius: 0, borderWidth: 1, borderColor: colors.textPrimary }}>
            <View style={styles.row}>
              <View style={styles.left}>
                <View style={styles.iconWrap}>
                  <Text style={styles.iconText}>{getTokenIcon(symbol)}</Text>
                </View>
                <View>
                  <Text style={styles.symbol}>{symbol}</Text>
                  <Text style={styles.name}>{name.toUpperCase()}</Text>
                </View>
              </View>
              <View style={styles.right}>
                <Text style={styles.balance}>{parseFloat(asset.balanceFormatted).toFixed(4).replace(/\.?0+$/, '') || '0'} {symbol}</Text>
                <Text style={styles.usdValue}>{displayUsd}</Text>
              </View>
            </View>
          </SovereignCard>
        </PressableOpacity>
      </Swipeable>
    </View>
  );
};

const TokenAssetItem = memo(TokenAssetItemComponent, (prev, next) => {
  return prev.price === next.price && prev.asset.balance === next.asset.balance;
});

export type PrivacyAssetListItem = {
  id: string;
  name: string;
  symbol: string;
  balance: string;
  subtitle: string;
  icon: string;
  enabled: boolean;
  selected?: boolean;
  disabledReason?: string;
};

interface TokenAssetsListProps {
  isLoading: boolean;
  nativeBalance: BalanceResult | null;
  tokenBalances: TokenBalance[];
  onSend: (symbol: string) => void;
  onTokenPress: (symbol: string) => void;
  fiatRate: number;
  /** Privacy-pool rows (SPP Private XLM, etc.) under a dedicated section. */
  privacyAssets?: PrivacyAssetListItem[];
  onPrivacyAssetPress?: (id: string) => void;
  selectedPrivacyAssetId?: string | null;
}

function TokenAssetsListComponent({
  isLoading,
  nativeBalance,
  tokenBalances,
  onSend,
  onTokenPress,
  fiatRate,
  privacyAssets,
  onPrivacyAssetPress,
  selectedPrivacyAssetId,
}: TokenAssetsListProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const nativeCurrency = useSettingsStore((state) => state.nativeCurrency) || 'USD';

  // Extract all unique symbols to fetch market data
  const marketSymbols = useMemo(() => {
    const symbols = new Set<string>();
    if (nativeBalance?.symbol) symbols.add(nativeBalance.symbol);
    (tokenBalances || []).forEach(t => { if (t.symbol) symbols.add(t.symbol); });
    return Array.from(symbols);
  }, [nativeBalance, tokenBalances]);

  const { quotes: marketQuotes } = useMarketData(marketSymbols);

  const assets = useMemo(() => {
    const list = [];
    if (nativeBalance && nativeBalance.balance !== '0') {
      list.push(nativeBalance);
    }
    (tokenBalances || []).forEach(t => {
      if (t.balance !== '0') {
        list.push(t);
      }
    });
    
    // If empty but not loading, we can show native as 0
    if (list.length === 0 && nativeBalance) {
      list.push(nativeBalance);
    }
    return list;
  }, [nativeBalance, tokenBalances]);

  const hasPrivacy = (privacyAssets?.length ?? 0) > 0;

  if (isLoading && assets.length === 0 && !hasPrivacy) {
    return (
      <View style={styles.container}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>ASSETS</Text>
        </View>
        <View style={styles.skeletonList}>
          {Array.from({ length: 3 }).map((_, i) => <TokenSkeleton key={i} />)}
        </View>
      </View>
    );
  }

  if (assets.length === 0 && !hasPrivacy) {
    return null;
  }

  return (
    <View style={styles.container}>
      {hasPrivacy ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Privacy</Text>
          </View>
          <View style={styles.list}>
            {privacyAssets!.map((item) => {
              const selected = selectedPrivacyAssetId === item.id || item.selected;
              return (
                <View key={item.id} style={styles.itemWrapper}>
                  <PressableOpacity
                    activeOpacity={item.enabled ? 0.7 : 1}
                    onPress={() => {
                      if (!item.enabled) return;
                      onPrivacyAssetPress?.(item.id);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !item.enabled, selected }}
                    accessibilityLabel={`${item.name} ${item.balance} ${item.symbol}`}
                    accessibilityHint={
                      item.enabled
                        ? 'Shows private balance and shield actions on home'
                        : item.disabledReason || 'Not available'
                    }
                  >
                    <SovereignCard
                      backgroundColor={selected ? colors.bgTertiary : colors.bgPrimary}
                      padding={0}
                      style={{
                        borderRadius: 0,
                        borderWidth: 1,
                        borderColor: selected ? colors.accent : colors.textPrimary,
                        opacity: item.enabled ? 1 : 0.5,
                      }}
                    >
                      <View style={styles.row}>
                        <View style={styles.left}>
                          <View style={[styles.iconWrap, styles.privacyIconWrap]}>
                            <Text style={styles.iconText}>{item.icon}</Text>
                          </View>
                          <View>
                            <Text style={styles.symbol}>{item.symbol}</Text>
                            <Text style={styles.name}>{item.name.toUpperCase()}</Text>
                            <Text style={styles.privacySubtitle} numberOfLines={1}>
                              {item.enabled ? item.subtitle : item.disabledReason || item.subtitle}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.right}>
                          <Text style={styles.balance}>
                            {item.balance} {item.symbol}
                          </Text>
                          <View style={styles.shieldedTag}>
                            <Icon name="private" size={10} color={colors.accent} />
                            <Text style={styles.shieldedTagText}>PRIVATE</Text>
                          </View>
                        </View>
                      </View>
                    </SovereignCard>
                  </PressableOpacity>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {assets.length > 0 ? (
        <>
          <View style={[styles.sectionHeader, hasPrivacy && styles.sectionHeaderSpaced]}>
            <Text style={styles.sectionTitle}>Assets</Text>
          </View>

          <View style={styles.list}>
            {assets.map((asset) => {
              const symbol = asset.symbol || 'UNK';
              const price = marketQuotes[symbol]?.price || 0;
              const key = 'tokenAddress' in asset ? `token-${asset.tokenAddress}` : `native-${symbol}`;
              return (
                <TokenAssetItem
                  key={key}
                  asset={asset}
                  price={price}
                  onSend={onSend}
                  onPress={(sym) => {
                    // Selecting a public asset should leave privacy home mode (caller handles).
                    onTokenPress(sym);
                  }}
                  fiatRate={fiatRate}
                  nativeCurrency={nativeCurrency}
                  colors={colors}
                  styles={styles}
                />
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}

export const TokenAssetsList = memo(TokenAssetsListComponent);

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
  sectionHeaderSpaced: {
    marginTop: 20,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  privacyIconWrap: {
    borderColor: colors.accent,
  },
  privacySubtitle: {
    fontFamily: typography.fontFamily.body,
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 2,
    maxWidth: 180,
  },
  shieldedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  shieldedTagText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 9,
    color: colors.accent,
    letterSpacing: 0.5,
    fontWeight: 'bold',
  },

  skeletonList: {
    marginHorizontal: 24,
    gap: 8,
    paddingVertical: 8,
  },
  list: {
    gap: 8,
  },
  itemWrapper: {
    marginHorizontal: 24,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  iconText: {
    fontSize: 16,
    color: colors.accent,
  },
  symbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  name: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  right: {
    alignItems: 'flex-end',
  },
  balance: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  usdValue: {
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
