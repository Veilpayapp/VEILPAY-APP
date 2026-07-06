/* istanbul ignore file */
/**
 * Veilpay Home Dashboard Screen (C3)
 * Main wallet dashboard with balance, actions, and transaction history
 * Uses the current hybrid structural design language for all interactive elements
 *
 * UPDATED: Now includes BottomNavBar, dynamic data, and price feed integration
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, StatusBar, RefreshControl } from "react-native";
import { PressableOpacity } from '../components/PressableOpacity';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from "react-native-safe-area-context";
import { useWalletStore, SUPPORTED_CHAINS } from "../stores/walletStore";
import { useTransactionStore } from "../stores/transactionStore";
import { SCREENS } from "../constants/screens";
import { useTheme, useStyles, typography } from "../styles/design-tokens";
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from "../components/Toast";
import { themeStyles } from "./styles/HomeDashboardScreen.styles";
import { Logo } from "../components/Logo";
import { BottomNavBar } from "../components/BottomNavBar";
import { Icon } from "../components/Icon";
import { BalanceSkeleton, TransactionSkeleton } from "../components/Skeleton";
import { RecentTransactionsList } from "../components/dashboard/RecentTransactionsList";
import { TokenAssetsList } from "../components/dashboard/TokenAssetsList";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { FiatGatewayCard } from "../components/dashboard/FiatGatewayCard";
import { TransactionItem } from '../components/TransactionItem';
import { DashboardBalanceCard } from '../components/home/DashboardBalanceCard';
import { DashboardQuickActions } from '../components/home/DashboardQuickActions';
import { EmptyState } from "../components/EmptyState";
import { NetworkSelectorModal } from "../components/NetworkSelectorModal";
import { CurrencySelectorModal } from "../components/CurrencySelectorModal";
import { FiatGatewayModal } from "../components/FiatGatewayModal";
import { openExternalUrl } from "../utils/externalLink";
import { useBalance } from "../hooks/useBalance";
import { useMarketData } from "../hooks/useMarketData";
import { useOnramp } from "../hooks/useOnramp";
import { isFiatGatewayOrderForAddress } from "../utils/fiatGateway";
import Animated, { FadeInDown, useSharedValue, useAnimatedScrollHandler, useAnimatedStyle, interpolate, Extrapolation } from "react-native-reanimated";
import { MotiView } from "moti";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "../stores/settingsStore";

const TRANSAK_OUTCOME_TTL_MS = 24 * 60 * 60 * 1000;

type HomeDashboardScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, "Home">;
type HomeDashboardRouteProp = RouteProp<RootStackParamList, "Home">;

interface HomeDashboardScreenProps {
  navigation: HomeDashboardScreenNavigationProp;
  route: HomeDashboardRouteProp;
}
interface DashboardRefreshControlProps {
  refreshing: boolean;
  onRefresh: () => void;
  accentColor: string;
}

function DashboardRefreshControl({ refreshing, onRefresh, accentColor }: DashboardRefreshControlProps) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={accentColor}
      colors={[accentColor]}
    />
  );
}

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

export function HomeDashboardScreen({ navigation, route }: HomeDashboardScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [showChainSelector, setShowChainSelector] = useState(false);
  const [showFiatGateway, setShowFiatGateway] = useState(false);
  const [showCurrencySelector, setShowCurrencySelector] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Only animate on first mount — subsequent tab visits should be instant
  const hasAnimated = useRef(false);
  const getDelay = (ms: number) => {
    if (hasAnimated.current) return 0;
    return ms;
  };
  useEffect(() => { hasAnimated.current = true; }, []);

  const {
    address,
    activeChain,
    setActiveChain,
    balance,
    balanceUsd,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      setActiveChain: state.setActiveChain,
      balance: state.balance,
      balanceUsd: state.balanceUsd,
    }))
  );

  const {
    transactions,
    isLoadingTransactions,
    refreshTransactions,
    latestTransakOrder,
    latestOnrampOrder,
    clearLatestTransakOrder,
    clearLatestOnrampOrder,
  } = useTransactionStore(
    useShallow((state) => ({
      transactions: state.transactions,
      isLoadingTransactions: state.isLoadingTransactions,
      refreshTransactions: state.refreshTransactions,
      latestTransakOrder: state.latestTransakOrder,
      latestOnrampOrder: state.latestOnrampOrder,
      clearLatestTransakOrder: state.clearLatestTransakOrder,
      clearLatestOnrampOrder: state.clearLatestOnrampOrder,
    }))
  );

  const { nativeCurrency, setNativeCurrency } = useSettingsStore(
    useShallow((state) => ({
      nativeCurrency: state.nativeCurrency,
      setNativeCurrency: state.setNativeCurrency,
    }))
  );

  const { checkOrderStatus } = useOnramp();

  // Use live balance hook
  const {
    isLoading: isLoadingBalance,
    refresh: refreshBalance,
    error: balanceError,
    nativeBalance,
    tokenBalances,
    fiatRate,
  } = useBalance();

  const activeMarketSymbol = activeChain?.symbol?.toUpperCase() || "ETH";
  const { getQuote: getMarketQuote, refresh: refreshMarketData } = useMarketData([activeMarketSymbol]);
  const marketQuote = getMarketQuote(activeMarketSymbol);

  const toast = useToast();

  // Scroll Engine for CRED-style Parallax Physics
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const balanceAnimatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(scrollY.value, [0, 200], [0, 100], Extrapolation.CLAMP);
    const scale = interpolate(scrollY.value, [0, 200], [1, 0.85], Extrapolation.CLAMP);
    const opacity = interpolate(scrollY.value, [0, 150], [1, 0], Extrapolation.CLAMP);

    return {
      opacity,
      transform: [{ translateY }, { scale }],
    };
  });

  // Clear + re-fetch transactions when wallet/chain changes
  useEffect(() => {
    if (!address || !activeChain) {
      return;
    }
    // Clear stale transactions from the previous chain before fetching new ones
    useTransactionStore.getState().clearTransactions();
    refreshTransactions();
  }, [address, activeChain?.key, refreshTransactions]);

  // Pull to refresh
  const onRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRefreshing(true);
    try {
      await Promise.all([refreshMarketData(), refreshBalance(), refreshTransactions()]);
    } catch (error) {
      console.warn("Failed to refresh:", error);
    }
    setRefreshing(false);
  }, [refreshBalance, refreshTransactions, refreshMarketData]);

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";

  const handleSend = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (activeChain?.type !== 'evm' && activeChain?.type !== 'svm' && activeChain?.type !== 'mvm' && activeChain?.type !== 'xlm') {
      toast.show(`Send is not yet available for ${activeChain?.name || 'this chain'}. Coming soon!`, 'info');
      return;
    }
    navigation.navigate(SCREENS.SEND_PAYMENT, {});
  }, [activeChain, navigation, toast]);

  const handleReceive = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    navigation.navigate(SCREENS.RECEIVE_QR);
  }, [navigation]);

  const handleScanQR = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    navigation.navigate(SCREENS.QR_SCANNER);
  }, [navigation]);

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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

  const handleFaucet = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!activeChain || !activeChain.isTestnet) return;
    
    void (async () => {
      try {
        toast.show('Requesting testnet funds...', 'info');
        
        if (activeChain.key === 'stellar-testnet') {
          const res = await fetch(`https://friendbot.stellar.org/?addr=${address}`);
          if (!res.ok) throw new Error('Friendbot failed');
          toast.show('Funds received! Updating balance...', 'success');
          void onRefresh();
          return;
        } 
        
        if (activeChain.key === 'solana-devnet') {
          const res = await fetch('https://api.devnet.solana.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'requestAirdrop',
              params: [address, 1000000000] // 1 SOL
            })
          });
          if (!res.ok) throw new Error('Solana airdrop failed');
          toast.show('Funds received! Updating balance...', 'success');
          void onRefresh();
          return;
        }

        // Fallback to browser for networks requiring captchas or social logins
        let faucetUrl = '';
        if (activeChain.key === 'sepolia') {
          faucetUrl = 'https://sepoliafaucet.com/';
        } else if (activeChain.key === 'aptos-testnet') {
          faucetUrl = 'https://aptoslabs.com/testnet-faucet';
        } else {
          toast.show('No faucet available for this testnet', 'info');
          return;
        }

        const opened = await openExternalUrl(faucetUrl);
        if (!opened) {
          toast.show('Failed to open faucet link', 'error');
        }
      } catch (err) {
        toast.show('Failed to request funds. Try again later.', 'error');
      }
    })();
  };

  const handleChainSelect = (chain: (typeof SUPPORTED_CHAINS)[0]) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />

      <DashboardHeader onSettingsPress={handleSettings} />

      <View style={styles.animatedContent}>
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          refreshControl={
            <DashboardRefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              accentColor={colors.accent}
            />
          }
        >
          {/* Chain Selector Dropdown */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "spring", stiffness: 250, damping: 20, delay: getDelay(100) }}
          >
            <PressableOpacity
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
                  <Text style={styles.chainLabel}>
                    [ {activeChain?.symbol || "ETH"} • {activeChain?.isTestnet ? "TESTNET" : "MAINNET"} ]
                  </Text>
                  <Text style={styles.chainName}>
                    {activeChain?.name?.toUpperCase() || "ETHEREUM"}
                  </Text>
                </View>
                <View style={styles.chainSelectorRight}>
                  <Icon name="chevron-down" size={16} color={colors.accent} />
                </View>
              </View>
            </SovereignCard>
            </PressableOpacity>
          </MotiView>

          {/* Balance Card */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "spring", stiffness: 250, damping: 20, delay: getDelay(150) }}
            style={{ zIndex: -1 }} // Parallax pushed to background
          >
            <Animated.View style={balanceAnimatedStyle}>
              <DashboardBalanceCard
                isLoadingBalance={isLoadingBalance}
                balanceVisible={balanceVisible}
                onToggleVisibility={() => setBalanceVisible(!balanceVisible)}
                displayBalance={displayBalance}
                displayCrypto={displayCrypto}
                activeChain={activeChain}
                marketQuote={marketQuote}
              />
            </Animated.View>
          </MotiView>

          {/* Action Row */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "spring", stiffness: 250, damping: 20, delay: getDelay(200) }}
          >
            <DashboardQuickActions
              activeChain={activeChain}
              onSend={handleSend}
              onReceive={handleReceive}
              onScan={handleScanQR}
              onSwap={handleSwap}
              onFaucet={handleFaucet}
            />
          </MotiView>

          {/* Fiat Gateway Card */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "spring", stiffness: 250, damping: 20, delay: getDelay(250) }}
          >
            <FiatGatewayCard
              onOpenFiatGateway={handleOpenFiatGateway}
              visibleTransakOrder={visibleTransakOrder}
              transakOrderMeta={transakOrderMeta}
              visibleOnrampOrder={visibleOnrampOrder}
              onrampOrderMeta={onrampOrderMeta}
              clearLatestTransakOrder={clearLatestTransakOrder}
              clearLatestOnrampOrder={clearLatestOnrampOrder}
              formatTransakAmount={formatTransakAmount}
            />
          </MotiView>

          {/* Assets List */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "spring", stiffness: 250, damping: 20, delay: getDelay(300) }}
          >
            <TokenAssetsList 
              isLoading={isLoadingBalance}
              nativeBalance={nativeBalance}
              tokenBalances={tokenBalances}
              onSend={handleSend}
              onTokenPress={(symbol) => {
                if (activeChain?.key) {
                  navigation.navigate(SCREENS.TOKEN_DETAIL, { tokenSymbol: symbol, chainKey: activeChain.key });
                }
              }}
              fiatRate={fiatRate}
            />
          </MotiView>

          {/* Transactions */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "spring", stiffness: 250, damping: 20, delay: getDelay(350) }}
          >
            <RecentTransactionsList
              isLoading={isLoadingTransactions}
              transactions={displayTransactions}
              onSeeAll={() => navigation.navigate(SCREENS.TRANSACTION_HISTORY)}
              onTransactionPress={(item) => navigation.navigate(SCREENS.TRANSACTION_DETAILS, { transaction: item })}
              onSend={handleSend}
            />
          </MotiView>

          <View style={{ height: 140 }} />
        </Animated.ScrollView>
      </View>

      {/* Bottom Navigation Bar */}
      <BottomNavBar currentScreen={SCREENS.HOME} onNavigate={handleNavPress} />

      <FiatGatewayModal
        visible={showFiatGateway}
        onClose={() => setShowFiatGateway(false)}
        onBuy={handleBuyCrypto}
        onSell={handleSellCrypto}
        currentCurrency={nativeCurrency || 'USD'}
        onOpenCurrencySelector={() => {
          setShowFiatGateway(false);
          setShowCurrencySelector(true);
        }}
      />

      <CurrencySelectorModal
        visible={showCurrencySelector}
        activeCurrency={nativeCurrency || 'USD'}
        onSelect={(currency) => {
          setNativeCurrency(currency);
          setShowCurrencySelector(false);
          toast.show(`Native currency set to ${currency}`, "success");
        }}
        onClose={() => setShowCurrencySelector(false)}
      />

      <NetworkSelectorModal
        visible={showChainSelector}
        activeChain={activeChain}
        chains={SUPPORTED_CHAINS}
        onSelect={handleChainSelect}
        onClose={() => setShowChainSelector(false)}
        onAddCustomNetwork={() => {
          setShowChainSelector(false);
          navigation.navigate(SCREENS.ADD_CUSTOM_NETWORK);
        }}
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

export default HomeDashboardScreen;
