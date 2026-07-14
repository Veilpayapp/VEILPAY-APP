/* istanbul ignore file */
/**
 * Veilpay Send Payment Screen
 * Allows users to send payments with address input, amount, and token selection
 * Uses the current hybrid structural design language for all interactive elements
 */

import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar, TextInput, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { useWalletStore, validateAddress, ChainType } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from '../components/Toast';
import { Logo } from '../components/Logo';
import { BottomNavBar } from '../components/BottomNavBar';
import { Icon } from '../components/Icon';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { AddressBookModal } from '../components/dashboard/AddressBookModal';
import { getClipboardString } from '../utils/clipboard';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import { useBiometrics } from '../hooks/useBiometrics';
import { FALLBACK_ETH_PRICE } from '../utils/priceFeed';
import { useSettingsStore } from '../stores/settingsStore';
import { useMarketData } from '../hooks/useMarketData';
import { formatFiat as formatFiatValue } from '../utils/formatters';
import { USD_TO_FIAT, type FiatCurrency } from '../utils/transak';
import type { PaymentToken } from '../types/tokens';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  canActivatePrivacyAsset,
  getPrivacyAssetById,
  privacyAssetToPaymentToken,
} from '../constants/privacyAssets';
import { getLocalPrivateBalance } from '../utils/stellarSpp';
import { useSecureScreen } from '../hooks/useSecureScreen';

type SendPaymentScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SendPayment'>;
type SendPaymentScreenRoute = RouteProp<RootStackParamList, 'SendPayment'>;
type SendMode = 'public' | 'shield' | 'transfer' | 'unshield';

interface SendPaymentScreenProps {
  navigation: SendPaymentScreenNavigationProp;
  route: SendPaymentScreenRoute;
}

