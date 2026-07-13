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
import { BottomNavBar } from "../components/BottomNavBar";
import { Icon } from "../components/Icon";
import { BalanceSkeleton, TransactionSkeleton } from "../components/Skeleton";
import { RecentTransactionsList } from "../components/dashboard/RecentTransactionsList";
import { TokenAssetsList } from "../components/dashboard/TokenAssetsList";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { FiatGatewayCard } from "../components/dashboard/FiatGatewayCard";
import { TransactionItem } from '../components/TransactionItem';
import {
  DashboardBalanceCard,
  type PrivacyReadyStatus,
} from '../components/home/DashboardBalanceCard';
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
import { useFocusEffect, type RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "../stores/settingsStore";
import {
  getPrivacyAssetById,
  getPrivacyAssetsForChain,
  canActivatePrivacyAsset,
} from "../constants/privacyAssets";
import { getLocalPrivateBalance } from "../utils/stellarSpp";
import { filterTransactionsForPrivacyMode } from "../utils/transactionPrivacyFilter";
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
    addresses,
    activeChain,
    setActiveChain,
    balance,
    balanceUsd,
  } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      addresses: state.addresses,
      activeChain: state.activeChain,
      setActiveChain: state.setActiveChain,
      balance: state.balance,
      balanceUsd: state.balanceUsd,
    }))
  );

  /** Stellar G… for SPP — never use EVM `address` after a chain switch race. */
  const stellarOwnerAddress = useMemo(() => {
    const fromMap = addresses?.xlm;
    if (typeof fromMap === 'string' && /^G[A-Z2-7]{55}$/.test(fromMap)) return fromMap;
    if (typeof address === 'string' && /^G[A-Z2-7]{55}$/.test(address)) return address;
    return null;
  }, [address, addresses]);

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
  /** Soft private readiness for balance card (no protocol jargon). */
  const [privacyReadyStatus, setPrivacyReadyStatus] =
    useState<PrivacyReadyStatus>(null);
  /** On-card recovery / setup line (visible even if toast is missed). */
  const [privacyStatusDetail, setPrivacyStatusDetail] = useState<string | null>(null);
  /** Tracks last amount we showed so we can soft-update without skeleton thrash. */
  const privateBalanceRef = useRef('0');
  privateBalanceRef.current = privateBalance;
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const lastTxFocusRefreshAtRef = useRef(0);
  const privateRefreshInFlightRef = useRef(false);

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

  /**
   * Private balance refresh.
   * - lightOnly / focus / Settings→Home: SecureStore + last-known only (never native).
   * - forceRecover: pull-to-refresh, pXLM select.
   * - First enter: one smart recover (session-gated).
   */
  const refreshPrivateBalance = useCallback(
    async (opts?: {
      announce?: boolean;
      forceRecover?: boolean;
      /** Never open native pool — focus / remount safe. */
      lightOnly?: boolean;
    }) => {
      if (!privacyMode || !privacyAsset || !stellarOwnerAddress) {
        setPrivateBalance('0');
        setPrivateBalanceLoading(false);
        return;
      }
      if (privateRefreshInFlightRef.current && !opts?.forceRecover) {
        return;
      }

      const announce = opts?.announce === true;
      const forceRecover = opts?.forceRecover === true;
      const lightOnly = opts?.lightOnly === true;
      const chainKey = privacyAsset.chainKey;
      const owner = stellarOwnerAddress;

      privateRefreshInFlightRef.current = true;
      try {
        const {
          readLocalPrivateBalanceLight,
          refreshPrivateBalanceSmart,
          getLastKnownPrivateAmount,
          setLastKnownPrivateAmount,
          hasRecoveredThisSession,
        } = await import('../utils/stellarSpp');

        // Restore last-known immediately so Settings→Home never skeleton-loops at 0.
        const cached = getLastKnownPrivateAmount(chainKey, owner);
        if (cached && Number.parseFloat(cached) > 0) {
          setPrivateBalance(cached);
        }

        const local = await readLocalPrivateBalanceLight(chainKey, owner);
        const localAmt = local.amount || cached || '0';
        if (Number.parseFloat(localAmt) > 0) {
          setPrivateBalance(localAmt);
          setLastKnownPrivateAmount(chainKey, owner, localAmt);
        }

        if (lightOnly) {
          setPrivateBalance(localAmt);
          setPrivateBalanceLoading(false);
          return;
        }

        // Already recovered this session and not forced → local only.
        if (!forceRecover && hasRecoveredThisSession(chainKey, owner)) {
          setPrivateBalance(localAmt);
          setPrivateBalanceLoading(false);
          return;
        }

        const hadDisplay =
          Number.parseFloat(privateBalanceRef.current || '0') > 0 ||
          Number.parseFloat(localAmt) > 0;
        // Skeleton only on first paint with nothing to show.
        if (!hadDisplay && forceRecover) {
          setPrivateBalanceLoading(true);
        } else if (!hadDisplay && !hasRecoveredThisSession(chainKey, owner)) {
          setPrivateBalanceLoading(true);
        }

        const result = await refreshPrivateBalanceSmart(chainKey, owner, {
          force: forceRecover,
        });
        const amt = result.amount || result.nativeAmount || localAmt || '0';
        const amtNum = Number.parseFloat(amt);
        setPrivateBalance(amt);
        setLastKnownPrivateAmount(chainKey, owner, amt);

        if (result.recovered) {
          if (amtNum > 0) {
            const isRestoreMsg =
              /recover|restor|chain/i.test(result.message || '') && forceRecover;
            if (isRestoreMsg) {
              setPrivacyStatusDetail(`Restored ${amt} pXLM`);
            }
            if (announce && isRestoreMsg) {
              toastRef.current.show(`Private balance restored: ${amt} pXLM`, 'success');
            }
          } else if (announce && forceRecover) {
            setPrivacyStatusDetail(
              result.message || 'Synced — no pXLM found for this seed yet'
            );
            toastRef.current.show(
              result.message ||
                'Synced private pool — no pXLM found for this seed yet',
              'info'
            );
          }
          return;
        }

        const isLinkFail =
          /UnsatisfiedLinkError|JNI_SYMBOL_MISSING|No implementation found|outdated/i.test(
            result.message || ''
          );
        setPrivacyStatusDetail(
          isLinkFail
            ? 'Private sync needs an updated app build'
            : result.message || 'Could not restore private balance'
        );
        if (announce && !isLinkFail) {
          toastRef.current.show(
            result.message || 'Could not restore private balance',
            'error'
          );
        }
      } catch (e) {
        try {
          const { amount } = await getLocalPrivateBalance(
            privacyAsset.chainKey,
            stellarOwnerAddress
          );
          setPrivateBalance(amount);
        } catch {
          /* keep previous */
        }
        const msg =
          e instanceof Error ? e.message : 'Private balance refresh failed';
        setPrivacyStatusDetail(msg);
        if (announce) toastRef.current.show(msg, 'error');
      } finally {
        privateRefreshInFlightRef.current = false;
        setPrivateBalanceLoading(false);
      }
    },
    [stellarOwnerAddress, privacyAsset, privacyMode]
  );

  // Private mode mount / remount: prefer cache + light path; one smart recover per session max.
  useEffect(() => {
    if (!privacyMode || !privacyAsset || !stellarOwnerAddress) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const {
        hasRecoveredThisSession,
        getLastKnownPrivateAmount,
      } = await import('../utils/stellarSpp');
      if (cancelled) return;
      const cached = getLastKnownPrivateAmount(
        privacyAsset.chainKey,
        stellarOwnerAddress
      );
      if (cached && Number.parseFloat(cached) > 0) {
        setPrivateBalance(cached);
      }
      // Settings → Home remount must not re-open native pool.
      if (hasRecoveredThisSession(privacyAsset.chainKey, stellarOwnerAddress)) {
        await refreshPrivateBalance({ lightOnly: true, announce: false });
        return;
      }
      await refreshPrivateBalance({ forceRecover: false, announce: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [privacyMode, privacyAsset?.id, stellarOwnerAddress, refreshPrivateBalance]);

  // Focus: light private balance only + debounced silent history (no skeleton spam).
  useFocusEffect(
    useCallback(() => {
      if (privacyMode) {
        void refreshPrivateBalance({ lightOnly: true, announce: false });
      }
      if (address && activeChain?.key) {
        const now = Date.now();
        // Debounce: don't re-hit Horizon/indexers on every Settings bounce.
        if (now - lastTxFocusRefreshAtRef.current > 45_000) {
          lastTxFocusRefreshAtRef.current = now;
          void refreshTransactions({ silent: true });
        }
      }
    }, [
      address,
      activeChain?.key,
      privacyMode,
      refreshPrivateBalance,
      refreshTransactions,
    ])
  );

  // Quiet readiness probe for private mode.
  // Sticky ready: once ASP is ready, do not flip back to "Setting up…" on re-probe races.
  const [privacyReadyTick, setPrivacyReadyTick] = useState(0);
  useEffect(() => {
    if (!privacyMode || !privacyAsset || !stellarOwnerAddress) {
      setPrivacyReadyStatus(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { sppNativeCapabilities } = await import('../utils/stellarSpp');
        const { getSppAccount } = await import('../stores/sppAccountStore');
        const caps = sppNativeCapabilities();
        if (!caps.poolOps) {
          if (!cancelled) setPrivacyReadyStatus('unavailable');
          return;
        }
        const account = await getSppAccount(
          privacyAsset.chainKey,
          stellarOwnerAddress
        ).catch(() => null);
        if (cancelled) return;
        if (account?.aspInserted) {
          setPrivacyReadyStatus('ready');
        } else {
          // Do not downgrade an already-ready card (select path set ready before store catch-up).
          setPrivacyReadyStatus((prev) =>
            prev === 'ready' ? 'ready' : 'setting_up'
          );
        }
      } catch {
        if (!cancelled) {
          setPrivacyReadyStatus((prev) => (prev === 'ready' ? 'ready' : null));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stellarOwnerAddress, privacyAsset, privacyMode, privacyReadyTick]);

  // If user left the pool's chain, clear privacy home mode (keep selection only when chain matches).
  useEffect(() => {
    if (!selectedPrivacyAssetId) return;
    const asset = getPrivacyAssetById(selectedPrivacyAssetId);
    if (asset && activeChain?.key && asset.chainKey !== activeChain.key) {
      setSelectedPrivacyAssetId(null);
    }
  }, [activeChain?.key, selectedPrivacyAssetId, setSelectedPrivacyAssetId]);

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

  // Clear + re-fetch transactions when wallet/chain changes (not on every focus).
  useEffect(() => {
    if (!address || !activeChain) {
      return;
    }
    // Clear stale transactions from the previous chain before fetching new ones
    useTransactionStore.getState().clearTransactions();
    lastTxFocusRefreshAtRef.current = Date.now();
    void refreshTransactions({ silent: false });
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- key on activeChain.key (stable primitive), NOT the activeChain object. The object identity is unstable across store rehydration, so depending on it clears + refetches transactions every render → visible reload loop. The chain key is the real dependency.
  }, [address, activeChain?.key, refreshTransactions]);

  // Pull to refresh — force full private recover (user intent) without toast spam.
  const onRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRefreshing(true);
    try {
      lastTxFocusRefreshAtRef.current = Date.now();
      // Silent public balance: RefreshControl spinner already signals activity.
      await Promise.all([
        refreshMarketData(),
        refreshBalance({ silent: true }),
        refreshTransactions({ silent: true }),
        privacyMode
          ? refreshPrivateBalance({ forceRecover: true, announce: false })
          : Promise.resolve(),
      ]);
    } catch (error) {
      console.warn("Failed to refresh:", error);
    }
    setRefreshing(false);
  }, [
    refreshBalance,
    refreshTransactions,
    refreshMarketData,
    refreshPrivateBalance,
    privacyMode,
  ]);

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
      setPrivacyStatusDetail(null);
      toast.show(`${asset.name} selected`, 'success');

      // Privacy setup + chain note recovery (DATA-001) when selecting pXLM.
      // Always use multi-chain Stellar G… — active `address` can still be 0x… after setActiveChain.
      if (asset.protocol === 'spp') {
        const owner =
          (typeof addresses?.xlm === 'string' && /^G[A-Z2-7]{55}$/.test(addresses.xlm)
            ? addresses.xlm
            : null) ||
          (typeof address === 'string' && /^G[A-Z2-7]{55}$/.test(address) ? address : null);

        if (!owner) {
          setPrivacyStatusDetail('Stellar address not ready — re-select pXLM');
          toast.show('Stellar address not ready yet — wait a moment and re-select pXLM', 'error');
          return;
        }

        setPrivacyReadyStatus('setting_up');
        setPrivacyStatusDetail('Setting up private keys…');

        void import('../utils/stellarSpp')
          .then(async ({ ensureSppAccountReady, refreshPrivateBalanceSmart }) => {
            const result = await ensureSppAccountReady(asset.chainKey, owner);
            // Subtle on-card confirmation (user-visible even if toast is occluded).
            if (result.aspReady) {
              setPrivacyReadyStatus('ready');
              setPrivacyStatusDetail('Private XLM ready — restoring balance…');
              toast.show('Private XLM ready', 'success');
            } else if (result.hasLeaf) {
              setPrivacyReadyStatus('setting_up');
              setPrivacyStatusDetail(result.message || 'Registering ASP membership…');
              toast.show(
                result.message || 'Privacy keys ready — register ASP if needed',
                'info'
              );
            } else {
              setPrivacyReadyStatus('setting_up');
              setPrivacyStatusDetail(result.message || 'Preparing private keys…');
              toast.show(result.message || 'Preparing private keys…', 'info');
            }
            setPrivacyReadyTick((t) => t + 1);

            // One coordinated full recover on select (not every focus).
            const { setLastKnownPrivateAmount } = await import('../utils/stellarSpp');
            const recovery = await refreshPrivateBalanceSmart(asset.chainKey, owner, {
              force: true,
            });
            const amt = recovery.amount || recovery.nativeAmount || '0';
            const amtNum = parseFloat(amt);
            setLastKnownPrivateAmount(asset.chainKey, owner, amt);
            if (recovery.recovered && amtNum > 0) {
              setPrivateBalance(amt);
              setPrivacyReadyStatus('ready');
              setPrivacyStatusDetail(`Restored ${amt} pXLM`);
              toast.show(`Private balance restored: ${amt} pXLM`, 'success');
            } else if (recovery.recovered) {
              setPrivateBalance(amt);
              setPrivacyStatusDetail(
                recovery.message || 'Synced — no pXLM found for this seed yet'
              );
              toast.show(
                recovery.message ||
                  'Synced private pool — no pXLM found for this seed yet',
                'info'
              );
            } else {
              setPrivacyStatusDetail(
                recovery.message || 'Could not restore private balance'
              );
              toast.show(
                recovery.message || 'Could not restore private balance',
                'error'
              );
            }
            return recovery;
          })
          .catch((e) => {
            const msg = e instanceof Error ? e.message : 'Private setup failed';
            setPrivacyStatusDetail(msg);
            toast.show(msg, 'error');
          });
      }
    },
    [
      activeChain?.key,
      address,
      addresses,
      setActiveChain,
      setSelectedPrivacyAssetId,
      toast,
    ]
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
  const displayTransactions = useMemo(
    () =>
      filterTransactionsForPrivacyMode(transactions, {
        privacyMode,
        privacyChainKey: privacyAsset?.chainKey,
        publicChainKey: activeChain?.key,
      }),
    [activeChain?.key, privacyAsset?.chainKey, privacyMode, transactions]
  );
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
    // SEC-005: poll status with the opaque signed token, not the raw order UUID.
    if (!visibleOnrampOrder?.statusToken) {
      return;
    }

    if (visibleOnrampOrder.status !== 'pending' && visibleOnrampOrder.status !== 'processing') {
      return;
    }

    const syncOrderStatus = async () => {
      await checkOrderStatus(visibleOnrampOrder.statusToken as string);
    };

    void syncOrderStatus();
    const intervalId = setInterval(syncOrderStatus, 15000);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkOrderStatus, visibleOnrampOrder?.statusToken, visibleOnrampOrder?.status]);

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
                          {privacyMode
                            ? `[ ${privacyAsset?.symbol || 'pXLM'} · ${activeChain?.isTestnet ? 'TESTNET' : 'MAINNET'} ]`
                            : `[ ${activeChain?.symbol || 'ETH'} · ${activeChain?.isTestnet ? 'TESTNET' : 'MAINNET'} ]`}
                        </Text>
                        <Text style={styles.chainName}>
                          {privacyMode
                            ? (privacyAsset?.name || 'Private XLM').toUpperCase()
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
                privacyReadyStatus={privacyMode ? privacyReadyStatus : null}
                privacyStatusDetail={privacyMode ? privacyStatusDetail : null}
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
              privateMode={privacyMode}
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

      {/* Toast above bottom nav (zIndex/elevation set in Toast styles). */}
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        duration={4500}
        onDismiss={toast.hide}
      />
    </SafeAreaView>
  );
}

export default HomeDashboardScreen;
