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
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Linking,
} from 'react-native';
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
import { deriveAddressFromStoredMnemonic } from '../utils/secureSigner';
import {
  getExplorerUrl,
  getFaucetUrl,
  NETWORKS,
} from '../utils/transactions';
import { estimateTransactionGas, isGasExpensive, type GasEstimate } from '../utils/gasEstimator';
import { TransactionResultModal } from '../components/payment/TransactionResultModal';
import { FALLBACK_PRICES, getFiatExchangeRate, formatFiatValue, formatLastUpdated } from '../utils/priceFeed';
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

type PaymentConfirmationScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'PaymentConfirmation'>;
type PaymentConfirmationScreenRoute = RouteProp<RootStackParamList, 'PaymentConfirmation'>;

interface PaymentConfirmationScreenProps {
  navigation: PaymentConfirmationScreenNavigationProp;
  route: PaymentConfirmationScreenRoute;
}

export function PaymentConfirmationScreen({ navigation, route }: PaymentConfirmationScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [hasMnemonic, setHasMnemonic] = useState<boolean | null>(null);
  const [tokenPrice, setTokenPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [localGasEstimate, setLocalGasEstimate] = useState<GasEstimate | null>(null);
  const [localGasExpensive, setLocalGasExpensive] = useState(false);
  const [fiatRate, setFiatRate] = useState(1);
  const isMountedRef = useRef(true);
  const zkpProverRef = useRef<ZkpProverRef | null>(null);

  const { activeChain, address } = useWalletStore();
  const { nativeCurrency } = useSettingsStore();
  const toast = useToast();
  const { isConnected } = useNetworkStatus();

  const mainnetTransactionsEnabled = process.env.EXPO_PUBLIC_ENABLE_MAINNET_TRANSACTIONS === 'true';
  const isSendSupported = true; // Support UI progression for all chains

  const activeNetworkKey = useMemo(() => {
    const chainKey = activeChain?.key;
    const chainType = activeChain?.type || 'evm';

    const getTestnetFallback = (type: string) => {
      switch (type) {
        case 'svm': return 'solana-devnet';
        case 'xlm': return 'stellar-testnet';
        case 'mvm': return 'aptos'; // Aptos testnet uses same key currently or has no split in NETWORKS
        default: return 'sepolia';
      }
    };

    if (!chainKey || !NETWORKS[chainKey]) {
      return getTestnetFallback(chainType);
    }

    if (NETWORKS[chainKey].isTestnet || mainnetTransactionsEnabled) {
      return chainKey;
    }

    return getTestnetFallback(chainType);
  }, [activeChain?.key, activeChain?.type, mainnetTransactionsEnabled]);

  const selectedNetwork = NETWORKS[activeNetworkKey];
  const faucetUrl = getFaucetUrl(activeNetworkKey);

  // Payment data from previous screens
  const recipient = route?.params?.recipient || '';
  const amount = route?.params?.amount || '';
  const memo = route?.params?.memo || '';
  const token = route?.params?.token || 'ETH';
  const privacyLevel = route?.params?.privacyLevel || 'standard';

  // -----------------------------------------------------------------
  // Privacy-aware payment dispatcher (task 11.1).
  // -----------------------------------------------------------------
  // Replaces the prior inline mock that only handled the `'standard'`
  // shape against `signAndSendTransaction`. The hook owns the
  // `switch (privacyLevel)` path that fans out to direct transfer,
  // stealth-announce, or relayer-broadcast withdraw.
  //
  // TODO(task 11.x): the `'max'` branch needs a `sourceCommitmentHash`
  // selected from the user's saved deposits to look up the
  // `CommitmentRecord` in SecureStore. There is no UI yet to pick a
  // commitment from the local list, and the `CommitmentRecord` type
  // does not yet stash the deposit-time Merkle path needed by the
  // prover. Until the deposit screen and commitment picker land,
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
    privacyLevel,
    ethPrice: tokenPrice,
    activeNetworkKey,
    selectedNetwork,
    isSendSupported,
    zkpProverRef,
    sourceCommitmentHash: undefined,
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

  const { getQuote, isLoading: isQuoteLoading } = useMarketData([token]);
  const marketQuote = getQuote(token);
  
  useEffect(() => {
    if (marketQuote) {
      setTokenPrice(marketQuote.price);
      setLastUpdated(marketQuote.lastUpdated);
      setIsStale(marketQuote.isStale);
      setPriceLoading(isQuoteLoading);
    } else {
      if (!isQuoteLoading) {
        setTokenPrice(FALLBACK_PRICES[token] || 0);
        setIsStale(true);
        setPriceLoading(false);
      } else {
        setPriceLoading(true);
      }
    }
  }, [marketQuote, isQuoteLoading, token]);

  useEffect(() => {
    getFiatExchangeRate(nativeCurrency || 'USD').then(setFiatRate);
  }, [nativeCurrency]);

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
        setHasMnemonic(addr !== null);
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

  const formatAddress = (addr: string) => {
    if (!addr) return 'Not available';
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
  };

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

  // Calculate fees (estimated)
  const networkFee = gasEstimate?.estimatedCostEth ?? '0.001';
  const privacyFee = privacyLevel === 'max' ? '0.005' : '0';
  const totalFee = (parseFloat(networkFee) + parseFloat(privacyFee)).toFixed(4);
  const totalAmount = (parseFloat(amount || '0') + parseFloat(totalFee)).toFixed(6);
  const gasWarning = gasExpensive && gasEstimate
    ? `Estimated gas is ${gasEstimate.estimatedCostUsd ? `$${Number.parseFloat(gasEstimate.estimatedCostUsd).toFixed(2)}` : `${gasEstimate.estimatedCostEth} ETH`} right now.`
    : null;

  // Get status display info — covers the full UiTxStatus union from
  // {@link usePaymentTransaction} so the stealth- and max-privacy
  // intermediate states render meaningful copy instead of falling
  // through to the default "CONFIRM & SEND" label.
  const getStatusInfo = () => {
    switch (txStatus) {
      case 'stealth_deriving':
        return { text: 'DERIVING STEALTH ADDRESS...', color: colors.accent };
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

  const isInFlight =
    txStatus === 'sending' ||
    txStatus === 'pending' ||
    txStatus === 'stealth_deriving' ||
    txStatus === 'proving' ||
    txStatus === 'relaying';

  const statusInfo = getStatusInfo();

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
        <ScrollView
          style={styles.content}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Network Notice */}
      <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
        <View style={styles.testnetNotice}>
          <Icon name="testtube" size={24} color={colors.accent} />
              <View style={styles.testnetNoticeText}>
                <Text style={styles.testnetNoticeTitle}>
                  {selectedNetwork?.isTestnet ? 'TESTNET MODE' : 'MAINNET MODE'}
                </Text>
                <Text style={styles.testnetNoticeDesc}>
                  This transaction will be sent on {selectedNetwork?.name || 'the selected network'}.
                  {selectedNetwork?.isTestnet
                    ? ' Get faucet funds when supported.'
                    : ' Mainnet sends are enabled via EXPO_PUBLIC_ENABLE_MAINNET_TRANSACTIONS=true.'}
                </Text>
                <TouchableOpacity
                  onPress={handleGetTestnetETH}
                  disabled={!faucetUrl}
                  style={styles.faucetButton}
                  accessibilityRole="button"
                  accessibilityLabel="Get testnet funds"
                  accessibilityHint="Opens faucet website to request test funds"
                  accessibilityState={{ disabled: !faucetUrl }}
                >
                  <View style={styles.faucetLinkRow}>
                    <Text style={[styles.faucetLink, !faucetUrl && styles.faucetLinkDisabled]}>
                      Get Test {token || 'Funds'}
                    </Text>
                    <Icon
                      name="chevron-right"
                      size={12}
                      color={faucetUrl ? colors.accent : colors.textFaint}
                      style={styles.faucetLinkIcon}
                    />
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </SovereignCard>

          {/* Transaction Status Card Removed - Handled by Modal */}

          {/* Amount Display */}
          <View style={styles.amountSection}>
            <Text style={styles.amountLabel}>YOU ARE SENDING</Text>
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
                    ≈ {formatFiatValue(parseFloat(amount || '0') * (tokenPrice ?? FALLBACK_PRICES[token] ?? 0) * fiatRate, nativeCurrency || 'USD')}
                  </Text>
                  {lastUpdated && (
                    <Text style={styles.priceUpdated}>
                      @ {formatFiatValue((tokenPrice ?? FALLBACK_PRICES[token] ?? 0) * fiatRate, nativeCurrency || 'USD')}/{token}
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
                  <Text style={styles.detailLabel}>FROM</Text>
                  <Text style={styles.detailValue}>{formatAddress(address || '')}</Text>
                </View>
                <Logo variant="icon" size="small" />
              </View>

              <View style={styles.detailDivider} />

              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Text style={styles.detailLabel}>TO</Text>
                  <Text style={styles.detailValue}>{formatAddress(recipient)}</Text>
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
                <Text style={styles.detailLabel}>PRIVACY LEVEL</Text>
                <View style={styles.privacyBadge}>
                  <Icon
                    name={
                      privacyLevel === 'max'
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

          {/* Fee Breakdown */}
          <Text style={styles.sectionTitle}>FEE BREAKDOWN</Text>
      <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
        <View style={styles.feeContent}>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Network Fee (estimated)</Text>
                <Text style={styles.feeValue}>{networkFee} {token}</Text>
              </View>
              {privacyLevel === 'max' && (
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>Privacy Pool Fee</Text>
                  <Text style={styles.feeValue}>{privacyFee} {token}</Text>
                </View>
              )}
              <View style={styles.feeDivider} />
              <View style={styles.feeRow}>
                <Text style={styles.feeLabelTotal}>TOTAL AMOUNT</Text>
                <Text style={styles.feeValueTotal}>{totalAmount} {token}</Text>
              </View>
            </View>
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
                    : privacyLevel === 'stealth'
                      ? 'One-time stealth address. The recipient discovers the payment via an on-chain announcement event.'
                      : 'Direct on-chain transfer with visible sender and recipient.'}
                </Text>
              </View>
            </View>
          </SovereignCard>

          <View style={{ marginTop: 'auto', marginBottom: 24 }}>
            {txStatus === 'idle' && (
              <SovereignButton
                title={isWalletVerificationPending ? 'VERIFYING WALLET...' : 'CONFIRM & SEND'}
                variant={isSendDisabled ? 'outline' : 'primary'}
                onPress={() => {
                  void triggerLightImpactHaptic();
                  handleConfirmSend();
                }}
                disabled={isSendDisabled}
              />
            )}

            {isInFlight && (
              <View>
                <SovereignButton
                  title={statusInfo.text}
                  variant="outline"
                  onPress={() => { }}
                  disabled={true}
                  style={{ marginBottom: 8 }}
                />
                <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 8 }} />
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
        </ScrollView>
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
  animatedContent: {
    flex: 1,
  },
  testnetNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  testnetIcon: {
    fontSize: 24,
  },
  testnetNoticeText: {
    flex: 1,
    gap: 4,
  },
  testnetNoticeTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  testnetNoticeDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  faucetLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  faucetLink: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    marginTop: 4,
  },
  faucetLinkIcon: {
    marginLeft: 4,
    marginTop: 4,
  },
  faucetButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  faucetLinkDisabled: {
    color: colors.textTertiary,
  },
  statusContent: {
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  statusIcon: {
    marginBottom: 4,
  },
  statusTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    color: colors.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  statusHash: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    opacity: 0.8,
  },
  viewExplorer: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.accent,
    marginTop: 4,
  },
  explorerButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  explorerLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  viewExplorerIcon: {
    marginLeft: 4,
  },
  blockInfo: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textPrimary,
    opacity: 0.6,
    marginTop: 4,
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
  feeContent: {
    padding: 16,
    gap: 12,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feeLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
  },
  feeValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
  },
  feeDivider: {
    height: 1,
    backgroundColor: colors.outlineSubtle,
  },
  feeLabelTotal: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  feeValueTotal: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
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
  privacyNoticeIcon: {
    fontSize: 24,
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
