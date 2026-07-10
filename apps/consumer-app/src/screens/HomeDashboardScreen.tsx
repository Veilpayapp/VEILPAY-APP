/* istanbul ignore file */
/**
 * Veilpay Home Dashboard Screen (C3)
 * Main wallet dashboard with balance, actions, and transaction history
 * Uses the current hybrid structural design language for all interactive elements
 *
 * UPDATED: Now includes BottomNavBar, dynamic data, and price feed integration
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { MotiView } from "moti";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "../stores/settingsStore";
import {
  getPrivacyAssetById,
  getPrivacyAssetsForChain,
  canActivatePrivacyAsset,
} from "../constants/privacyAssets";
import { getLocalPrivateBalance } from "../utils/stellarSpp";
import type { PrivacyAssetListItem } from "../components/dashboard/TokenAssetsList";

const TRANSAK_OUTCOME_TTL_MS = 24 * 60 * 60 * 1000;

type HomeDashboardScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, "Home">;
type HomeDashboardRouteProp = RouteProp<RootStackParamList, "Home">;

interface HomeDashboardScreenProps {
  navigation: HomeDashboardScreenNavigationProp;
  route: HomeDashboardRouteProp;
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

  const {
    nativeCurrency,
    setNativeCurrency,
    selectedPrivacyAssetId,
    setSelectedPrivacyAssetId,
  } = useSettingsStore(
    useShallow((state) => ({
      nativeCurrency: state.nativeCurrency,
      setNativeCurrency: state.setNativeCurrency,
      selectedPrivacyAssetId: state.selectedPrivacyAssetId,
      setSelectedPrivacyAssetId: state.setSelectedPrivacyAssetId,
    }))
  );

  const [privateBalance, setPrivateBalance] = useState('0');
  const [privateBalanceLoading, setPrivateBalanceLoading] = useState(false);

  const privacyAsset = useMemo(
    () => getPrivacyAssetById(selectedPrivacyAssetId),
    [selectedPrivacyAssetId]
  );
  const privacyMode = !!privacyAsset && canActivatePrivacyAsset(privacyAsset);

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

  const activeMarketSymbol = (
    privacyMode ? privacyAsset?.quoteSymbol : activeChain?.symbol
  )?.toUpperCase() || "ETH";
  const { getQuote: getMarketQuote, refresh: refreshMarketData } = useMarketData([activeMarketSymbol]);
  const marketQuote = getMarketQuote(activeMarketSymbol);

  const refreshPrivateBalance = useCallback(async () => {
    if (!privacyMode || !privacyAsset || !address) {
      setPrivateBalance('0');
      return;
    }
    setPrivateBalanceLoading(true);
    try {
      const { amount } = await getLocalPrivateBalance(privacyAsset.chainKey, address);
      setPrivateBalance(amount);
    } finally {
      setPrivateBalanceLoading(false);
    }
  }, [address, privacyAsset, privacyMode]);

  useEffect(() => {
    void refreshPrivateBalance();
  }, [refreshPrivateBalance]);

  // If user left the pool's chain, clear privacy home mode (keep selection only when chain matches).
  useEffect(() => {
    if (!selectedPrivacyAssetId) return;
    const asset = getPrivacyAssetById(selectedPrivacyAssetId);
    if (asset && activeChain?.key && asset.chainKey !== activeChain.key) {
      setSelectedPrivacyAssetId(null);
    }
  }, [activeChain?.key, selectedPrivacyAssetId, setSelectedPrivacyAssetId]);

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
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- key on activeChain.key (stable primitive), NOT the activeChain object. The object identity is unstable across store rehydration, so depending on it clears + refetches transactions every render → visible reload loop. The chain key is the real dependency.
  }, [address, activeChain?.key, refreshTransactions]);

  // Pull to refresh
  const onRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRefreshing(true);
    try {
      // Silent balance refresh: the RefreshControl spinner already signals
      // activity, so don't also flash the balance-card skeleton.
      await Promise.all([
        refreshMarketData(),
        refreshBalance({ silent: true }),
        refreshTransactions(),
        refreshPrivateBalance(),
      ]);
    } catch (error) {
      console.warn("Failed to refresh:", error);
    }
    setRefreshing(false);
  }, [refreshBalance, refreshTransactions, refreshMarketData, refreshPrivateBalance]);

  // NOTE: This must be a real <RefreshControl> element, NOT a custom wrapper
  // component. On Android, ScrollView.render() does
  // `cloneElement(refreshControl, { style }, <NativeScrollView>{content}</…>)`,
  // passing all scroll content as the element's children + injecting a style
  // prop. A wrapper component that ignores children/style silently drops the
  // entire dashboard (blank screen). See RN ScrollView.js (Platform.OS ==='android').
  const refreshControlEl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={colors.accent}
        colors={[colors.accent]}
      />
    ),
    [refreshing, onRefresh, colors.accent]
  );

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";

  const navigatePrivateSend = useCallback(
    (mode: 'shield' | 'transfer' | 'unshield') => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (!privacyAsset || !canActivatePrivacyAsset(privacyAsset)) {
        toast.show('Private XLM is not available on this network', 'info');
        return;
      }
      navigation.navigate(SCREENS.SEND_PAYMENT, {
        mode,
        forcePrivate: true,
        privacyAssetId: privacyAsset.id,
        lockMode: true,
      });
    },
    [navigation, privacyAsset, toast]
  );

  const handleSend = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (privacyMode && privacyAsset) {
      navigatePrivateSend('transfer');
      return;
    }
    if (activeChain?.type !== 'evm' && activeChain?.type !== 'svm' && activeChain?.type !== 'xlm') {
      toast.show(`Send is not yet available for ${activeChain?.name || 'this chain'}. Coming soon!`, 'info');
      return;
    }
    navigation.navigate(SCREENS.SEND_PAYMENT, {});
  }, [activeChain, navigation, navigatePrivateSend, privacyAsset, privacyMode, toast]);

  const handleReceive = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    navigation.navigate(SCREENS.RECEIVE_QR);
  }, [navigation]);

  const handleSelectPrivacyAsset = useCallback(
    (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const asset = getPrivacyAssetById(id);
      if (!asset || !canActivatePrivacyAsset(asset)) {
        toast.show(asset?.disabledReason || 'Privacy asset not available', 'info');
        return;
      }
      // Ensure wallet network matches the pool chain.
      if (activeChain?.key !== asset.chainKey) {
        const chain = SUPPORTED_CHAINS.find((c) => c.key === asset.chainKey);
        if (chain) {
          setActiveChain(chain);
          toast.show(`Switched to ${chain.name}`, 'success');
        }
      }
      setSelectedPrivacyAssetId(id);
      toast.show(`${asset.name} selected`, 'success');

      // Privacy setup is part of selecting the token — not a Settings detour.
      if (asset.protocol === 'spp' && address) {
        void import('../utils/stellarSpp')
          .then(({ ensureSppAccountReady }) =>
            ensureSppAccountReady(asset.chainKey, address).then((result) => {
              if (result.aspReady) {
                toast.show('Private XLM ready', 'success');
              } else if (result.hasLeaf) {
                toast.show(
                  result.message || 'Privacy keys ready — register ASP if needed',
                  'info'
                );
              }
              return result;
            })
          )
          .catch(() => {
            /* non-blocking; shield path retries */
          });
      }
    },
    [activeChain?.key, address, setActiveChain, setSelectedPrivacyAssetId, toast]
  );

  const handleExitPrivacyMode = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedPrivacyAssetId(null);
    toast.show('Showing public balance', 'info');
  }, [setSelectedPrivacyAssetId, toast]);

  const privacyListItems: PrivacyAssetListItem[] = useMemo(() => {
    const catalog = getPrivacyAssetsForChain(activeChain?.key);
    return catalog.map((a) => ({
      id: a.id,
      name: a.name,
      symbol: a.symbol,
      // Show local note total when this asset is active; otherwise placeholder
      // until selection (avoids N parallel SecureStore reads on every render).
      balance: selectedPrivacyAssetId === a.id ? privateBalance || '0' : a.enabled ? '···' : '0',
      subtitle: a.subtitle,
      icon: a.icon,
      enabled: canActivatePrivacyAsset(a),
      selected: selectedPrivacyAssetId === a.id,
      disabledReason: a.disabledReason,
    }));
  }, [activeChain?.key, privateBalance, selectedPrivacyAssetId]);

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

  // Display values — privacy mode uses local shielded notes (fiat via quote price).
  const publicDisplayBalance = balanceUsd || "0.00";
  const publicDisplayCrypto = balance || "0.000";
  const privateFiat =
    marketQuote?.price != null
      ? (parseFloat(privateBalance || '0') * marketQuote.price * (fiatRate || 1)).toFixed(2)
      : '0.00';
  const displayBalance = privacyMode ? privateFiat : publicDisplayBalance;
  const displayCrypto = privacyMode ? privateBalance || '0' : publicDisplayCrypto;
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
          refreshControl={refreshControlEl}
        >
          {/* Chain selector — stable mount; gold 1px on card edge only in privacy mode */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 280, delay: getDelay(100) }}
          >
            <View style={styles.chainSelectorWrapper}>
              <PressableOpacity
                onPress={() => setShowChainSelector(true)}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel={`Network: ${activeChain?.name || 'Ethereum'}${privacyMode ? ', private mode' : ''}`}
                accessibilityHint="Opens network selector to change blockchain network"
              >
                <View
                  style={[
                    styles.chainSelectorCardFrame,
                    privacyMode && styles.chainSelectorCardFramePrivate,
                  ]}
                >
                  <SovereignCard backgroundColor={colors.bgSecondary} padding={0}>
                    <View style={styles.chainSelectorContent}>
                      <View style={styles.chainSelectorLeft}>
                        <Text style={styles.chainLabel}>
                          [ {privacyMode ? privacyAsset?.symbol || 'pXLM' : activeChain?.symbol || 'ETH'} •{' '}
                          {activeChain?.isTestnet ? 'TESTNET' : 'MAINNET'}
                          {privacyMode ? ' • PRIVATE' : ''} ]
                        </Text>
                        <Text style={styles.chainName}>
                          {privacyMode
                            ? (privacyAsset?.name || 'PRIVATE XLM').toUpperCase()
                            : activeChain?.name?.toUpperCase() || 'ETHEREUM'}
                        </Text>
                      </View>
                      <View style={styles.chainSelectorRight}>
                        <Icon name="chevron-down" size={16} color={colors.accent} />
                      </View>
                    </View>
                  </SovereignCard>
                </View>
              </PressableOpacity>
            </View>
          </MotiView>

          {/* Balance — soft fade only (no scale/bounce on mode switch) */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 280, delay: getDelay(140) }}
            style={{ zIndex: -1 }}
          >
            <Animated.View style={balanceAnimatedStyle}>
              <DashboardBalanceCard
                isLoadingBalance={privacyMode ? privateBalanceLoading : isLoadingBalance}
                balanceVisible={balanceVisible}
                onToggleVisibility={() => setBalanceVisible(!balanceVisible)}
                displayBalance={displayBalance}
                displayCrypto={displayCrypto}
                activeChain={activeChain}
                marketQuote={marketQuote}
                privacyMode={privacyMode}
                cryptoSymbol={privacyMode ? privacyAsset?.symbol : activeChain?.symbol}
                privacyFeatures={privacyMode ? privacyAsset?.features : undefined}
              />
            </Animated.View>
          </MotiView>

          {/* Actions — short fade, no spring bounce */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 240, delay: getDelay(180) }}
          >
            <DashboardQuickActions
              activeChain={activeChain}
              onSend={handleSend}
              onReceive={handleReceive}
              onScan={handleScanQR}
              onSwap={handleSwap}
              onFaucet={handleFaucet}
              privacyMode={privacyMode}
              onShield={() => navigatePrivateSend('shield')}
              onPrivateTransfer={() => navigatePrivateSend('transfer')}
              onUnshield={() => navigatePrivateSend('unshield')}
              onExitPrivacy={handleExitPrivacyMode}
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
              onSend={(symbol) => {
                setSelectedPrivacyAssetId(null);
                handleSend();
              }}
              onTokenPress={(symbol) => {
                setSelectedPrivacyAssetId(null);
                if (activeChain?.key) {
                  navigation.navigate(SCREENS.TOKEN_DETAIL, { tokenSymbol: symbol, chainKey: activeChain.key });
                }
              }}
              fiatRate={fiatRate}
              privacyAssets={privacyListItems}
              selectedPrivacyAssetId={selectedPrivacyAssetId}
              onPrivacyAssetPress={handleSelectPrivacyAsset}
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
