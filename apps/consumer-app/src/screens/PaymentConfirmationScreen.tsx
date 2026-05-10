/**
 * Veilpay Payment Confirmation Screen
 * Final confirmation screen before sending a payment
 * Uses the current hybrid structural design language for all interactive elements
 *
 * UPDATED: Now sends real blockchain transactions using ethers.js
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import {
  signAndSendTransaction,
  deriveAddressFromStoredMnemonic,
} from '../utils/secureSigner';
import {
  getExplorerUrl,
  getFaucetUrl,
  TransactionError,
  TransactionResult,
  NETWORKS,
} from '../utils/transactions';
import { pollTransactionStatus, createPollAbortController } from '../utils/txStatusPoller';
import { estimateTransactionGas, isGasExpensive, type GasEstimate } from '../utils/gasEstimator';
import { FALLBACK_ETH_PRICE, getETHPrice, formatUsdValue, formatLastUpdated } from '../utils/priceFeed';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

type PaymentConfirmationScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'PaymentConfirmation'>;
type PaymentConfirmationScreenRoute = RouteProp<RootStackParamList, 'PaymentConfirmation'>;

interface PaymentConfirmationScreenProps {
  navigation: PaymentConfirmationScreenNavigationProp;
  route: PaymentConfirmationScreenRoute;
}

type UiTxStatus = 'idle' | 'sending' | 'pending' | 'confirmed' | 'failed';

export function PaymentConfirmationScreen({ navigation, route }: PaymentConfirmationScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [txStatus, setTxStatus] = useState<UiTxStatus>('idle');
  const [txResult, setTxResult] = useState<TransactionResult | null>(null);
  const [hasMnemonic, setHasMnemonic] = useState<boolean | null>(null);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [gasExpensive, setGasExpensive] = useState(false);
  const isMountedRef = useRef(true);
  const pollAbortRef = useRef<AbortController | null>(null);

  const { activeChain, address } = useWalletStore();
  const toast = useToast();
  const { isConnected } = useNetworkStatus();

  const mainnetTransactionsEnabled = process.env.EXPO_PUBLIC_ENABLE_MAINNET_TRANSACTIONS === 'true';
  const isSendSupported = activeChain?.type === 'evm' && Boolean(activeChain?.key && NETWORKS[activeChain.key]);

  const activeNetworkKey = useMemo(() => {
    const chainKey = activeChain?.key;
    if (!chainKey || !NETWORKS[chainKey]) {
      return 'sepolia';
    }

    if (NETWORKS[chainKey].isTestnet || mainnetTransactionsEnabled) {
      return chainKey;
    }

    return 'sepolia';
  }, [activeChain?.key, mainnetTransactionsEnabled]);

  const selectedNetwork = NETWORKS[activeNetworkKey];
  const faucetUrl = getFaucetUrl(activeNetworkKey);
  const isWalletVerificationPending = hasMnemonic === null;
  const isSendDisabled = isWalletVerificationPending || hasMnemonic === false || !isSendSupported;

  // Payment data from previous screens
  const recipient = route?.params?.recipient || '';
  const amount = route?.params?.amount || '';
  const memo = route?.params?.memo || '';
  const token = route?.params?.token || 'ETH';
  const privacyLevel = route?.params?.privacyLevel || 'standard';

  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.PAYMENT_CONFIRMATION_VIEWED, {
      network_key: activeNetworkKey,
      token,
      privacy_level: privacyLevel,
      has_memo: Boolean(memo),
    });
  }, [activeNetworkKey, memo, privacyLevel, token]);

  // Fetch ETH price
  const fetchEthPrice = useCallback(async () => {
    setPriceLoading(true);
    setPriceError(null);

    try {
      const priceData = await getETHPrice();
      setEthPrice(priceData.price);
      setLastUpdated(priceData.lastUpdated);
      setIsStale(priceData.isStale);
    } catch (error) {
      setPriceError(error instanceof Error ? error.message : 'Failed to fetch price');
      if (ethPrice === null) {
        setEthPrice(FALLBACK_ETH_PRICE);
        setIsStale(true);
      }
    } finally {
      setPriceLoading(false);
    }
  }, [ethPrice]);

  // Check if mnemonic is available on mount — using address derivation
  // (mnemonic itself is never exposed to this component)
  useEffect(() => {
    async function checkMnemonic() {
      // deriveAddressFromStoredMnemonic uses the mnemonic internally
      // and returns only the public address — mnemonic stays scoped
      const address = await deriveAddressFromStoredMnemonic();
      if (isMountedRef.current) {
        setHasMnemonic(address !== null);
      }
    }

    checkMnemonic();
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      pollAbortRef.current?.abort();
    };
  }, []);

  // Fetch ETH price on mount and periodically
  useEffect(() => {
    fetchEthPrice();

    const intervalId = setInterval(fetchEthPrice, 60000);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchEthPrice]);

  useEffect(() => {
    if (txStatus !== 'idle') {
      return;
    }

    if (!recipient || !amount || !address || !isSendSupported) {
      setGasEstimate(null);
      setGasExpensive(false);
      return;
    }

    let isCancelled = false;

    const refreshGasEstimate = async () => {
      try {
        const parsedAmount = Number.parseFloat(amount);

        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          setGasEstimate(null);
          setGasExpensive(false);
          return;
        }

        const estimate = await estimateTransactionGas(
          {
            to: recipient,
            value: parsedAmount.toString(),
            from: address,
          },
          activeNetworkKey,
          ethPrice ?? undefined
        );

        if (isCancelled || !isMountedRef.current) {
          return;
        }

        setGasEstimate(estimate);
        setGasExpensive(isGasExpensive(estimate));
      } catch {
        if (isCancelled || !isMountedRef.current) {
          return;
        }

        setGasEstimate(null);
        setGasExpensive(false);
      }
    };

    refreshGasEstimate();
    const intervalId = setInterval(refreshGasEstimate, 15000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [activeNetworkKey, address, amount, ethPrice, isSendSupported, recipient, txStatus]);

  const handleBack = () => {
    trackEvent(ANALYTICS_EVENTS.PAYMENT_CONFIRMATION_BACK_PRESSED, {
      network_key: activeNetworkKey,
      tx_status: txStatus,
    });
    navigation.goBack();
  };

  const handleConfirmSend = async () => {
    const attemptStartedAt = Date.now();

    if (!recipient || !amount) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'missing_payment_details',
      });
      toast.show('Missing payment details', 'error');
      return;
    }

    // CRITICAL SECURITY VALIDATION: Verify the parsed amount is valid before use in transaction.
    // This prevents tampering between screens where the amount is passed as a string via navigation params.
    // Without this check, a malicious actor could manipulate the amount string to cause unexpected behavior
    // or exploit edge cases in the transaction logic.
    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'invalid_amount',
      });
      toast.show('Invalid payment amount', 'error');
      return;
    }

    if (isWalletVerificationPending) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'wallet_verification_pending',
      });
      toast.show('Wallet verification in progress. Please wait.', 'info');
      return;
    }

    if (hasMnemonic === false) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'wallet_not_initialized',
      });
      toast.show('Wallet not properly initialized. Please re-import your wallet.', 'error');
      return;
    }

    if (!isSendSupported) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'unsupported_network',
      });
      toast.show('Payments are only supported on EVM networks in this build.', 'error');
      return;
    }

    if (isConnected === false) {
      trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_VALIDATION_FAILED, {
        reason: 'offline',
      });
      toast.show('No internet connection', 'error');
      return;
    }

    trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_ATTEMPTED, {
      network_key: activeNetworkKey,
      token,
      privacy_level: privacyLevel,
      has_memo: Boolean(memo),
    });

    setTxStatus('sending');
    setTxResult(null);

    try {
      // ── Secure signing closure ──────────────────────────────────────────
      // signAndSendTransaction retrieves the mnemonic internally.
      // The mnemonic is NEVER returned to this component.
      const result = await signAndSendTransaction(
        {
          to: recipient,
          value: parsedAmount.toString(),
        },
        activeNetworkKey,
        ethPrice ?? undefined
      );

      // Check if gas was expensive
      setGasExpensive(isGasExpensive(result.gasEstimate));

      setTxResult({ hash: result.hash, status: 'pending' });
      setTxStatus('pending');
  
      toast.show('Transaction submitted! Waiting for confirmation...', 'success');
  
      // Poll for on-chain confirmation AND persist to wallet store
      const pollResult = await pollTransactionStatus({
        chainKey: activeNetworkKey,
        txHash: result.hash,
        fromAddress: address || '',
        toAddress: recipient,
        amountEth: parsedAmount.toString(),
        tokenSymbol: token || 'ETH',
        networkName: selectedNetwork?.name || activeNetworkKey,
        privacyLevel: privacyLevel === 'max' ? 'max' : 'standard',
        signal: pollAbortRef.current?.signal,
      });
  
      if (!isMountedRef.current) {
        return;
      }
  
      const finalTxResult: TransactionResult = {
        hash: result.hash,
        status: pollResult.status === 'completed' ? 'confirmed' : pollResult.status,
      };
      setTxResult(finalTxResult);
      setTxStatus(pollResult.status === 'completed' ? 'confirmed' : pollResult.status === 'failed' ? 'failed' : 'pending');
  
      if (pollResult.status === 'completed') {
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_CONFIRMED, {
          network_key: activeNetworkKey,
          tx_hash: result.hash,
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });
        toast.show('Payment sent successfully!', 'success');
      } else if (pollResult.status === 'failed') {
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
          network_key: activeNetworkKey,
          tx_hash: result.hash,
          reason: 'on_chain_failure',
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });
        toast.show('Transaction failed on-chain.', 'error');
      } else {
        // Timed out but still pending — tx may still confirm
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
          network_key: activeNetworkKey,
          tx_hash: result.hash,
          reason: 'confirmation_timeout',
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });
        toast.show('Transaction submitted but confirmation is taking longer than expected. Check your history later.', 'info');
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setTxStatus('failed');

      if (error instanceof TransactionError) {
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
          network_key: activeNetworkKey,
          reason: error.code,
          message: error.message,
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });

        switch (error.code) {
          case 'INSUFFICIENT_FUNDS':
            toast.show('Insufficient funds. Please add more ETH to your wallet.', 'error');
            break;
          case 'INVALID_ADDRESS':
            toast.show('Invalid recipient address. Please check and try again.', 'error');
            break;
          case 'NETWORK_ERROR':
            toast.show('Network error. Please check your connection and try again.', 'error');
            break;
          case 'USER_REJECTED':
            toast.show('Transaction cancelled.', 'error');
            break;
          default:
            toast.show(error.message, 'error');
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Failed to send payment';
        trackEvent(ANALYTICS_EVENTS.PAYMENT_SEND_FAILED, {
          network_key: activeNetworkKey,
          reason: 'unknown',
          message: errorMessage,
          confirmation_time_ms: Date.now() - attemptStartedAt,
        });
        toast.show(errorMessage, 'error');
      }
    }
  };

  const formatAddress = (addr: string) => {
    if (!addr) return 'Not available';
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
  };

  const handleViewOnExplorer = () => {
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

  // Get status display info
  const getStatusInfo = () => {
    switch (txStatus) {
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
                      Get Test ETH
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

          {/* Transaction Status Card */}
          {(txStatus === 'sending' || txStatus === 'pending' || txStatus === 'confirmed' || txStatus === 'failed') && (
            <SovereignCard
              backgroundColor={txStatus === 'confirmed' ? colors.successMuted : txStatus === 'failed' ? colors.error : colors.bgTertiary}
              padding={0}
              style={{ marginBottom: 24 }}
            >
              <View style={styles.statusContent}>
                {(txStatus === 'sending' || txStatus === 'pending') && (
                  <ActivityIndicator size="large" color={colors.accent} style={{ marginBottom: 12 }} />
                )}
                <Icon
                  name={txStatus === 'confirmed' ? 'success' : txStatus === 'failed' ? 'error' : 'hourglass'}
                  size={44}
                  color={txStatus === 'pending' || txStatus === 'sending' ? colors.accent : colors.textPrimary}
                  style={styles.statusIcon}
                />
                <Text style={styles.statusTitle}>{statusInfo.text}</Text>
                {txResult?.hash && (
                  <TouchableOpacity
                    onPress={handleViewOnExplorer}
                    style={styles.explorerButton}
                    accessibilityRole="button"
                    accessibilityLabel="View transaction on explorer"
                    accessibilityHint="Opens block explorer for this transaction"
                  >
                    <Text style={styles.statusHash}>TX: {formatAddress(txResult.hash)}</Text>
                    <View style={styles.explorerLinkRow}>
                      <Text style={styles.viewExplorer}>View on Explorer</Text>
                      <Icon name="chevron-right" size={12} color={colors.accent} style={styles.viewExplorerIcon} />
                    </View>
                  </TouchableOpacity>
                )}
                {txStatus === 'confirmed' && txResult?.blockNumber && (
                  <Text style={styles.blockInfo}>Block: {txResult.blockNumber}</Text>
                )}
                {txStatus === 'failed' && txResult?.error && (
                  <Text style={styles.errorText}>{txResult.error}</Text>
                )}
              </View>
            </SovereignCard>
          )}

          {/* Amount Display */}
          <View style={styles.amountSection}>
            <Text style={styles.amountLabel}>YOU ARE SENDING</Text>
          <View style={styles.amountDisplay}>
            <Text style={styles.amountValue} accessibilityLiveRegion="assertive">{amount}</Text>
              <Text style={styles.amountToken}>{token}</Text>
            </View>

            {/* USD Value with live price */}
            <View style={styles.usdValueContainer}>
              {priceLoading && ethPrice === null ? (
                <View style={styles.priceLoadingContainer}>
                  <Skeleton width={110} height={14} borderRadius={4} />
                  <Skeleton width={80} height={14} borderRadius={4} />
                </View>
              ) : (
                <>
                  <Text style={styles.usdValue}>
                    ≈ {formatUsdValue(parseFloat(amount || '0') * (ethPrice ?? FALLBACK_ETH_PRICE))}
                  </Text>
                  {lastUpdated && (
                    <Text style={styles.priceUpdated}>
                      @ ${ethPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/ETH
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
                  <Icon name={privacyLevel === 'max' ? 'private-lock' : 'shield'} size={16} color={colors.accent} />
                  <Text style={styles.privacyBadgeText}>
                    {privacyLevel === 'max' ? 'MAX' : 'STANDARD'}
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
            <SovereignCard backgroundColor={colors.warningBg} padding={0} style={{ marginBottom: 24 }}>
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
                <Text style={styles.privacyNoticeTitle}>PRIVATE TRANSACTION</Text>
                <Text style={styles.privacyNoticeDesc}>
                  {privacyLevel === 'max'
                    ? 'Zero-knowledge proof ensures complete transaction privacy.'
                    : 'Stealth address technology breaks on-chain linkability.'}
                </Text>
              </View>
            </View>
          </SovereignCard>

          {/* Action Buttons */}
          {txStatus === 'idle' && (
            <SovereignButton
              title={isWalletVerificationPending ? 'VERIFYING WALLET...' : 'CONFIRM & SEND'}
              variant={isSendDisabled ? 'outline' : 'primary'}
              onPress={handleConfirmSend}
              disabled={isSendDisabled}
              style={{ marginBottom: 32 }}
            />
          )}

          {(txStatus === 'sending' || txStatus === 'pending') && (
            <View style={{ marginBottom: 32 }}>
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

          {txStatus === 'confirmed' && (
            <View style={{ marginBottom: 32, gap: 12 }}>
              <SovereignButton
                title="VIEW ON EXPLORER"
                variant="primary"
                onPress={handleViewOnExplorer}
              />
              <SovereignButton
                title="BACK TO HOME"
                variant="outline"
                onPress={handleGoHome}
              />
            </View>
          )}

          {txStatus === 'failed' && (
            <View style={{ marginBottom: 32, gap: 12 }}>
              <SovereignButton
                title="TRY AGAIN"
                variant="primary"
                onPress={handleConfirmSend}
              />
              <SovereignButton
                title="BACK TO HOME"
                variant="outline"
                onPress={handleGoHome}
              />
            </View>
          )}
        </ScrollView>
      </Animated.View>

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
    marginBottom: 32,
  },
  amountLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  amountDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  amountValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 48,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  amountToken: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 24,
    color: colors.accent,
    fontWeight: 'bold',
  },
  usdValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textTertiary,
    marginTop: 4,
  },
  usdValueContainer: {
    alignItems: 'center',
    marginTop: 4,
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
    backgroundColor: colors.accentContainer,
    borderWidth: 0,
    borderColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
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
    borderRadius: 16,
    backgroundColor: colors.accentContainer,
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
