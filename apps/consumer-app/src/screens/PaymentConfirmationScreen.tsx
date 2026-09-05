/**
 * Veilpay Payment Confirmation Screen
 *
 * Final confirmation screen before sending a payment.
 *
 * Privacy-stack integration (task 11.1):
 * The send dispatch is delegated to {@link usePaymentTransaction}, which
 * implements the canonical `switch (privacyLevel)` path:
 *
 *   - `'standard'` → direct on-chain transfer
 *   - `'stealth'`  → ECDH stealth address + `StealthAnnouncer.announce`
 *   - `'max'`      → ZK proof via {@link ZkpProver} + relayer broadcast
 *   - `'private'`  → Stellar SPP shielded transfer (`utils/stellarSpp`)

 *
 * The legacy inline mock dispatch (which only handled the `'standard'`
 * shape against `signAndSendTransaction`) has been removed in favor of
 * the typed dispatcher so that picking `'stealth'` or `'max'` on the
 * privacy-level screen actually flows through the privacy stack.
 *
 * Requirements: 5.5, 13.2, 13.3 — no zero-address fallbacks, all contract
 * addresses sourced from `constants/contracts.ts`, privacy stack disabled
 * when not configured.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar, ActivityIndicator, Linking } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { parseEther } from 'viem';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { useWalletStore } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from '../components/Toast';
import { Logo } from '../components/Logo';
import { Skeleton } from '../components/Skeleton';
import { Icon } from '../components/Icon';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { NetworkStatusBanner } from '../components/NetworkStatusBanner';
import { ZkpProver, type ZkpProverRef } from '../components/ZkpProver';
import { ShieldProgressModal } from '../components/spp/ShieldProgressModal';
import { FeeBreakdownCard } from '../components/spp/FeeBreakdownCard';
import { deriveAddressFromStoredMnemonic } from '../utils/secureSigner';
import {
  getExplorerUrl,
  getFaucetUrl,
  NETWORKS,
} from '../utils/transactions';
import { estimateTransactionGas, isGasExpensive, type GasEstimate } from '../utils/gasEstimator';
import { fetchNativeBalance } from '../utils/balanceFetcher';
import { TransactionResultModal } from '../components/payment/TransactionResultModal';
import type { UiTxStatus } from '../components/payment/TransactionStatusCard';
import { FALLBACK_PRICES, getFiatExchangeRate, formatFiatValue, formatLastUpdated } from '../utils/priceFeed';
import { resolveMarketQuoteSymbol } from '../utils/marketData';
import { triggerLightImpactHaptic } from '../utils/haptics';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useSettingsStore } from '../stores/settingsStore';
import { useMarketData } from '../hooks/useMarketData';
import { usePaymentTransaction } from '../hooks/usePaymentTransaction';
import { sppPlannedTxCount } from '../utils/stellarSpp/sppFees';
import { derivePaymentFeeView } from '../utils/paymentFees';
import { computeStellarMinReserveXlm } from '../utils/stellarSigner';
import {
  recordSppProgressDiagnostic,
  resetSppProgress,
} from '../utils/stellarSpp/sppProgressSubscriber';

type PaymentConfirmationScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'PaymentConfirmation'>;
type PaymentConfirmationScreenRoute = RouteProp<RootStackParamList, 'PaymentConfirmation'>;

interface PaymentConfirmationScreenProps {
  navigation: PaymentConfirmationScreenNavigationProp;
  route: PaymentConfirmationScreenRoute;
}

const formatAddress = (addr: string) => {
  if (!addr) return 'Not available';
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
};

export function PaymentConfirmationScreen({ navigation, route }: PaymentConfirmationScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const hasMnemonicRef = useRef<boolean | null>(null);
  const [priceError] = useState<string | null>(null);
  const [localGasEstimate, setLocalGasEstimate] = useState<GasEstimate | null>(null);
  const [localGasExpensive, setLocalGasExpensive] = useState(false);
  const [fiatRate, setFiatRate] = useState(1);
  // Native balance for the *actual* selected network, used for the
  // pre-send insufficient-funds gate. `null` = not yet loaded / unknown.
  // We only ever block the send when the read is reliable (see
  // `balanceReliable` below) so a flaky RPC never falsely blocks a payment.
  const [nativeBalance, setNativeBalance] = useState<{
    amount: number;
    reliable: boolean;
    subentryCount?: number;
  } | null>(null);
  const isMountedRef = useRef(true);
  const zkpProverRef = useRef<ZkpProverRef | null>(null);

  const { activeChain, address, addresses } = useWalletStore();
  const { nativeCurrency } = useSettingsStore();
  const toast = useToast();
  const { isConnected } = useNetworkStatus();

  const isSendSupported = true; // Support UI progression for all chains

  // Honor the user's selected chain. Previously this screen silently
  // remapped any mainnet selection to a testnet equivalent when
  // EXPO_PUBLIC_ENABLE_MAINNET_TRANSACTIONS was off — which meant a user
  // who picked Ethereum Mainnet actually transacted on Sepolia, with the
  // banner flipping to "TESTNET MODE" on the confirm page. That silent
  // switch is gone: the confirm screen now sends on exactly the network
  // the user chose. Insufficient funds (the common case on an unfunded
  // mainnet) is surfaced explicitly via the pre-send balance check below.
  const activeNetworkKey = useMemo(() => {
    const chainKey = activeChain?.key;
    const chainType = activeChain?.type || 'evm';

    // Only fall back when the selected chain genuinely has no network
    // config (e.g. a malformed custom chain). We pick a same-VM testnet so
    // gas/explorer/faucet lookups still resolve rather than crashing.
    const getSafeFallback = (type: string) => {
      switch (type) {
        case 'svm': return 'solana-devnet';
        case 'xlm': return 'stellar-testnet';
        default: return 'sepolia';
      }
    };

    if (!chainKey || !NETWORKS[chainKey]) {
      return getSafeFallback(chainType);
    }

    return chainKey;
  }, [activeChain?.key, activeChain?.type]);

  const selectedNetwork = NETWORKS[activeNetworkKey];
  const faucetUrl = getFaucetUrl(activeNetworkKey);

  // Payment data from previous screens
  const recipient = route?.params?.recipient || '';
  const amount = route?.params?.amount || '';
  const memo = route?.params?.memo || '';
  const token = route?.params?.token || 'ETH';
  const tokenAddress = route?.params?.tokenAddress;
  const tokenDecimals = route?.params?.tokenDecimals;
  const privacyLevel = route?.params?.privacyLevel || 'standard';
  const sppOp = route?.params?.sppOp || 'transfer';

  // Live token price is derived from the market-data hook rather than mirrored
  // into local state via an effect (which would flash a stale value).
  // Privacy tickers (pXLM) have no separate spot market — quote the public
  // underlying (XLM) so unshield/transfer confirm never sticks on "(cached)".
  const quoteSymbol = resolveMarketQuoteSymbol(token);
  const { getQuote, isLoading: isQuoteLoading } = useMarketData([quoteSymbol]);
  const marketQuote = getQuote(quoteSymbol);
  const tokenPrice = marketQuote ? marketQuote.price : null;
  const priceLoading = isQuoteLoading;
  const lastUpdated = marketQuote ? marketQuote.lastUpdated : null;
  const isStale = marketQuote ? marketQuote.isStale : true;
  const fallbackPrice =
    FALLBACK_PRICES[quoteSymbol] ?? FALLBACK_PRICES[token] ?? 0;

  // -----------------------------------------------------------------
  // SPP prove-readiness gate for `'private'` sends.
  // -----------------------------------------------------------------
  // `ensureSppAccountReady` reporting aspInserted/keysRegistered only means
  // the writes were submitted — the ASP leaf still has to be visible
  // on-chain before the SDK's `prove_next` accepts it. Without this gate the
  // send fails deep inside proving with `MembershipSync(RegisterAtASP)` after
  // ~a minute of wasted proof generation. Home computes the same readiness
  // for the balance card, but this screen is a separate mount with its own
  // lifecycle, so it re-derives readiness rather than trusting route params.
  const [privacyReadyStatus, setPrivacyReadyStatus] = useState<
    'ready' | 'setting_up' | 'unavailable' | null
  >(null);
  const [privacyReadyDetail, setPrivacyReadyDetail] = useState<string | null>(
    null
  );

  // Unspent note count bounds the SPP fee ceiling: a spend consolidates
  // across roughly `notes - 1` pool transactions, each paying its own
  // Soroban fee, so a single-transact quote understates a multi-note spend.
  const [sppNoteCount, setSppNoteCount] = useState(0);

  const stellarOwner = useMemo(() => {
    const xlm = addresses?.xlm;
    if (typeof xlm === 'string' && /^G[A-Z2-7]{55}$/.test(xlm)) return xlm;
    if (typeof address === 'string' && /^G[A-Z2-7]{55}$/.test(address)) {
      return address;
    }
    return null;
  }, [addresses?.xlm, address]);

  useEffect(() => {
    if (privacyLevel !== 'private') {
      setPrivacyReadyStatus(null);
      setPrivacyReadyDetail(null);
      return;
    }

    if (!stellarOwner) {
      setPrivacyReadyStatus('unavailable');
      setPrivacyReadyDetail(
        'Stellar address not ready — reopen Private XLM from Home.'
      );
      return;
    }

    let cancelled = false;
    setPrivacyReadyStatus((prev) => prev ?? 'setting_up');

    void (async () => {
      const { prepareSppOp, gatingSppBlocker } = await import(
        '../utils/stellarSpp/sppClient'
      );
      const { formatSppSyncUserMessage } = await import(
        '../utils/stellarSpp/sppSyncMessages'
      );
      if (cancelled) return;

      const maxAttempts = 10;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const prep = await prepareSppOp(activeNetworkKey, stellarOwner).catch(
          () => null
        );
        if (cancelled) return;

        if (prep?.readyForProve) {
          setPrivacyReadyStatus('ready');
          setPrivacyReadyDetail(null);
          return;
        }

        // Terminal states — neither resolves by waiting, so stop polling
        // instead of burning 10 RPC round-trips on a hopeless case.
        if (prep && !prep.poolOps) {
          setPrivacyReadyStatus('unavailable');
          setPrivacyReadyDetail(
            'Private sends need a pool-ops build of the app.'
          );
          return;
        }
        if (prep && !prep.chainEnabled) {
          setPrivacyReadyStatus('unavailable');
          setPrivacyReadyDetail(
            'Private payments are not configured for this network.'
          );
          return;
        }

        setPrivacyReadyStatus('setting_up');
        // Show the blocker that actually gates `readyForProve`, not
        // `blockers[0]` — the RPC probe is informational and would otherwise
        // mask the real reason (e.g. unstaged circuit assets).
        setPrivacyReadyDetail(
          formatSppSyncUserMessage(
            (prep ? gatingSppBlocker(prep) : null) ||
              'Syncing private account…',
            { network: activeNetworkKey?.includes('testnet') ? 'TESTNET' : 'MAINNET' }
          )
        );

        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [privacyLevel, activeNetworkKey, stellarOwner]);

  // Note count for the SPP fee ceiling. Local read of SecureStore notes —
  // no chain sync, so it is cheap enough to run alongside the readiness poll.
  useEffect(() => {
    if (privacyLevel !== 'private' || !stellarOwner) {
      setSppNoteCount(0);
      return;
    }

    let cancelled = false;
    void (async () => {
      const { getLocalPrivateBalance } = await import('../utils/stellarSpp');
      const result = await getLocalPrivateBalance(
        activeNetworkKey,
        stellarOwner
      ).catch(() => null);
      if (!cancelled && result) {
        setSppNoteCount(result.notes.length);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [privacyLevel, activeNetworkKey, stellarOwner]);

  // -----------------------------------------------------------------
  // Privacy-aware payment dispatcher (task 11.1).
  // -----------------------------------------------------------------
  // Replaces the prior inline mock that only handled the `'standard'`
  // shape against `signAndSendTransaction`. The hook owns the
  // `switch (privacyLevel)` path that fans out to direct transfer,
  // stealth-announce, or relayer-broadcast withdraw.
  //
  // Deferred (task 11.x, gated off): the `'max'` branch needs a
  // `sourceCommitmentHash` selected from the user's saved deposits to look
  // up the `CommitmentRecord` in SecureStore. There is no UI yet to pick a
  // commitment from the local list, and the `CommitmentRecord` type
  // does not yet stash the deposit-time Merkle path needed by the
  // prover. The `'max'` option is hard-disabled in the UI (DATA-002) and
  // fail-fast-guarded in the hook, so this branch is unreachable in release.
  // Until the deposit screen and commitment picker land,
  // `sourceCommitmentHash` is left undefined; the dispatcher then
  // surfaces a "Deposit first to use max privacy" toast rather than
  // attempting to prove against missing inputs.
  const {
    txStatus,
    txResult,
    gasEstimate: hookGasEstimate,
    gasExpensive: hookGasExpensive,
    isWalletVerificationPending,
    isSendDisabled,
    handleConfirmSend,
  } = usePaymentTransaction({
    recipient,
    amount,
    memo,
    token,
    tokenAddress,
    tokenDecimals,
    privacyLevel,
    ethPrice: tokenPrice,
    activeNetworkKey,
    selectedNetwork,
    isSendSupported,
    zkpProverRef,
    sourceCommitmentHash: undefined,
    sppOp: privacyLevel === 'private' ? sppOp : undefined,
    privacyReadyStatus,
    sppNoteCount,
  });

  // The hook owns gas estimation for the privacy-stack flows; for the
  // local price-aware estimate (used for the high-fee warning UI on
  // EVM standard sends) we still keep a local watcher below. Whichever
  // is most-recent wins.
  const gasEstimate = hookGasEstimate ?? localGasEstimate;
  const gasExpensive = hookGasExpensive || localGasExpensive;

  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.PAYMENT_CONFIRMATION_VIEWED, {
      network_key: activeNetworkKey,
      token,
      privacy_level: privacyLevel,
      has_memo: Boolean(memo),
    });
  }, [activeNetworkKey, memo, privacyLevel, token]);

  useEffect(() => {
    getFiatExchangeRate(nativeCurrency || 'USD').then(setFiatRate);
  }, [nativeCurrency]);

  // Pre-send balance fetch for the selected network. Runs while the
  // screen is idle so the insufficient-funds state is known before the
  // user taps CONFIRM & SEND (rather than only after the signer's own
  // balance check throws). We refresh alongside the gas watcher's cadence.
  useEffect(() => {
    if (txStatus !== 'idle' || !address || !activeNetworkKey) {
      return;
    }

    let isCancelled = false;

    const loadBalance = async () => {
      try {
        const result = await fetchNativeBalance(address, activeNetworkKey);
        if (isCancelled || !isMountedRef.current) {
          return;
        }
        const parsed = Number.parseFloat(result.balanceFormatted);
        // `source: 'fallback'` or a present `error` means the RPC read did
        // not succeed — treat the balance as unknown so we never block a
        // send on a bad read. A genuine zero balance from a real RPC read
        // is reliable and *will* gate the send.
        const reliable = result.source !== 'fallback' && !result.error;
        const next = {
          amount: Number.isFinite(parsed) ? parsed : 0,
          reliable,
          subentryCount: result.subentryCount,
        };
        // Sticky-reliable: the balance poll re-runs every 15s, and a single
        // flaky read used to flip `reliable` back to false — which made the
        // insufficient-funds banner and disabled button blink out until the
        // next good read. Once we have a reliable reading, don't let a later
        // unreliable one erase it; only another *reliable* read updates it.
        setNativeBalance((prev) =>
          !next.reliable && prev?.reliable ? prev : next,
        );
      } catch {
        if (isCancelled || !isMountedRef.current) {
          return;
        }
        // Unknown balance — do not block the send; the signer's own
        // balance guard remains the backstop. Preserve any prior reliable
        // read so a transient throw doesn't wipe the insufficient-funds gate.
        setNativeBalance((prev) => (prev?.reliable ? prev : { amount: 0, reliable: false }));
      }
    };

    loadBalance();
    const intervalId = setInterval(loadBalance, 15000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [address, activeNetworkKey, txStatus]);

  // Check if mnemonic is available on mount — using address derivation
  // (mnemonic itself is never exposed to this component). The hook also
  // does its own mnemonic check; we keep the local `hasMnemonic` flag so
  // the screen can surface the wallet-not-initialized state in the back
  // button analytics and in any UI that wants to react before the user
  // taps "CONFIRM & SEND".
  useEffect(() => {
    async function checkMnemonic() {
      const addr = await deriveAddressFromStoredMnemonic();
      if (isMountedRef.current) {
        hasMnemonicRef.current = addr !== null;
      }
    }

    checkMnemonic();
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Local price-aware gas watcher used to decorate the high-fee warning
  // banner. The hook owns gas estimation for the active dispatch path;
  // this watcher just augments the UI when no hook estimate is available
  // yet (e.g. before the user has typed a confirmable amount).
  useEffect(() => {
    if (txStatus !== 'idle') {
      return;
    }

    if (!recipient || !amount || !address || !isSendSupported) {
      setLocalGasEstimate(null);
      setLocalGasExpensive(false);
      return;
    }

    let isCancelled = false;

    const refreshGasEstimate = async () => {
      try {
        const parsedAmount = Number.parseFloat(amount);

        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          setLocalGasEstimate(null);
          setLocalGasExpensive(false);
          return;
        }

        if (activeChain?.type !== 'evm' || !NETWORKS[activeNetworkKey]) {
          setLocalGasEstimate({
            gasLimit: 0n,
            maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n,
            gasPrice: 0n,
            estimatedCostWei: 0n,
            estimatedCostEth: '0',
            estimatedCostUsd: '0.01',
            isStale: false,
            fetchedAt: Date.now(),
          });
          setLocalGasExpensive(false);
          return;
        }

        const estimate = await estimateTransactionGas(
          {
            to: recipient,
            value: parseEther(parsedAmount.toString()),
            from: address,
          },
          activeNetworkKey,
          tokenPrice ?? undefined
        );

        if (isCancelled || !isMountedRef.current) {
          return;
        }

        setLocalGasEstimate(estimate);
        setLocalGasExpensive(isGasExpensive(estimate));
      } catch {
        if (isCancelled || !isMountedRef.current) {
          return;
        }

        setLocalGasEstimate(null);
        setLocalGasExpensive(false);
      }
    };

    refreshGasEstimate();
    const intervalId = setInterval(refreshGasEstimate, 15000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [activeNetworkKey, address, amount, tokenPrice, isSendSupported, recipient, txStatus, activeChain?.type]);

  const handleBack = () => {
    void triggerLightImpactHaptic();
    trackEvent(ANALYTICS_EVENTS.PAYMENT_CONFIRMATION_BACK_PRESSED, {
      network_key: activeNetworkKey,
      tx_status: txStatus,
    });
    navigation.goBack();
  };

  // -----------------------------------------------------------------
  // Post-confirmation navigation: route the user to the success screen
  // when the dispatcher reports `'confirmed'`. We synthesize a
  // lightweight `TransactionRecord` since the hook's polling pipeline
  // owns the canonical record and pushes it into the global transaction
  // store; here we just need shape that PaymentSuccessScreen can render.
  // -----------------------------------------------------------------
  const lastNavigatedHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (txStatus !== 'confirmed' || !txResult?.hash) {
      return;
    }
    if (lastNavigatedHashRef.current === txResult.hash) {
      return;
    }
    lastNavigatedHashRef.current = txResult.hash;

    const parsedAmount = Number.parseFloat(amount);
    const transactionRecord = {
      id: txResult.hash,
      type: 'sent' as const,
      amount: Number.isFinite(parsedAmount) ? parsedAmount.toString() : amount,
      token: token || 'Tokens',
      tokenSymbol: token || 'Tokens',
      from: address || '',
      to: recipient,
      timestamp: Date.now(),
      status: 'completed' as const,
      hash: txResult.hash,
      network: activeNetworkKey,
      privacyLevel: privacyLevel === 'max' ? 'max' : 'standard',
    };
    navigation.replace(SCREENS.PAYMENT_SUCCESS, {
      transaction: transactionRecord as any,
    });
  }, [
    txStatus,
    txResult?.hash,
    amount,
    token,
    address,
    recipient,
    activeNetworkKey,
    privacyLevel,
    navigation,
  ]);

  const handleViewOnExplorer = () => {
    void triggerLightImpactHaptic();
    if (txResult?.hash) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_VIEW_EXPLORER_PRESSED, {
        network_key: activeNetworkKey,
        tx_hash: txResult.hash,
      });
      const url = getExplorerUrl(txResult.hash, activeNetworkKey);
      Linking.openURL(url).catch(() => {
        toast.show('Could not open explorer', 'error');
      });
    }
  };

  const handleGetTestnetETH = () => {
    void triggerLightImpactHaptic();
    if (!faucetUrl) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_FAUCET_PRESSED, {
        network_key: activeNetworkKey,
        available: false,
      });
      toast.show('Faucet unavailable for this network', 'info');
      return;
    }

    trackEvent(ANALYTICS_EVENTS.PAYMENT_FAUCET_PRESSED, {
      network_key: activeNetworkKey,
      available: true,
    });

    Linking.openURL(faucetUrl).catch(() => {
      toast.show('Could not open faucet', 'error');
    });
  };

  const handleGoHome = () => {
    trackEvent(ANALYTICS_EVENTS.PAYMENT_GO_HOME_PRESSED, {
      tx_status: txStatus,
      network_key: activeNetworkKey,
    });

    navigation.reset({
      index: 0,
      routes: [{ name: SCREENS.HOME }],
    });
  };

  // -----------------------------------------------------------------
  // Fees and the pre-send insufficient-funds gate.
  // -----------------------------------------------------------------
  // The arithmetic lives in `derivePaymentFeeView` so it can be tested
  // directly — this screen is effectively unrenderable under the current test
  // setup, and these are the numbers a user reads before authorizing a
  // payment. See utils/paymentFees.ts for the two invariants it holds: fees are
  // native-denominated, and a missing estimate never fabricates a number nor
  // disarms the gate below.
  //
  // Native sends require amount + fee; token and pXLM sends still require the
  // public native fee. Stellar additionally requires the account minimum
  // balance to remain after either kind of operation. The gate requires a
  // *reliable* balance read: a fallback/errored read leaves
  // `nativeBalance.reliable === false`, so a flaky RPC never falsely blocks a
  // legitimate payment.
  const nativeSymbol = selectedNetwork?.symbol;
  const minimumBalanceNative =
    activeChain?.type === 'xlm'
      ? computeStellarMinReserveXlm(nativeBalance?.subentryCount)
      : 0;
  const {
    feeSymbol,
    isFeeCeiling,
    networkFee,
    hasFee,
    totalFee,
    privacyFee,
    isNativeSend,
    requiredNative,
    nativeTotal,
  } = derivePaymentFeeView({
    gasEstimate,
    privacyLevel,
    amount,
    token,
    nativeSymbol,
    minimumBalanceNative,
  });

  const sppTxCount = sppPlannedTxCount(sppOp, sppNoteCount);
  const gasWarning = gasExpensive && gasEstimate
    ? `Estimated gas is ${gasEstimate.estimatedCostUsd ? `$${Number.parseFloat(gasEstimate.estimatedCostUsd).toFixed(2)}` : `${gasEstimate.estimatedCostEth} ${feeSymbol}`} right now.`
    : null;

  // Token and pXLM sends also consume the public native balance for fees. On
  // Stellar they must additionally leave the protocol reserve untouched, so
  // the gate cannot be limited to `token === nativeSymbol`.
  const hasNativeRequirement =
    isNativeSend || hasFee || minimumBalanceNative > 0;
  const insufficientFunds = Boolean(
    hasNativeRequirement &&
      nativeBalance?.reliable &&
      Number.isFinite(requiredNative) &&
      requiredNative > 0 &&
      nativeBalance.amount + Number.EPSILON < requiredNative
  );
  const availableBalanceLabel =
    nativeBalance?.reliable && hasNativeRequirement
      ? `${nativeBalance.amount} ${nativeSymbol}`
      : null;

  /**
   * `'private'` sends stay locked until `prepareSppOp().readyForProve` is
   * true. The hook enforces this too (defence in depth); this flag exists so
   * the button can explain *why* it is disabled instead of looking broken.
   */
  const privateNotReady =
    privacyLevel === 'private' && privacyReadyStatus !== 'ready';

  const isInFlight =
    txStatus === 'sending' ||
    txStatus === 'pending' ||
    txStatus === 'stealth_deriving' ||
    txStatus === 'spp_syncing' ||
    txStatus === 'proving' ||
    txStatus === 'relaying';

  // Status copy for the plain (non-SPP) in-flight spinner. The ShieldProgress
  // modal replaces this for `'private'` sends; every other privacy level uses
  // the simple status line below.
  const getStatusInfo = () => {
    switch (txStatus) {
      case 'stealth_deriving':
        return { text: 'DERIVING STEALTH ADDRESS...', color: colors.accent };
      case 'spp_syncing':
        return { text: 'SYNCING PRIVATE POOL...', color: colors.accent };
      case 'proving':
        return { text: 'GENERATING ZK PROOF...', color: colors.accent };
      case 'relaying':
        return { text: 'BROADCASTING VIA RELAYER...', color: colors.accent };
      case 'sending':
        return { text: 'SIGNING TRANSACTION...', color: colors.accent };
      case 'pending':
        return { text: 'AWAITING CONFIRMATION...', color: colors.accent };
      case 'confirmed':
        return { text: 'PAYMENT SENT', color: colors.successMuted };
      case 'failed':
        return { text: 'TRANSACTION FAILED', color: colors.error };
      default:
        return { text: 'CONFIRM & SEND', color: colors.textPrimary };
    }
  };

  const statusInfo = getStatusInfo();

  // -----------------------------------------------------------------
  // SPP shield-progress wiring (private sends only).
  // -----------------------------------------------------------------
  // The ShieldProgressModal is driven by the operation-stage diagnostics
  // emitted by sppClient. This screen only resets the model per attempt and
  // closes the final confirmed stage; sync/prove/submit transitions come from
  // the actual SPP pipeline rather than being inferred from a generic spinner.
  // The SPP stage model (derive_keys → sync_pool → generate_proof → submit_tx)
  // only describes the `'private'` (Stellar SPP) flow; standard / stealth / max
  // sends keep the plain in-flight status line instead.
  const isSppPrivateSend = privacyLevel === 'private';
  const prevTxStatusRef = useRef<UiTxStatus | null>(null);
  useEffect(() => {
    if (!isSppPrivateSend) return;
    const prev = prevTxStatusRef.current;
    prevTxStatusRef.current = txStatus;

    if (txStatus === 'idle') {
      resetSppProgress();
      return;
    }

    // A retry after a failure re-enters an in-flight state without passing
    // through `idle` — reset the stage model so stale error/check states from
    // the previous attempt don't carry into the new one. Reset exactly once
    // per attempt (on the in-flight entry transition), not on every re-run.
    const inFlightStatuses: UiTxStatus[] = [
      'sending',
      'pending',
      'proving',
      'spp_syncing',
      'relaying',
    ];
    const inFlightNow = inFlightStatuses.includes(txStatus);
    const inFlightBefore = prev !== null && inFlightStatuses.includes(prev);
    if (inFlightNow && !inFlightBefore) {
      resetSppProgress();
    }

    if (txStatus === 'confirmed') {
      void recordSppProgressDiagnostic({
        status: 'success',
        step: 'submit_tx',
        operation: sppOp,
      });
      void recordSppProgressDiagnostic({ status: 'success', step: 'confirmed' });
    }
  }, [txStatus, privacyLevel, sppOp, isSppPrivateSend]);

  // ShieldProgressModal visibility — private (SPP) sends only. Stays up through
  // `'confirmed'` so the success state can auto-dismiss (~1.2s) before
  // TransactionResultModal takes over; a local state (not a derived prop) lets
  // onDismiss work.
  const [shieldModalVisible, setShieldModalVisible] = useState(false);
  useEffect(() => {
    if (!isSppPrivateSend) {
      setShieldModalVisible(false);
    } else if (isInFlight || txStatus === 'confirmed') {
      setShieldModalVisible(true);
    } else if (txStatus === 'idle' || txStatus === 'failed') {
      setShieldModalVisible(false);
    }
  }, [isInFlight, txStatus, isSppPrivateSend]);

  const handleShieldRetry = () => {
    setShieldModalVisible(false);
    handleConfirmSend();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <NetworkStatusBanner />

      {/* Header */}
      <View style={styles.header}>
        <ScreenBackButton onPress={handleBack} />
        <Text style={styles.headerTitle}>CONFIRM PAYMENT</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(260)} style={styles.animatedContent}>
        <View
          style={styles.content}
        >
          {/* Details scroll area — bounded so the CONFIRM & SEND button stays
              pinned and visible on small viewports; scrolls only if the
              recipient/amount/fee detail content genuinely overflows. */}
          <ScrollView
            style={styles.detailsScroll}
            contentContainerStyle={styles.detailsScrollContent}
            showsVerticalScrollIndicator={false}
          >
          {/* Network Notice — compact chip/badge row (~40px) */}
          <View style={styles.networkChipRow}>
            <View
              style={[
                styles.networkChip,
                {
                  backgroundColor: selectedNetwork?.isTestnet
                    ? colors.accentContainer
                    : colors.error + '20',
                },
              ]}
            >
              <Icon
                name="testtube"
                size={14}
                color={selectedNetwork?.isTestnet ? colors.accent : colors.errorMuted}
              />
              <Text
                style={[
                  styles.networkChipText,
                  {
                    color: selectedNetwork?.isTestnet
                      ? colors.accent
                      : colors.errorMuted,
                  },
                ]}
              >
                {selectedNetwork?.isTestnet ? 'TESTNET' : 'MAINNET'}
              </Text>
            </View>

            {selectedNetwork?.isTestnet && faucetUrl && (
              <PressableOpacity
                onPress={handleGetTestnetETH}
                style={styles.networkFaucetLink}
                accessibilityRole="link"
                accessibilityLabel="Get testnet funds"
              >
                <Text style={styles.networkFaucetLinkText}>
                  Get {token || 'funds'}
                </Text>
                <Icon name="chevron-right" size={10} color={colors.accent} />
              </PressableOpacity>
            )}
          </View>

          {/* Transaction Status Card Removed - Handled by Modal */}

          {/* Amount Display */}
          <View style={styles.amountSection}>
            <Text style={styles.amountLabel}>
              {privacyLevel === 'private' && sppOp === 'shield'
                ? 'YOU ARE SHIELDING'
                : privacyLevel === 'private' && sppOp === 'unshield'
                  ? 'YOU ARE UNSHIELDING'
                  : privacyLevel === 'private'
                    ? 'YOU ARE SENDING PRIVATELY'
                    : 'YOU ARE SENDING'}
            </Text>
          <View style={styles.amountDisplay}>
            <Text style={styles.amountValue} accessibilityLiveRegion="assertive">{amount}</Text>
              <Text style={styles.amountToken}>{token}</Text>
            </View>

            {/* USD Value with live price */}
            <View style={styles.usdValueContainer}>
              {priceLoading && tokenPrice === null ? (
                <View style={styles.priceLoadingContainer}>
                  <Skeleton width={110} height={14} borderRadius={4} />
                  <Skeleton width={80} height={14} borderRadius={4} />
                </View>
              ) : (
                <>
                  <Text style={styles.usdValue}>
                    ≈ {formatFiatValue(parseFloat(amount || '0') * (tokenPrice ?? fallbackPrice) * fiatRate, nativeCurrency || 'USD')}
                  </Text>
                  {lastUpdated && (
                    <Text style={styles.priceUpdated}>
                      @ {formatFiatValue((tokenPrice ?? fallbackPrice) * fiatRate, nativeCurrency || 'USD')}/{quoteSymbol}
                      {' • '}
                      {formatLastUpdated(lastUpdated)}
                      {isStale && <Text style={styles.staleWarning}> (cached)</Text>}
                    </Text>
                  )}
                  {priceError && (
                    <Text style={styles.priceErrorText}>Live price unavailable. Using fallback value.</Text>
                  )}
                </>
              )}
            </View>
          </View>

          {/* Transaction Details */}
          <Text style={styles.sectionTitle}>TRANSACTION DETAILS</Text>
      <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
        <View style={styles.detailsContent}>
              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Text style={styles.detailLabel}>
                    {privacyLevel === 'private' && sppOp === 'shield'
                      ? 'FROM (PUBLIC)'
                      : privacyLevel === 'private' && (sppOp === 'transfer' || sppOp === 'unshield')
                        ? 'FROM (PRIVATE)'
                        : 'FROM'}
                  </Text>
                  <Text style={styles.detailValue}>{formatAddress(address || '')}</Text>
                </View>
                <Logo variant="icon" size="small" />
              </View>

              <View style={styles.detailDivider} />

              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Text style={styles.detailLabel}>
                    {privacyLevel === 'private' && sppOp === 'shield'
                      ? 'TO'
                      : privacyLevel === 'private' && sppOp === 'unshield'
                        ? 'TO (PUBLIC)'
                        : privacyLevel === 'private'
                          ? 'TO (PRIVATE)'
                          : 'TO'}
                  </Text>
                  <Text style={styles.detailValue}>
                    {privacyLevel === 'private' && sppOp === 'shield'
                      ? 'Your private balance'
                      : formatAddress(recipient)}
                  </Text>
                </View>
                <Icon name="receive" size={20} color={colors.accent} />
              </View>

              <View style={styles.detailDivider} />

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>NETWORK</Text>
                <Text style={styles.detailValue}>{selectedNetwork?.name || 'Unknown Network'}</Text>
              </View>

              <View style={styles.detailDivider} />

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>
                  {privacyLevel === 'private' ? 'ACTION' : 'PRIVACY LEVEL'}
                </Text>
                <View style={styles.privacyBadge}>
                  <Icon
                    name={
                      privacyLevel === 'max' || privacyLevel === 'private'
                        ? 'private-lock'
                        : privacyLevel === 'stealth'
                          ? 'private'
                          : 'shield'
                    }
                    size={16}
                    color={colors.accent}
                  />
                  <Text style={styles.privacyBadgeText}>
                    {privacyLevel === 'max'
                      ? 'MAX'
                      : privacyLevel === 'private'
                        ? sppOp === 'shield'
                          ? 'SHIELD'
                          : sppOp === 'unshield'
                            ? 'UNSHIELD'
                            : 'PRIVATE'
                        : privacyLevel === 'stealth'
                          ? 'STEALTH'
                          : 'STANDARD'}
                  </Text>
                </View>
              </View>

              {memo && (
                <>
                  <View style={styles.detailDivider} />
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>MEMO</Text>
                    <Text style={styles.detailValue}>{memo}</Text>
                  </View>
                </>
              )}
            </View>
          </SovereignCard>

          {/* Fee Breakdown — collapsible card */}
          <Text style={styles.sectionTitle}>FEE BREAKDOWN</Text>
          <SovereignCard
            backgroundColor={colors.surfaceCard}
            padding={0}
            style={{ marginBottom: 24 }}
          >
            <FeeBreakdownCard
              networkFee={networkFee}
              feeSymbol={feeSymbol}
              sppTxCount={sppTxCount}
              sppOp={sppOp}
              privacyLevel={privacyLevel}
              hasFee={hasFee}
              isFeeCeiling={isFeeCeiling}
              totalFee={totalFee}
              privacyFee={privacyFee}
              isNativeSend={isNativeSend}
              nativeTotal={nativeTotal}
              amount={amount}
              token={token}
            />
          </SovereignCard>

          {gasWarning && (
            <SovereignCard backgroundColor="transparent" padding={0} style={{ marginBottom: 24, borderRadius: 0, borderWidth: 1, borderColor: colors.accent }}>
              <View style={styles.gasWarningContent}>
                <View style={styles.gasWarningIconWrap}>
                  <Icon name="warning" size={20} color={colors.accent} />
                </View>
                <View style={styles.gasWarningTextWrap}>
                  <Text style={styles.gasWarningTitle}>HIGH GAS FEES</Text>
                  <Text style={styles.gasWarningDesc}>
                    {gasWarning}
                  </Text>
                  {gasEstimate?.isStale && (
                    <Text style={styles.gasWarningMeta}>Using a cached fallback estimate.</Text>
                  )}
                </View>
              </View>
            </SovereignCard>
          )}

          {/* Privacy Notice */}
      <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
        <View style={styles.privacyNotice}>
          <Icon name="private" size={24} color={colors.accent} />
              <View style={styles.privacyNoticeText}>
                <Text style={styles.privacyNoticeTitle}>
                  {privacyLevel === 'standard' ? 'STANDARD TRANSACTION' : 'PRIVATE TRANSACTION'}
                </Text>
                <Text style={styles.privacyNoticeDesc}>
                  {privacyLevel === 'max'
                    ? 'Zero-knowledge proof ensures complete transaction privacy.'
                    : privacyLevel === 'private'
                      ? sppOp === 'shield'
                        ? 'Moves public XLM into your private balance. Proof runs on this device (~10–20s).'
                        : sppOp === 'unshield'
                          ? 'Returns private balance to a public Stellar address. Proof runs on this device (~10–20s).'
                          : 'Pays from your private balance. Amount and counterparty stay shielded. Proof ~10–20s on device.'
                      : privacyLevel === 'stealth'
                        ? 'One-time stealth address. The recipient discovers the payment via an on-chain announcement event.'
                        : 'Direct on-chain transfer with visible sender and recipient.'}
                </Text>

              </View>
            </View>
          </SovereignCard>

          {/* Insufficient-funds notice — shown only when we have a
              reliable native-balance read that is short of the send debit,
              fees, or required account reserve. Distinct from the on-chain failure
              path so the user learns before signing. */}
          {insufficientFunds && txStatus === 'idle' && (
            <SovereignCard backgroundColor="transparent" padding={0} style={{ marginBottom: 24, borderRadius: 0, borderWidth: 1, borderColor: colors.error }}>
              <View style={styles.gasWarningContent}>
                <View style={styles.gasWarningIconWrap}>
                  <Icon name="warning" size={20} color={colors.error} />
                </View>
                <View style={styles.gasWarningTextWrap}>
                  <Text style={[styles.gasWarningTitle, { color: colors.error }]}>INSUFFICIENT FUNDS</Text>
                  <Text style={styles.gasWarningDesc}>
                    You need about {requiredNative.toFixed(activeChain?.type === 'xlm' ? 7 : 6)} {nativeSymbol} (including fees and any required account reserve) on {selectedNetwork?.name || 'this network'}
                    {availableBalanceLabel ? `, but your balance is ${availableBalanceLabel}` : ''}.
                    {selectedNetwork?.isTestnet
                      ? ' Use the faucet above to get test funds.'
                      : ` Add ${nativeSymbol} to this wallet to continue.`}
                  </Text>
                </View>
              </View>
            </SovereignCard>
          )}

          </ScrollView>

          <View style={styles.actionArea}>
            {privateNotReady && txStatus === 'idle' && (
              <SovereignCard
                backgroundColor={colors.surfaceCard}
                style={{ marginBottom: 12 }}
              >
                <View style={styles.privacyGateRow}>
                  {privacyReadyStatus === 'unavailable' ? (
                    <Icon name="info" size={16} color={colors.textMuted} />
                  ) : (
                    <ActivityIndicator size="small" color={colors.accent} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.privacyGateLabel}>
                      {privacyReadyStatus === 'unavailable'
                        ? 'Private sends unavailable'
                        : 'Finishing private account sync'}
                    </Text>
                    <Text style={styles.privacyGateDetail} numberOfLines={3}>
                      {privacyReadyDetail ||
                        'Waiting for privacy membership to confirm on-chain.'}
                    </Text>
                  </View>
                </View>
              </SovereignCard>
            )}

            {txStatus === 'idle' && (
              <SovereignButton
                title={
                  isWalletVerificationPending
                    ? 'VERIFYING WALLET...'
                    : insufficientFunds
                      ? 'INSUFFICIENT FUNDS'
                      : privateNotReady
                        ? privacyReadyStatus === 'unavailable'
                          ? 'PRIVATE SENDS UNAVAILABLE'
                          : 'PREPARING PRIVATE ACCOUNT...'
                        : 'CONFIRM & SEND'
                }
                accessibilityLabel={
                  isWalletVerificationPending
                    ? 'Verifying wallet'
                    : insufficientFunds
                      ? 'Insufficient funds'
                      : privateNotReady
                        ? privacyReadyStatus === 'unavailable'
                          ? 'Private sends unavailable on this build'
                          : 'Preparing private account, please wait'
                        : 'Confirm and send payment'
                }
                accessibilityHint="Submits the payment with the selected privacy level"
                variant={isSendDisabled || insufficientFunds ? 'outline' : 'primary'}
                onPress={() => {
                  void triggerLightImpactHaptic();
                  handleConfirmSend();
                }}
                disabled={isSendDisabled || insufficientFunds}
              />
            )}

            {isInFlight && !isSppPrivateSend && (
              <View style={styles.inFlightStatus}>
                <SovereignButton
                  title={statusInfo.text}
                  variant="outline"
                  onPress={() => {}}
                  disabled={true}
                  style={{ marginBottom: 8 }}
                />
                <ActivityIndicator
                  size="small"
                  color={colors.accent}
                  style={styles.inFlightSpinner}
                />
              </View>
            )}

            {txStatus === 'failed' && (
              <SovereignButton
                title="TRY AGAIN"
                variant="primary"
                onPress={handleConfirmSend}
              />
            )}
          </View>
        </View>
      </Animated.View>

      {/* Hidden WebView-hosted snarkjs prover. Mounted unconditionally so
          its WebView can finish loading the snarkjs UMD before the user
          taps "CONFIRM & SEND" with `'max'` privacy. The hook only calls
          into the prover via `zkpProverRef` when the dispatcher reaches
          the `'max'` branch, so the standard / stealth flows pay no cost
          beyond the initial HTML render. */}
      <ZkpProver ref={zkpProverRef} />

      {/* Toast Notification */}
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />

      {/* Transaction Result Modal */}
      <TransactionResultModal
        visible={txStatus === 'confirmed' || txStatus === 'failed'}
        status={txStatus === 'confirmed' ? 'confirmed' : 'failed'}
        errorMessage={txResult?.error}
        onViewExplorer={txResult?.hash ? handleViewOnExplorer : undefined}
        onGoHome={handleGoHome}
      />

      {/* Shield Progress Modal — replaces the in-flight spinner. Rendered last
          so it layers above TransactionResultModal during the brief confirmed
          window before auto-dismissing. */}
      <ShieldProgressModal
        visible={shieldModalVisible}
        onRetry={handleShieldRetry}
        onDismiss={() => setShieldModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  privacyGateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  privacyGateLabel: {
    fontFamily: typography.fontFamily.bodyBold,
    color: colors.textSecondary,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  privacyGateDetail: {
    fontFamily: typography.fontFamily.body,
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
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
    minHeight: 44,
    justifyContent: 'center',
  },
  backButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  detailsScroll: {
    flexShrink: 1,
    flexGrow: 0,
  },
  detailsScrollContent: {
    paddingBottom: 16,
  },
  actionArea: {
    marginTop: 16,
    marginBottom: 24,
  },
  inFlightStatus: {
    width: '100%',
    alignItems: 'center',
  },
  inFlightSpinner: {
    marginTop: 8,
    alignSelf: 'center',
  },
  animatedContent: {
    flex: 1,
  },
  networkChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    marginBottom: 16,
  },
  networkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  networkChipText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  networkFaucetLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 40,
    justifyContent: 'center',
  },
  networkFaucetLinkText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.accent,
  },
  errorText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.errorMuted,
    textAlign: 'center',
    marginTop: 8,
  },
  amountSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  amountLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  amountDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  amountValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 40,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  amountToken: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 20,
    color: colors.accent,
    fontWeight: 'bold',
  },
  usdValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textTertiary,
    marginTop: 2,
  },
  usdValueContainer: {
    alignItems: 'center',
    marginTop: 2,
  },
  priceLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 16,
  },
  usdValueLoading: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textMuted,
  },
  priceUpdated: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 2,
  },
  staleWarning: {
    color: colors.accent,
    fontStyle: 'italic',
  },
  priceErrorText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.accentMuted,
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  detailsContent: {
    padding: 16,
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLeft: {
    flex: 1,
    gap: 4,
  },
  detailLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 1,
  },
  detailValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
  },
  detailIcon: {
    fontSize: 20,
    color: colors.accent,
  },
  detailDivider: {
    height: 1,
    backgroundColor: colors.outlineSubtle,
  },
  privacyBadge: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 0,
  },
  privacyBadgeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
  },
  gasWarningContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  gasWarningIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  gasWarningTextWrap: {
    flex: 1,
    gap: 4,
  },
  gasWarningTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  gasWarningDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.accentLight,
    lineHeight: 18,
  },
  gasWarningMeta: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.accentMuted,
  },
  privacyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  privacyNoticeText: {
    flex: 1,
    gap: 4,
  },
  privacyNoticeTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  privacyNoticeDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
});

export default PaymentConfirmationScreen;