export function SendPaymentScreen({ navigation, route }: SendPaymentScreenProps) {
  useSecureScreen('SendPayment');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useStyles(themeStyles);
  // Pre-filled data from QR scan (if any). Read once at mount; used to seed the form.
  const scannedAddress = route?.params?.address || '';
  const scannedAmount = route?.params?.amount || '';
  const routeMode = route?.params?.mode;
  const routeForcePrivate = route?.params?.forcePrivate;
  const routePrivacyAssetId = route?.params?.privacyAssetId;
  const routeLockMode = route?.params?.lockMode === true;

  const [recipientAddress, setRecipientAddress] = useState(scannedAddress);
  const [amount, setAmount] = useState(scannedAmount);
  const [memo, setMemo] = useState('');
  const [isRecipientTouched, setIsRecipientTouched] = useState(false);
  const [isAmountTouched, setIsAmountTouched] = useState(false);
  const [selectedPercent, setSelectedPercent] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isAddressBookVisible, setIsAddressBookVisible] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>(
    routeMode === 'shield' || routeMode === 'transfer' || routeMode === 'unshield'
      ? routeMode
      : 'public'
  );
  const [privateBalance, setPrivateBalance] = useState('0');
  const lastContinueAttemptRef = useRef(0);

  const { activeChain, balance, address } = useWalletStore();
  const { nativeCurrency, selectedPrivacyAssetId } = useSettingsStore();
  const toast = useToast();
  const { authenticate } = useBiometrics();

  const privacyAssetId =
    routePrivacyAssetId ||
    selectedPrivacyAssetId ||
    (activeChain?.key === 'stellar-testnet' ? 'spp-xlm-testnet' : null);
  const privacyAsset = getPrivacyAssetById(privacyAssetId);
  const isPrivacyMode =
    sendMode === 'shield' || sendMode === 'transfer' || sendMode === 'unshield';
  
  const [isUsdInput, setIsUsdInput] = useState(false);
  const [selectedToken, setSelectedToken] = useState<PaymentToken>(() => {
    const asset = getPrivacyAssetById(routePrivacyAssetId || selectedPrivacyAssetId);
    if (
      asset &&
      canActivatePrivacyAsset(asset) &&
      (routeMode === 'shield' ||
        routeMode === 'transfer' ||
        routeMode === 'unshield' ||
        routeForcePrivate)
    ) {
      // shield spends public XLM; transfer/unshield spend private balance
      if (routeMode === 'shield') {
        return {
          id: `${asset.chainKey}-${asset.quoteSymbol}`,
          name: asset.quoteSymbol,
          symbol: asset.quoteSymbol,
          balance: '0',
          usdPrice: 0,
          chainTypes: ['xlm'],
        };
      }
      return privacyAssetToPaymentToken(asset, '0');
    }
    return {
      id: `${activeChain?.key || 'ethereum'}-${activeChain?.nativeToken.symbol || 'ETH'}`,
      name: activeChain?.nativeToken.name || 'Ether',
      symbol: activeChain?.nativeToken.symbol || 'ETH',
      balance: balance || '0.000',
      usdPrice: 0,
      chainTypes: [activeChain?.type || 'evm'],
    };
  });

  // pXLM quotes off XLM market price
  const quoteSymbol =
    selectedToken.isPrivacyAsset || sendMode === 'transfer' || sendMode === 'unshield'
      ? privacyAsset?.quoteSymbol || 'XLM'
      : selectedToken.symbol;
  const { getQuote } = useMarketData([quoteSymbol, selectedToken.symbol]);
  const marketData = getQuote(quoteSymbol) || getQuote(selectedToken.symbol);
  const currentFiatUsdPrice = marketData?.price || 0;
  const fiatMultiplier = USD_TO_FIAT[(nativeCurrency as FiatCurrency) || 'USD'] || 1.0;
  const currentFiatPrice = currentFiatUsdPrice * fiatMultiplier;

  const chainType = (activeChain?.type as ChainType) || 'evm';
  const trimmedRecipientAddress = recipientAddress.trim();
  const hasRecipient = trimmedRecipientAddress.length > 0;
  const isRecipientValid = hasRecipient && validateAddress(trimmedRecipientAddress, chainType);
  /** Shield has no external recipient; unshield may default to self. */
  const needsRecipient = sendMode === 'public' || sendMode === 'transfer';
  const recipientOk =
    sendMode === 'shield' ||
    (sendMode === 'unshield' && (!hasRecipient || isRecipientValid)) ||
    ((sendMode === 'public' || sendMode === 'transfer') && isRecipientValid);

  const normalizedAmount = amount.replace(',', '.');
  const parsedAmount = Number.parseFloat(normalizedAmount);
  const hasAmount = amount.trim().length > 0;
  const isAmountValid = hasAmount && Number.isFinite(parsedAmount) && parsedAmount > 0;

  // Pre-send balance gate. Compare the *crypto* amount against the available
  // balance for the active mode (public XLM for shield, pXLM for transfer/unshield).
  const availableBalanceNum = Number.parseFloat(selectedToken.balance || '0');
  const cryptoAmount = isUsdInput && currentFiatPrice > 0
    ? parsedAmount / currentFiatPrice
    : parsedAmount;
  const exceedsBalance =
    isAmountValid &&
    Number.isFinite(availableBalanceNum) &&
    Number.isFinite(cryptoAmount) &&
    cryptoAmount > availableBalanceNum;

  const recipientError = !isRecipientTouched
    ? ''
    : sendMode === 'shield'
      ? ''
      : sendMode === 'unshield' && !hasRecipient
        ? ''
        : !hasRecipient
          ? 'Recipient address is required.'
          : !isRecipientValid
            ? `Enter a valid ${activeChain?.name || 'Stellar'} address.`
            : '';

  const amountError = !isAmountTouched
    ? ''
    : !hasAmount
      ? 'Amount is required.'
      : !isAmountValid
        ? 'Enter a valid amount greater than 0.'
        : exceedsBalance
          ? `Amount exceeds your available balance of ${selectedToken.balance} ${selectedToken.symbol}.`
          : '';

  const canContinue = recipientOk && isAmountValid && !exceedsBalance;

  React.useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_VIEWED, {
      chain_key: activeChain?.key || 'unknown',
      chain_type: activeChain?.type || 'unknown',
      token_symbol: selectedToken.symbol,
      prefilled_address: Boolean(scannedAddress),
      prefilled_amount: Boolean(scannedAmount),
    });
  }, [
    activeChain?.key,
    activeChain?.type,
    scannedAddress,
    scannedAmount,
    selectedToken.symbol,
  ]);

  // Load private note balance when in transfer/unshield (or privacy token selected).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!address || !privacyAsset || privacyAsset.protocol !== 'spp') {
        if (!cancelled) setPrivateBalance('0');
        return;
      }
      try {
        const { amount: bal } = await getLocalPrivateBalance(privacyAsset.chainKey, address);
        if (!cancelled) setPrivateBalance(bal);
      } catch {
        if (!cancelled) setPrivateBalance('0');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, privacyAsset]);

  // Keep token balance in sync with mode: shield uses public XLM; private modes use pXLM.
  React.useEffect(() => {
    if (!activeChain) {
      return;
    }

    if (isPrivacyMode && privacyAsset && canActivatePrivacyAsset(privacyAsset)) {
      if (sendMode === 'shield') {
        setSelectedToken({
          id: `${activeChain.key}-${activeChain.nativeToken.symbol}`,
          name: activeChain.nativeToken.name,
          symbol: activeChain.nativeToken.symbol,
          balance: balance || '0.000',
          usdPrice: FALLBACK_ETH_PRICE,
          chainTypes: [activeChain.type],
        });
      } else {
        setSelectedToken(privacyAssetToPaymentToken(privacyAsset, privateBalance));
      }
      return;
    }

    if (selectedToken.isPrivacyAsset) {
      return;
    }

    setSelectedToken({
      id: `${activeChain.key}-${activeChain.nativeToken.symbol}`,
      name: activeChain.nativeToken.name,
      symbol: activeChain.nativeToken.symbol,
      balance: balance || '0.000',
      usdPrice: FALLBACK_ETH_PRICE,
      chainTypes: [activeChain.type],
    });
  }, [
    activeChain,
    balance,
    isPrivacyMode,
    privacyAsset,
    privateBalance,
    sendMode,
    selectedToken.isPrivacyAsset,
  ]);

  const handleBack = () => {
    trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_BACK_PRESSED, {
      chain_key: activeChain?.key || 'unknown',
    });
    navigation.goBack();
  };

  const handleScanQR = () => {
    trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_SCAN_QR_PRESSED, {
      chain_key: activeChain?.key || 'unknown',
      chain_type: activeChain?.type || 'unknown',
    });
    navigation.navigate(SCREENS.QR_SCANNER);
  };

  const handlePaste = async () => {
    const clipboardValue = (await getClipboardString()).trim();
    if (!clipboardValue) {
      trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_PASTE_FAILED, {
        reason: 'clipboard_unavailable_or_empty',
      });
      toast.show('Clipboard unavailable or empty', 'error');
      return;
    }

    let addressToSet = clipboardValue;
    let amountToSet: string | null = null;

    const ethUriMatch = clipboardValue.match(/^ethereum:([^?]+)(?:\?(.*))?$/i);
    if (ethUriMatch) {
      addressToSet = decodeURIComponent(ethUriMatch[1]);
      const queryString = ethUriMatch[2] || '';
      const params = new URLSearchParams(queryString);
      const parsedAmount = params.get('amount');
      if (parsedAmount) {
        amountToSet = parsedAmount;
      }
    }

    const veilpayMatch = clipboardValue.match(/^veilpay:\/\/send\?(.*)$/i);
    if (veilpayMatch) {
      const params = new URLSearchParams(veilpayMatch[1]);
      addressToSet = params.get('address') || addressToSet;
      amountToSet = params.get('amount') || amountToSet;
    }

    setRecipientAddress(addressToSet);
    setIsRecipientTouched(true);
    if (amountToSet) {
      setAmount(amountToSet);
      setIsAmountTouched(true);
    }

    trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_PASTE_SUCCESS, {
      source: ethUriMatch ? 'ethereum_uri' : veilpayMatch ? 'veilpay_link' : 'plain_text',
      included_amount: Boolean(amountToSet),
    });

    toast.show('Payment details pasted from clipboard', 'success');
  };

  const handleRecipientAddressChange = (value: string) => {
    setRecipientAddress(value);
    if (!isRecipientTouched) {
      setIsRecipientTouched(true);
    }
  };

  const handleAmountChange = (text: string) => {
    // Only allow numbers and decimal point
    const filtered = text.replace(/[^0-9.]/g, '');
    
    // Prevent multiple decimal points
    const parts = filtered.split('.');
    const cleanText = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : filtered;
    
    setAmount(cleanText);
    setSelectedPercent(null); // Clear selected percent when manual input
    if (!isAmountTouched) {
      setIsAmountTouched(true);
    }
  };

  const toggleInputCurrency = () => {
    if (!amount) {
      setIsUsdInput(!isUsdInput);
      return;
    }
    
    // Convert current amount when switching
    if (isUsdInput && currentFiatPrice > 0) {
      // Switch from Fiat to Crypto
      setAmount((parsedAmount / currentFiatPrice).toFixed(6));
    } else if (!isUsdInput && currentFiatPrice > 0) {
      // Switch from Crypto to Fiat
      setAmount((parsedAmount * currentFiatPrice).toFixed(2));
    }
    
    setIsUsdInput(!isUsdInput);
  };

  const validateInputs = (): boolean => {
    setIsRecipientTouched(true);
    setIsAmountTouched(true);

    if (needsRecipient) {
      if (!hasRecipient) {
        trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_VALIDATION_FAILED, {
          reason: 'missing_recipient',
        });
        toast.show('Please enter a recipient address', 'error');
        return false;
      }

      if (!isRecipientValid) {
        trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_VALIDATION_FAILED, {
          reason: 'invalid_recipient',
          chain_type: chainType,
        });
        toast.show(`Invalid ${activeChain?.name || 'Stellar'} address format`, 'error');
        return false;
      }
    } else if (sendMode === 'unshield' && hasRecipient && !isRecipientValid) {
      toast.show('Enter a valid public Stellar address', 'error');
      return false;
    }

    if (!isAmountValid) {
      trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_VALIDATION_FAILED, {
        reason: 'invalid_amount',
      });
      toast.show('Please enter a valid amount', 'error');
      return false;
    }

    if (exceedsBalance) {
      trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_VALIDATION_FAILED, {
        reason: 'insufficient_balance',
      });
      toast.show('Amount exceeds your available balance', 'error');
      return false;
    }

    return true;
  };

  const handleContinue = async () => {
    const now = Date.now();
    if (now - lastContinueAttemptRef.current < 1200) {
      return;
    }

    if (!validateInputs()) return;

    lastContinueAttemptRef.current = now;

    // Biometrics flow
    setIsAuthenticating(true);

    // ALWAYS require authentication to move funds, regardless of the app
    // biometric-lock toggle. Passing `true` allows the device PIN/passcode as a
    // fallback when no biometrics are enrolled, so the wallet is never spendable
    // with no user auth at all. `authenticate()` returns a result object — check
    // `.success` (an object is always truthy, so `if (!result)` never fired).
    const authResult = await authenticate('send_payment', true);
    if (!authResult.success) {
      toast.show(
        authResult.cancelled ? 'Authentication cancelled' : 'Authentication failed',
        'error',
      );
      setIsAuthenticating(false);
      return;
    }

    setIsAuthenticating(false);

    trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_CONTINUE_PRESSED, {
      chain_key: activeChain?.key || 'unknown',
      token_symbol: selectedToken.symbol,
      has_memo: Boolean(memo.trim()),
    });

    let finalCryptoAmount = amount.trim();
    if (isUsdInput && currentFiatPrice > 0) {
      const parsedAmount = Number.parseFloat(amount);
      if (Number.isFinite(parsedAmount)) {
        finalCryptoAmount = (parsedAmount / currentFiatPrice).toFixed(6);
      }
    }

    // Privacy-pool modes skip the Privacy Level picker and go straight to confirm.
    if (isPrivacyMode) {
      const dest =
        sendMode === 'shield'
          ? address || ''
          : sendMode === 'unshield'
            ? recipientAddress.trim() || address || ''
            : recipientAddress.trim();

      navigation.navigate(SCREENS.PAYMENT_CONFIRMATION, {
        recipient: dest,
        amount: finalCryptoAmount,
        memo: memo.trim(),
        token: selectedToken.symbol,
        privacyLevel: 'private',
        sppOp: sendMode,
      });
      return;
    }

    // Prefer Private when home is in SPP mode or user picked pXLM in token selector.
    const storePrivacyId = useSettingsStore.getState().selectedPrivacyAssetId;
    const preferPrivate =
      !!selectedToken.isPrivacyAsset ||
      (!!storePrivacyId && activeChain?.key === 'stellar-testnet') ||
      !!routeForcePrivate;

    if (preferPrivate && selectedToken.isPrivacyAsset) {
      navigation.navigate(SCREENS.PAYMENT_CONFIRMATION, {
        recipient: recipientAddress.trim(),
        amount: finalCryptoAmount,
        memo: memo.trim(),
        token: selectedToken.symbol,
        privacyLevel: 'private',
        sppOp: 'transfer',
      });
      return;
    }

    // Navigate to privacy level selection (Stellar shows Standard / Private).
    navigation.navigate(SCREENS.PRIVACY_LEVEL, {
      recipient: recipientAddress.trim(),
      amount: finalCryptoAmount,
      memo: memo.trim(),
      token: selectedToken.symbol,
      tokenAddress: selectedToken.address,
      tokenDecimals: selectedToken.decimals,
      preferredPrivacyLevel: preferPrivate ? 'private' : undefined,
    });
  };
  
  const handleNavPress = (screen: keyof RootStackParamList) => {
    if (screen === SCREENS.SEND_PAYMENT) {
      // Already on send
    } else {
      navigation.navigate(screen as never);
    }
  };

  const handleSelectToken = () => {
    trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_TOKEN_SELECTOR_OPENED, {
      chain_key: activeChain?.key || 'unknown',
      current_token_symbol: selectedToken.symbol,
    });

    navigation.navigate(SCREENS.TOKEN_SELECTOR, {
      chainKey: activeChain?.key,
      selectedSymbol: selectedToken.symbol,
      onSelect: (token: PaymentToken) => {
        setSelectedToken(token);
        if (token.isPrivacyAsset && token.privacyAssetId) {
          useSettingsStore.getState().setSelectedPrivacyAssetId(token.privacyAssetId);
          if (sendMode === 'public') {
            setSendMode('transfer');
          }
        } else {
          setSendMode('public');
        }
      },
    });
  };

  const setMode = (mode: SendMode) => {
    setSendMode(mode);
    if (mode !== 'public' && privacyAsset) {
      useSettingsStore.getState().setSelectedPrivacyAssetId(privacyAsset.id);
    }
    setIsRecipientTouched(false);
    setIsAmountTouched(false);
  };

  const headerTitle =
    sendMode === 'shield'
      ? 'SHIELD'
      : sendMode === 'unshield'
        ? 'UNSHIELD'
        : sendMode === 'transfer'
          ? 'SEND PRIVATELY'
          : 'SEND PAYMENT';

  const privacyHelp =
    sendMode === 'shield'
      ? 'Moves public XLM into your private balance. Proof runs on this device (~10–20s).'
      : sendMode === 'unshield'
        ? 'Returns private balance to a public Stellar address. Leave blank to unshield to yourself.'
        : sendMode === 'transfer'
          ? 'Pays from your private balance. Recipient needs a Stellar address with private receive enabled.'
          : 'Choose your privacy level on the next screen.';

  // Chips when user is in a privacy context but didn't lock a single Home action.
  const showModeChips =
    !routeLockMode &&
    !!privacyAsset &&
    canActivatePrivacyAsset(privacyAsset) &&
    (isPrivacyMode ||
      selectedToken.isPrivacyAsset ||
      !!routeForcePrivate ||
      activeChain?.key === 'stellar-testnet');

  const privateBalanceEmpty =
    (sendMode === 'transfer' || sendMode === 'unshield') &&
    Number.parseFloat(privateBalance || '0') <= 0;

  const recipientSectionLabel =
    sendMode === 'unshield'
      ? 'PUBLIC ADDRESS (OPTIONAL)'
      : sendMode === 'transfer'
        ? 'RECIPIENT ADDRESS'
        : `${activeChain?.type?.toUpperCase() || 'EVM'} RECIPIENT ADDRESS`;

  const recipientPlaceholder =
    sendMode === 'unshield'
      ? 'Leave blank for your address, or paste a G… address'
      : sendMode === 'transfer'
        ? 'Enter Stellar address (G…)'
        : `Enter ${activeChain?.name || 'Ethereum'} address`;

  const handleQuickAmount = (percent: string) => {
    setSelectedPercent(percent);
    const balanceNum = parseFloat(selectedToken.balance || '0');
    if (percent === 'MAX') {
      const gasReserveMap: Record<string, number> = {
        ethereum: 0.01, polygon: 0.005, arbitrum: 0.002, sepolia: 0.001,
      };
      const gasReserve = activeChain?.type === 'evm'
        ? (gasReserveMap[activeChain.key] ?? 0.005)
        : 0;
      const maxAmount = Math.max(0, balanceNum - gasReserve);
      setAmount(maxAmount.toFixed(6));
    } else {
      const multiplier = parseInt(percent) / 100;
      setAmount((balanceNum * multiplier).toFixed(6));
    }
    setIsAmountTouched(true);
    trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_QUICK_AMOUNT_SELECTED, {
      percent, token_symbol: selectedToken.symbol,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

        {/* Header */}
        <View style={styles.header}>
        <ScreenBackButton onPress={handleBack} />
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{headerTitle}</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Account Selector Section */}
            <SovereignCard backgroundColor={colors.surfaceCard} padding={20} style={{ marginBottom: 24 }}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardLabel}>
                    {sendMode === 'shield'
                      ? 'FROM PUBLIC BALANCE'
                      : sendMode === 'unshield' || sendMode === 'transfer'
                        ? 'FROM PRIVATE BALANCE'
                        : 'SENDING FROM'}
                  </Text>
                  <Text style={styles.chainName}>
                    {isPrivacyMode
                      ? 'PRIVATE XLM · TESTNET'
                      : activeChain?.name.toUpperCase() || 'ETHEREUM'}
                  </Text>
                </View>
                <View style={styles.iconCircle}>
                  <Logo variant="icon" size="small" />
                </View>
              </View>
              <View
                style={styles.balanceRow}
                accessible
                accessibilityLabel={`Available balance ${selectedToken.balance} ${selectedToken.symbol}`}
              >
                <Text style={styles.balanceLabel}>Available Balance</Text>
                <Text style={styles.balanceAmount}>≈ {selectedToken.balance} {selectedToken.symbol}</Text>
              </View>
            </SovereignCard>

            {showModeChips ? (
              <View style={styles.modeChipRow}>
                {(
                  [
                    { id: 'shield' as const, label: 'Shield' },
                    { id: 'transfer' as const, label: 'Send privately' },
                    { id: 'unshield' as const, label: 'Unshield' },
                  ] as const
                ).map((chip) => (
                  <PressableOpacity
                    key={chip.id}
                    onPress={() => setMode(chip.id)}
                    style={[
                      styles.modeChip,
                      sendMode === chip.id && styles.modeChipActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: sendMode === chip.id }}
                  >
                    <Text
                      style={[
                        styles.modeChipText,
                        sendMode === chip.id && styles.modeChipTextActive,
                      ]}
                    >
                      {chip.label}
                    </Text>
                  </PressableOpacity>
                ))}
              </View>
            ) : null}

            {privateBalanceEmpty ? (
              <SovereignCard backgroundColor={colors.surfaceCard} padding={16} style={{ marginBottom: 20 }}>
                <Text style={styles.privacyTitle}>NO PRIVATE BALANCE YET</Text>
                <Text style={styles.privacyDescription}>
                  Shield some public XLM first, then you can send privately or unshield.
                </Text>
                <PressableOpacity
                  onPress={() => setMode('shield')}
                  style={[styles.modeChip, styles.modeChipActive, { alignSelf: 'flex-start', marginTop: 12 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Shield XLM"
                >
                  <Text style={[styles.modeChipText, styles.modeChipTextActive]}>Shield XLM</Text>
                </PressableOpacity>
              </SovereignCard>
            ) : null}

            {/* Recipient — hidden for shield (funds your own private balance) */}
            {sendMode !== 'shield' ? (
              <>
                <Text style={styles.sectionLabel}>{recipientSectionLabel}</Text>
                <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.addressInput}
                      value={recipientAddress}
                      onChangeText={handleRecipientAddressChange}
                      onBlur={() => setIsRecipientTouched(true)}
                      placeholder={recipientPlaceholder}
                      placeholderTextColor={colors.textFaint}
                      autoCapitalize="none"
                      autoCorrect={false}
                      multiline
                      numberOfLines={2}
                      accessibilityLabel="Recipient address"
                      accessibilityHint={recipientPlaceholder}
                    />
                    <View style={styles.inputActions}>
                      <PressableOpacity
                        onPress={() => setIsAddressBookVisible(true)}
                        style={styles.inputActionBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Open address book"
                      >
                        <Icon name="wallet" size={20} color={colors.accent} />
                      </PressableOpacity>
                      <PressableOpacity
                        onPress={handleScanQR}
                        style={styles.inputActionBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Scan QR code"
                      >
                        <Icon name="camera" size={20} color={colors.accent} />
                      </PressableOpacity>
                      <PressableOpacity
                        onPress={handlePaste}
                        style={styles.inputActionBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Paste from clipboard"
                      >
                        <Icon name="copy" size={20} color={colors.accent} />
                      </PressableOpacity>
                    </View>
                  </View>
                </SovereignCard>
                {recipientError ? <Text style={styles.validationError}>{recipientError}</Text> : null}
              </>
            ) : (
              <SovereignCard backgroundColor={colors.surfaceCard} padding={16} style={{ marginBottom: 24 }}>
                <Text style={styles.privacyTitle}>TO YOUR PRIVATE BALANCE</Text>
                <Text style={styles.privacyDescription}>
                  No recipient needed — this shields XLM for you.
                </Text>
              </SovereignCard>
            )}

            {/* Amount Input */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>AMOUNT</Text>
              <PressableOpacity
                onPress={toggleInputCurrency}
                accessibilityRole="button"
                accessibilityLabel={`Switch amount entry to ${isUsdInput ? selectedToken.symbol : (nativeCurrency || 'USD')}`}
              >
                <Text style={{ fontFamily: typography.fontFamily.mono, fontSize: 12, color: colors.accent, fontWeight: 'bold' }}>
                  SWAP TO {isUsdInput ? selectedToken.symbol : (nativeCurrency || 'USD')}
                </Text>
              </PressableOpacity>
            </View>
            <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
              <View style={styles.amountRow}>
                {isUsdInput && <Text style={[styles.amountInput, { flex: 0, marginRight: 8, color: colors.textSecondary }]}>{nativeCurrency === 'EUR' ? '€' : nativeCurrency === 'GBP' ? '£' : nativeCurrency === 'INR' ? '₹' : '$'}</Text>}
                <TextInput
                  style={styles.amountInput}
                  value={amount}
                  onChangeText={handleAmountChange}
                  onBlur={() => setIsAmountTouched(true)}
                  placeholder="0.00"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Payment amount"
                  accessibilityHint={`Amount to send in ${isUsdInput ? (nativeCurrency || 'USD') : selectedToken.symbol}`}
                />
                <PressableOpacity
                  onPress={handleSelectToken}
                  style={styles.tokenSelector}
                  accessibilityRole="button"
                  accessibilityLabel={`Selected token ${selectedToken.symbol}. Change token`}
                >
                  <Text style={styles.tokenSymbol}>{isUsdInput ? (nativeCurrency || 'USD') : selectedToken.symbol}</Text>
                  {!isUsdInput && <Icon name={'chevron-down'} size={14} color={colors.textMuted} />}
                </PressableOpacity>
              </View>
            </SovereignCard>
            {amountError ? <Text style={styles.validationError}>{amountError}</Text> : null}

            {/* Fiat equivalent */}
            {isAmountValid && currentFiatPrice > 0 && (
              <View style={styles.fiatRow}>
                <Text style={styles.fiatLabel}>
                  {isUsdInput
                    ? `≈ ${(parsedAmount / currentFiatPrice).toFixed(6)} ${selectedToken.symbol}`
                    : `≈ ${nativeCurrency === 'EUR' ? '€' : nativeCurrency === 'GBP' ? '£' : nativeCurrency === 'INR' ? '₹' : '$'}${formatFiatValue(parsedAmount * currentFiatPrice)}`}
                </Text>
              </View>
            )}

            {/* Quick Amount Buttons */}
            <View style={styles.quickAmountRow}>
              {['25%', '50%', '75%', 'MAX'].map((percent) => (
                <PressableOpacity
                  key={percent}
                  onPress={() => handleQuickAmount(percent)}
                  style={[
                    styles.quickAmountCard,
                    selectedPercent === percent && styles.quickAmountCardActive,
                  ]}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={
                    percent === 'MAX'
                      ? 'Use maximum available amount'
                      : `Use ${percent} of balance`
                  }
                  accessibilityState={{ selected: selectedPercent === percent }}
                >
                  <Text
                    style={[
                      styles.quickAmountText,
                      selectedPercent === percent && styles.quickAmountTextActive,
                    ]}
                  >
                    {percent}
                  </Text>
                </PressableOpacity>
              ))}
            </View>

            {/* Memo — public sends only (SPP does not surface memos) */}
            {!isPrivacyMode ? (
              <>
                <Text style={styles.sectionLabel}>MEMO (OPTIONAL)</Text>
                <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
                  <TextInput
                    style={styles.memoInput}
                    value={memo}
                    onChangeText={setMemo}
                    placeholder="Add a note for this transaction"
                    placeholderTextColor={colors.textFaint}
                    accessibilityLabel="Payment memo, optional"
                  />
                </SovereignCard>
              </>
            ) : null}

            {/* Privacy / mode help */}
            <SovereignCard backgroundColor={colors.surfaceCard} padding={16} style={styles.privacyCard}>
              <View style={styles.privacyHeader}>
                <Icon
                  name={isPrivacyMode ? 'private-lock' : 'shield'}
                  size={18}
                  color={colors.accent}
                />
                <Text style={styles.privacyTitle}>
                  {sendMode === 'shield'
                    ? 'SHIELD'
                    : sendMode === 'unshield'
                      ? 'UNSHIELD'
                      : sendMode === 'transfer'
                        ? 'PRIVATE SEND'
                        : 'PRIVACY'}
                </Text>
              </View>
              <Text style={styles.privacyDescription}>{privacyHelp}</Text>
            </SovereignCard>
          </ScrollView>

          <View style={[styles.footerContainer, { marginBottom: 72 + Math.max(insets.bottom, 16) }]}>
            <SovereignButton
              title={
                isAuthenticating
                  ? 'AUTHENTICATING...'
                  : sendMode === 'shield'
                    ? 'CONTINUE TO SHIELD'
                    : sendMode === 'unshield'
                      ? 'CONTINUE TO UNSHIELD'
                      : sendMode === 'transfer'
                        ? 'CONTINUE'
                        : 'CONTINUE'
              }
              onPress={handleContinue}
              disabled={!canContinue || isAuthenticating}
              variant={canContinue ? 'primary' : 'outline'}
              style={styles.continueButton}
            />
          </View>
        </KeyboardAvoidingView>

      <AddressBookModal
        visible={isAddressBookVisible}
        onClose={() => setIsAddressBookVisible(false)}
        onSelect={(addr) => {
          setRecipientAddress(addr);
          setIsRecipientTouched(true);
        }}
        currentChain={activeChain?.key || ''}
      />

      <BottomNavBar currentScreen={SCREENS.SEND_PAYMENT} onNavigate={handleNavPress} />

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
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  // Matches ScreenBackButton width (80) so the centered title is truly centered.
  headerSpacer: {
    width: 80,
  },
  headerTitle: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 16,
    color: colors.textPrimary,
    letterSpacing: 1,
    textAlign: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 6,
  },
  chainName: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 20,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 0,
    backgroundColor: colors.bgContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.outlineSubtle,
  },
  balanceLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textSecondary,
  },
  balanceAmount: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  sectionLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  addressInput: {
    flex: 1,
    fontFamily: typography.fontFamily.mono,
    fontSize: 15,
    color: colors.textPrimary,
    paddingHorizontal: 20,
    minHeight: 52,
  },
  inputActions: {
    flexDirection: 'row',
  },
  inputActionBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validationError: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: 12,
    color: colors.error,
    marginBottom: 12,
    marginTop: -8,
  },
  fiatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -16,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  fiatLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  amountInput: {
    flex: 1,
    fontFamily: typography.fontFamily.mono,
    fontSize: 32,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  tokenSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  tokenSymbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: 'bold',
  },
  quickAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
    gap: 12,
  },
  quickAmountCard: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  quickAmountCardActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  quickAmountText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: 'bold',
  },
  quickAmountTextActive: {
    color: colors.bgPrimary,
  },
  memoInput: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 16,
    minHeight: 56,
  },
  modeChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  modeChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle ?? colors.border,
    backgroundColor: colors.surfaceCard,
  },
  modeChipActive: {
    borderColor: colors.accent,
  },
  modeChipText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  modeChipTextActive: {
    color: colors.accent,
  },
  privacyCard: {
    marginBottom: 40,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  privacyTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 13,
    color: colors.accent,
    letterSpacing: 0.5,
    fontWeight: 'bold',
  },
  privacyDescription: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    marginTop: 4,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    padding: 16,
    borderRadius: 0,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    gap: 10,
  },
  warningText: {
    flex: 1,
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: 13,
    color: colors.warning,
    lineHeight: 18,
  },
  footerContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.outlineSubtle,
    backgroundColor: colors.bgPrimary,
  },
  continueButton: {
    marginTop: 0,
    height: 56,
  },
  addressBookModal: {
    // handled by AddressBookModal component
  },
});

