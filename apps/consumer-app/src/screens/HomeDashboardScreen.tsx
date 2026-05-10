/**
 * Veilpay Home Dashboard Screen (C3)
 * Main wallet dashboard with balance, actions, and transaction history
 * Uses the current hybrid structural design language for all interactive elements
 *
 * UPDATED: Now includes BottomNavBar, dynamic data, and price feed integration
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useWalletStore, SUPPORTED_CHAINS } from "../stores/walletStore";
import { SCREENS } from "../constants/screens";
import { useTheme, useStyles, typography } from "../styles/design-tokens";
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from "../components/Toast";
import { Logo } from "../components/Logo";
import { BottomNavBar } from "../components/BottomNavBar";
import { Icon } from "../components/Icon";
import { BalanceSkeleton, TransactionSkeleton } from "../components/Skeleton";
import { EmptyState } from "../components/EmptyState";
import { NetworkSelectorModal } from "../components/NetworkSelectorModal";
import { FiatGatewayModal } from "../features/fiat-gateway";
import { openExternalUrl } from "../utils/externalLink";
import { useBalance } from "../hooks/useBalance";
import { useMarketData } from "../hooks/useMarketData";
import { useOnramp, isFiatGatewayOrderForAddress } from "../features/fiat-gateway";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useShallow } from "zustand/react/shallow";

const TRANSAK_OUTCOME_TTL_MS = 24 * 60 * 60 * 1000;

type HomeDashboardScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, "Home">;
type HomeDashboardRouteProp = RouteProp<RootStackParamList, "Home">;

interface HomeDashboardScreenProps {
  navigation: HomeDashboardScreenNavigationProp;
  route: HomeDashboardRouteProp;
}

export function HomeDashboardScreen({ navigation, route }: HomeDashboardScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [showChainSelector, setShowChainSelector] = useState(false);
  const [showFiatGateway, setShowFiatGateway] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const {
    address,
    activeChain,
    setActiveChain,
    balance,
    balanceUsd,
    transactions,
    isLoadingTransactions,
    refreshTransactions,
    latestTransakOrder,
    latestOnrampOrder,
    clearLatestTransakOrder,
    clearLatestOnrampOrder,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      setActiveChain: state.setActiveChain,
      balance: state.balance,
      balanceUsd: state.balanceUsd,
      transactions: state.transactions,
      isLoadingTransactions: state.isLoadingTransactions,
      refreshTransactions: state.refreshTransactions,
      latestTransakOrder: state.latestTransakOrder,
      latestOnrampOrder: state.latestOnrampOrder,
      clearLatestTransakOrder: state.clearLatestTransakOrder,
      clearLatestOnrampOrder: state.clearLatestOnrampOrder,
    }))
  );

  const { checkOrderStatus } = useOnramp();

  // Use live balance hook
  const {
    isLoading: isLoadingBalance,
    refresh: refreshBalance,
    error: balanceError,
  } = useBalance();

  const activeMarketSymbol = activeChain?.symbol?.toUpperCase() || "ETH";
  const { getQuote: getMarketQuote, refresh: refreshMarketData } = useMarketData([activeMarketSymbol]);
  const marketQuote = getMarketQuote(activeMarketSymbol);

  const toast = useToast();

  // Fetch transactions when wallet/chain changes
  useEffect(() => {
    if (!address || !activeChain) {
      return;
    }

    refreshTransactions();
  }, [address, activeChain?.key, refreshTransactions]);

  // Pull to refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshMarketData(), refreshBalance(), refreshTransactions()]);
    } catch (error) {
      console.warn("Failed to refresh:", error);
    }
    setRefreshing(false);
  }, [refreshBalance, refreshTransactions, refreshMarketData]);

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";

  const handleSend = () => {
    if (activeChain?.type !== 'evm') {
      toast.show(`Send is not yet available for ${activeChain?.name || 'this chain'}. Coming soon!`, 'info');
      return;
    }
    navigation.navigate(SCREENS.SEND_PAYMENT, {});
  };

  const handleReceive = () => {
    navigation.navigate(SCREENS.RECEIVE_QR);
  };

  const handleScanQR = () => {
    navigation.navigate(SCREENS.QR_SCANNER);
  };

  const handleOpenFiatGateway = () => {
    setShowFiatGateway(true);
  };

  const handleBuyCrypto = () => {
    setShowFiatGateway(false);
    navigation.navigate(SCREENS.ONRAMP_AMOUNT, { flow: 'buy' });
  };

  const handleSellCrypto = () => {
    setShowFiatGateway(false);
    navigation.navigate(SCREENS.ONRAMP_AMOUNT, { flow: 'sell' });
  };

  const handleSwap = () => {
    void (async () => {
      const opened = await openExternalUrl('https://app.uniswap.org/swap');
      if (!opened) {
        toast.show('Swap link is unavailable right now', 'error');
      }
    })();
  };

  const handleSettings = () => {
    navigation.navigate(SCREENS.SETTINGS);
  };

  const handleChainSelect = (chain: (typeof SUPPORTED_CHAINS)[0]) => {
    setActiveChain(chain);
    setShowChainSelector(false);
    toast.show(`Switched to ${chain.name}`, "success");
  };

  const handleNavPress = (screen: keyof RootStackParamList) => {
    if (screen === SCREENS.HOME) {
      // Already on home
    } else {
      // Safe navigation - screen names are validated by TypeScript
      navigation.navigate(screen as never);
    }
  };

  // Display values
  const displayBalance = balanceUsd || "0.00";
  const displayCrypto = balance || "0.000";
  const displayTransactions = transactions.length > 0 ? transactions : [];
  const visibleTransakOrder = latestTransakOrder?.walletAddress === address ? latestTransakOrder : null;
  const visibleOnrampOrder = isFiatGatewayOrderForAddress(latestOnrampOrder, address) ? latestOnrampOrder : null;

  useEffect(() => {
    if (!visibleTransakOrder) {
      return;
    }

    if (Date.now() - visibleTransakOrder.updatedAt > TRANSAK_OUTCOME_TTL_MS) {
      clearLatestTransakOrder();
    }
  }, [clearLatestTransakOrder, visibleTransakOrder]);

  useEffect(() => {
    if (!visibleOnrampOrder?.orderId) {
      return;
    }

    if (visibleOnrampOrder.status !== 'pending' && visibleOnrampOrder.status !== 'processing') {
      return;
    }

    const syncOrderStatus = async () => {
      await checkOrderStatus(visibleOnrampOrder.orderId as string);
    };

    void syncOrderStatus();
    const intervalId = setInterval(syncOrderStatus, 15000);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkOrderStatus, visibleOnrampOrder?.orderId, visibleOnrampOrder?.status]);

  const transakOrderMeta = visibleTransakOrder
    ? (() => {
        switch (visibleTransakOrder.status) {
          case 'success':
            return {
              title: visibleTransakOrder.flow === 'sell' ? 'SELL ORDER COMPLETE' : 'BUY ORDER COMPLETE',
              label: 'Order successful',
              icon: 'success' as const,
        accent: colors.success,
        tint: colors.successBg,
            };
          case 'failed':
            return {
              title: visibleTransakOrder.flow === 'sell' ? 'SELL ORDER FAILED' : 'BUY ORDER FAILED',
              label: 'Order failed',
              icon: 'error' as const,
        accent: colors.error,
        tint: colors.errorBg,
            };
    case 'processing':
      return {
        title: visibleTransakOrder.flow === 'sell' ? 'SELL ORDER PROCESSING' : 'BUY ORDER PROCESSING',
        label: 'Payment is being processed',
        icon: 'loading' as const,
        accent: colors.accent,
        tint: colors.accentContainer,
      };
    default:
      return {
        title: visibleTransakOrder.flow === 'sell' ? 'SELL ORDER CREATED' : 'BUY ORDER CREATED',
        label: 'Order created',
        icon: 'loading' as const,
        accent: colors.accent,
        tint: colors.accentContainer,
      };
        }
      })()
    : null;

  const onrampOrderMeta = visibleOnrampOrder
    ? (() => {
        switch (visibleOnrampOrder.status) {
          case 'completed':
            return {
              title: visibleOnrampOrder.flow === 'sell' ? 'SELL COMPLETE' : 'BUY COMPLETE',
              label: 'Funds released to wallet',
              icon: 'success' as const,
              accent: colors.success,
              tint: colors.successBg,
            };
          case 'failed':
            return {
              title: visibleOnrampOrder.flow === 'sell' ? 'SELL FAILED' : 'BUY FAILED',
              label: 'There was an issue with the payment',
              icon: 'error' as const,
              accent: colors.error,
              tint: colors.errorBg,
            };
          default:
            return {
              title: visibleOnrampOrder.flow === 'sell' ? 'SELL PENDING' : 'BUY PENDING',
              label: 'Waiting for network confirmation',
              icon: 'loading' as const,
              accent: colors.accent,
              tint: colors.accentContainer,
            };
        }
      })()
    : null;

  const formatTransakAmount = (value?: string, currency?: string) => {
    if (!value) {
      return null;
    }

    const parsed = Number.parseFloat(value);
    const formatted = Number.isFinite(parsed)
      ? parsed.toLocaleString('en-US', { maximumFractionDigits: 6 })
      : value;

    return currency ? `${formatted} ${currency}` : formatted;
  };

  const formatTransactionTime = (timestamp: number) => {
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
      return "0x...";
    }

    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  };

  const getQuickActionAccessibility = (label: string) => {
    switch (label) {
      case "SCAN":
        return {
          label: "Scan QR code",
          hint: "Opens QR scanner to scan a payment QR code",
        };
      case "SEND":
        return {
          label: "Send payment",
          hint: "Opens send payment screen",
        };
      case "SWAP":
        return {
          label: "Swap crypto",
          hint: "Opens a swap experience in your browser",
        };
      case "RECEIVE":
        return {
          label: "Receive payment",
          hint: "Opens receive QR screen",
        };
      default:
        return {
          label,
          hint: `Opens ${label.toLowerCase()} action`,
        };
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />

      {/* Header */}
      <View style={styles.header}>
        <Logo variant="manual" size="small" />
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={handleSettings}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            accessibilityHint="Opens settings screen"
          >
            <Icon name="settings" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <Animated.View entering={FadeInDown.duration(260)} style={styles.animatedContent}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        >
          {/* Chain Selector Dropdown */}
          <TouchableOpacity
            onPress={() => setShowChainSelector(true)}
            activeOpacity={0.9}
            style={styles.chainSelectorWrapper}
            accessibilityRole="button"
            accessibilityLabel={`Network: ${activeChain?.name || "Ethereum"}`}
            accessibilityHint="Opens network selector to change blockchain network"
          >
            <SovereignCard backgroundColor={colors.bgSecondary} padding={0}>
              <View style={styles.chainSelectorContent}>
                <View style={styles.chainSelectorLeft}>
                  <Text style={styles.chainLabel}>NETWORK</Text>
                  <Text style={styles.chainName}>
                    {activeChain?.name?.toUpperCase() || "ETHEREUM"}
                  </Text>
                </View>
                <View style={styles.chainSelectorRight}>
                  <Text style={styles.chainSymbol}>{activeChain?.symbol || "ETH"}</Text>
                  <Icon name="chevron-down" size={16} color={colors.accent} />
                </View>
              </View>
            </SovereignCard>
          </TouchableOpacity>

          {/* Balance Card */}
          <View style={styles.balanceCardWrapper}>
            <SovereignCard backgroundColor={colors.bgSecondary} padding={0}>
              <View style={styles.balanceContent}>
                {isLoadingBalance ? (
                  <View style={styles.balanceSkeletonWrap}>
                    <BalanceSkeleton />
                  </View>
                ) : (
                  <>
                    <View style={styles.balanceRow}>
                      <View>
                        <Text style={styles.balanceLabel}>TOTAL BALANCE</Text>
                        <Text style={styles.balanceAmount} accessibilityLiveRegion="assertive" accessibilityLabel={`Total balance: $${Number(displayBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}>
                          {balanceVisible
                            ? `$${Number(displayBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : "••••••••••••••••••"}
                        </Text>
                        <Text style={styles.balanceCrypto}>
                          {balanceVisible
                            ? `${displayCrypto} ${activeChain?.symbol ?? "ETH"}`
                            : "••••••••••••"}
                        </Text>
                      </View>
                      <View style={styles.balanceRight}>
                        <TouchableOpacity
                          style={styles.visibilityBtn}
                          onPress={() => setBalanceVisible(!balanceVisible)}
                          accessibilityRole="button"
                          accessibilityLabel={balanceVisible ? "Hide balance" : "Show balance"}
                          accessibilityHint={
                            balanceVisible
                              ? "Hides your wallet balance for privacy"
                              : "Shows your wallet balance"
                          }
                        >
                          <Icon
                            name={balanceVisible ? "visibility" : "visibility-off"}
                            size={20}
                            color={colors.textPrimary}
                          />
                        </TouchableOpacity>
                        <View style={styles.privacyBadge}>
                          <Icon name="private" size={14} color={colors.accent} />
                          <Text style={styles.privacyBadgeText}>PRIVATE</Text>
                        </View>
                      </View>
                    </View>
                  </>
                )}

                {/* Price indicator */}
                {!isLoadingBalance && marketQuote && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>
                      {activeChain?.symbol || "ETH"} @ ${marketQuote.price.toFixed(2)}
                    </Text>
                    <Text style={styles.priceSource}>
                      {marketQuote.source} • {marketQuote.isStale ? "stale" : "live"}
                    </Text>
                  </View>
                )}

                {/* Change indicator */}
                {!isLoadingBalance && (
                  <View style={styles.changeRow}>
                    {marketQuote?.change24h !== null && marketQuote?.change24h !== undefined ? (
                      <>
                        <Icon
                          name={marketQuote.change24h >= 0 ? "chevron-up" : "chevron-down"}
                          size={14}
                          color={marketQuote.change24h >= 0 ? colors.success : colors.error}
                        />
                        <Text
                          style={[
                            styles.changePositive,
                            marketQuote.change24h < 0 && styles.changeNegative,
                          ]}
                        >
                          {marketQuote.change24h >= 0 ? "+" : ""}
                          {marketQuote.change24h.toFixed(2)}%
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.changePlaceholder}>24h change unavailable</Text>
                    )}
                    <Text style={styles.changeLabel}>Today</Text>
                  </View>
                )}
              </View>
            </SovereignCard>
          </View>

          {/* Action Row */}
          <View
            style={styles.actionRow}
            accessibilityRole="toolbar"
            accessibilityLabel="Quick actions"
          >
            {[
              ...(activeChain?.type === 'evm' ? [{ label: "SEND" as const, iconName: "send" as const, handler: handleSend }] : []),
              { label: "SCAN", iconName: "scan" as const, handler: handleScanQR, prominent: true },
              { label: "SWAP", iconName: "arrow-right" as const, handler: handleSwap },
              { label: "RECEIVE", iconName: "receive" as const, handler: handleReceive },
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
                  style={prominent ? { borderRadius: 36 } : { borderRadius: 28 }}
                >
                  <View
                    style={[styles.actionIconCircle, prominent && styles.actionIconCircleProminent]}
                  >
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

          {/* Fiat Gateway Card */}
          <View style={styles.transakCardWrapper}>
            <TouchableOpacity
              onPress={handleOpenFiatGateway}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Buy or sell crypto"
              accessibilityHint="Opens the buy or sell chooser for the in-app fiat gateway"
            >
              <SovereignCard backgroundColor={colors.bgSecondary} padding={0}>
                <View style={styles.transakContent}>
                  <Icon name="card" size={24} color={colors.accent} />
                  <View style={styles.transakInfo}>
                    <Text style={styles.transakTitle}>FIAT GATEWAY</Text>
                    <Text style={styles.transakSub}>Buy/Sell crypto via Onramp.money (UPI/IMPS)</Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.accent} />
                </View>
              </SovereignCard>
            </TouchableOpacity>
          </View>
          {visibleTransakOrder && transakOrderMeta ? (
            <View style={styles.transakOutcomeWrapper}>
              <SovereignCard
                backgroundColor={colors.surfaceCard}
                borderRadius={24}
                style={{ marginHorizontal: 24 }}
              >
                <View style={styles.transakOutcomeContent}>
                  <View style={[styles.transakOutcomeIcon, { backgroundColor: transakOrderMeta.tint }]}>
                    <Icon name={transakOrderMeta.icon} size={20} color={transakOrderMeta.accent} />
                  </View>
                  <View style={styles.transakOutcomeCopy}>
                    <Text style={styles.transakOutcomeTitle}>{transakOrderMeta.title}</Text>
                    <Text style={styles.transakOutcomeStatus}>{transakOrderMeta.label}</Text>
                    <Text style={styles.transakOutcomeMeta}>
                      {formatTransakAmount(visibleTransakOrder.cryptoAmount, visibleTransakOrder.cryptoCurrency) ?? 'Awaiting final amounts'}
                      {visibleTransakOrder.orderId ? ` • Order ${visibleTransakOrder.orderId}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={clearLatestTransakOrder}
                    style={styles.transakOutcomeDismiss}
                  >
                    <Icon name="close" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </SovereignCard>
            </View>
          ) : null}

          {visibleOnrampOrder && onrampOrderMeta ? (
            <View style={styles.transakOutcomeWrapper}>
              <SovereignCard
                backgroundColor={colors.surfaceCard}
                borderRadius={24}
                style={{ marginHorizontal: 24 }}
              >
                <View style={styles.transakOutcomeContent}>
                  <View style={[styles.transakOutcomeIcon, { backgroundColor: onrampOrderMeta.tint }]}>
                    <Icon name={onrampOrderMeta.icon} size={20} color={onrampOrderMeta.accent} />
                  </View>
                  <View style={styles.transakOutcomeCopy}>
                    <Text style={styles.transakOutcomeTitle}>{onrampOrderMeta.title}</Text>
                    <Text style={styles.transakOutcomeStatus}>{onrampOrderMeta.label}</Text>
                    <Text style={styles.transakOutcomeMeta}>
                      {visibleOnrampOrder.fiatAmount} {visibleOnrampOrder.fiatCurrency} • {visibleOnrampOrder.cryptoToken}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={clearLatestOnrampOrder}
                    style={styles.transakOutcomeDismiss}
                  >
                    <Icon name="close" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </SovereignCard>
            </View>
          ) : null}

          {/* Transactions */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate(SCREENS.TRANSACTION_HISTORY)}
              accessibilityRole="button"
              accessibilityLabel="See all transactions"
              accessibilityHint="Opens full transaction history"
            >
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>

          {isLoadingTransactions && displayTransactions.length === 0 ? (
            <View style={styles.transactionSkeletonList}>
              {Array.from({ length: 3 }).map((_, index) => (
                <TransactionSkeleton key={`home-tx-skeleton-${index}`} />
              ))}
            </View>
          ) : displayTransactions.length === 0 ? (
            <EmptyState
              icon={<Icon name="inbox" size={48} color={colors.textTertiary} />}
              title="No transactions yet"
              description="Your activity will appear here once you send or receive funds."
              actionLabel="Send payment"
              onAction={handleSend}
            />
          ) : (
            displayTransactions.slice(0, 5).map((tx) => {
              const isReceived = tx.type === "received";
              const counterparty = isReceived ? tx.from : tx.to;

              return (
        <SovereignCard
          key={tx.id}
          backgroundColor={colors.surfaceCard}
          padding={0}
          style={{ marginBottom: 8, marginHorizontal: 24, borderRadius: 24 }}
        >
          <View style={styles.txRow}>
            <View
              style={[
                styles.txIconCircle,
                isReceived ? styles.txIconReceive : styles.txIconSend,
              ]}
            >
              <Icon name={isReceived ? "receive" : "send"} size={16} color={colors.textPrimary} />
                    </View>
                    <View style={styles.txInfo}>
                      <Text style={styles.txAddress}>{formatAddress(counterparty)}</Text>
                      <Text style={styles.txTime}>{formatTransactionTime(tx.timestamp)}</Text>
                    </View>
                    <View style={styles.txAmounts}>
                      <Text
                        style={[
                          styles.txAmount,
                          isReceived ? styles.txAmountPositive : styles.txAmountNegative,
                        ]}
                      >
                        {`${isReceived ? "+" : "-"}${tx.amount}`}
                      </Text>
                      <Text style={styles.txCrypto}>{tx.tokenSymbol}</Text>
                    </View>
                  </View>
                </SovereignCard>
              );
            })
          )}

          <View style={{ height: 140 }} />
        </ScrollView>
      </Animated.View>

      {/* Bottom Navigation Bar */}
      <BottomNavBar currentScreen={SCREENS.HOME} onNavigate={handleNavPress} />

      <FiatGatewayModal
        visible={showFiatGateway}
        onClose={() => setShowFiatGateway(false)}
        onBuy={handleBuyCrypto}
        onSell={handleSellCrypto}
      />

      <NetworkSelectorModal
        visible={showChainSelector}
        activeChain={activeChain}
        chains={SUPPORTED_CHAINS}
        onSelect={handleChainSelect}
        onClose={() => setShowChainSelector(false)}
      />

      {/* Toast Notification */}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerActions: {
    flexDirection: "row",
    gap: 12,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIcon: {
    fontSize: 20,
    color: colors.textMuted,
  },
  animatedContent: {
    flex: 1,
  },
  chainSelectorWrapper: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  chainSelectorContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  chainSelectorLeft: {
    gap: 4,
  },
  chainLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 1,
  },
  chainName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.accent,
    fontWeight: "bold",
  },
  chainSelectorRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chainSymbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "bold",
  },
  chainArrow: {
    fontSize: 12,
    color: colors.textMuted,
  },
  balanceCardWrapper: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  balanceContent: {
    padding: 20,
  },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  balanceLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  balanceAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 36,
    color: colors.textPrimary,
    fontWeight: "bold",
    letterSpacing: -0.5,
  },
  balanceCrypto: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  balanceRight: {
    alignItems: "flex-end",
    gap: 12,
  },
  visibilityBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  visibilityIcon: {
    fontSize: 20,
  },
  privacyBadge: {
    backgroundColor: colors.accentContainer,
    borderWidth: 0,
    borderColor: "transparent",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  privacyBadgeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.accent,
    letterSpacing: 0.5,
    fontWeight: "bold",
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  priceLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
  },
  priceSource: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
  },
  changeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  changePositive: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.success,
  },
  changeNegative: {
    color: colors.error,
  },
  changePlaceholder: {
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textTertiary,
  },
  changeLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
  },
  balanceSkeletonWrap: {
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  actionBtn: {
    alignItems: "center",
    gap: 8,
  },
  actionBtnProminent: {
    alignItems: "center",
    gap: 8,
    marginTop: -16,
  },
  actionIconCircle: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconCircleProminent: {
    width: 72,
    height: 72,
  },
  actionIcon: {
    fontSize: 22,
    color: colors.accent,
  },
  actionIconProminent: {
    fontSize: 32,
    color: colors.bgPrimary,
    fontWeight: "bold",
  },
  actionLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  actionLabelProminent: {
    color: colors.accent,
    fontWeight: "bold",
  },
  transakCardWrapper: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  transakOutcomeWrapper: {
    marginBottom: 24,
  },
  transakOutcomeContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  transakOutcomeIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  transakOutcomeCopy: {
    flex: 1,
  },
  transakOutcomeTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  transakOutcomeStatus: {
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 3,
  },
  transakOutcomeMeta: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 4,
  },
  transakOutcomeDismiss: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  transakContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  transakIcon: {
    fontSize: 28,
  },
  transakInfo: {
    flex: 1,
  },
  transakTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  transakSub: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  transakArrow: {
    fontSize: 18,
    color: colors.accent,
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
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "bold",
    marginBottom: 8,
  },
  emptySubtext: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: "center",
  },
  transactionSkeletonList: {
    marginHorizontal: 24,
    gap: 8,
    paddingVertical: 8,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  txIconCircle: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  txIconReceive: {
    backgroundColor: colors.successBg,
  },
  txIconSend: {
    backgroundColor: colors.errorSurface,
  },
  txIcon: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  txInfo: {
    flex: 1,
  },
  txAddress: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
  },
  txTime: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 2,
  },
  txAmounts: {
    alignItems: "flex-end",
  },
  txAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: "bold",
  },
  txAmountPositive: {
    color: colors.success,
  },
  txAmountNegative: {
    color: colors.error,
  },
  txCrypto: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.opacityOverlay,
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: colors.surfaceScreen,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 48,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  modalClose: {
    fontSize: 20,
    color: colors.textMuted,
  },
  modalCloseButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  chainOptionContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  chainOptionLeft: {
    gap: 4,
  },
  chainOptionName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "bold",
  },
  chainOptionNameActive: {
    color: colors.bgPrimary,
  },
  chainOptionType: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 1,
  },
  chainOptionTypeActive: {
    color: colors.outlineDefault,
  },
  chainOptionSymbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: "bold",
  },
  chainOptionSymbolActive: {
    color: colors.accent,
  },
});

export default HomeDashboardScreen;
