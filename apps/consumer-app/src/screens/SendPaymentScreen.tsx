/* istanbul ignore file */
/**
 * Veilpay Send Payment Screen
 * Allows users to send payments with address input, amount, and token selection
 * Uses the current hybrid structural design language for all interactive elements
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
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

type SendPaymentScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SendPayment'>;
type SendPaymentScreenRoute = RouteProp<RootStackParamList, 'SendPayment'>;

interface SendPaymentScreenProps {
  navigation: SendPaymentScreenNavigationProp;
  route: SendPaymentScreenRoute;
}

export function SendPaymentScreen({ navigation, route }: SendPaymentScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useStyles(themeStyles);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isRecipientTouched, setIsRecipientTouched] = useState(false);
  const [isAmountTouched, setIsAmountTouched] = useState(false);
  const [selectedPercent, setSelectedPercent] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isAddressBookVisible, setIsAddressBookVisible] = useState(false);
  const lastContinueAttemptRef = useRef(0);

  const { activeChain, balance } = useWalletStore();
  const { nativeCurrency, biometricsEnabled } = useSettingsStore();
  const toast = useToast();
  const { isAvailable, authenticate } = useBiometrics();
  
  const [isUsdInput, setIsUsdInput] = useState(false);
  const [selectedToken, setSelectedToken] = useState<PaymentToken>({
    id: `${activeChain?.key || 'ethereum'}-${activeChain?.nativeToken.symbol || 'ETH'}`,
    name: activeChain?.nativeToken.name || 'Ether',
    symbol: activeChain?.nativeToken.symbol || 'ETH',
    balance: balance || '0.000',
    usdPrice: 0,
    chainTypes: [activeChain?.type || 'evm'],
  });

  const { getQuote } = useMarketData([selectedToken.symbol]);
  const marketData = getQuote(selectedToken.symbol);
  const currentFiatUsdPrice = marketData?.price || 0;
  const fiatMultiplier = USD_TO_FIAT[(nativeCurrency as FiatCurrency) || 'USD'] || 1.0;
  const currentFiatPrice = currentFiatUsdPrice * fiatMultiplier;

  const chainType = (activeChain?.type as ChainType) || 'evm';
  const trimmedRecipientAddress = recipientAddress.trim();
  const hasRecipient = trimmedRecipientAddress.length > 0;
  const isRecipientValid = hasRecipient && validateAddress(trimmedRecipientAddress, chainType);

  const normalizedAmount = amount.replace(',', '.');
  const parsedAmount = Number.parseFloat(normalizedAmount);
  const hasAmount = amount.trim().length > 0;
  const isAmountValid = hasAmount && Number.isFinite(parsedAmount) && parsedAmount > 0;

  const recipientError = !isRecipientTouched
    ? ''
    : !hasRecipient
      ? 'Recipient address is required.'
      : !isRecipientValid
        ? `Enter a valid ${activeChain?.name || 'EVM'} address.`
        : '';

  const amountError = !isAmountTouched
    ? ''
    : !hasAmount
      ? 'Amount is required.'
      : !isAmountValid
        ? 'Enter a valid amount greater than 0.'
        : '';

  const canContinue = isRecipientValid && isAmountValid;

  // Pre-filled data from QR scan (if any)
  const scannedAddress = route?.params?.address || '';
  const scannedAmount = route?.params?.amount || '';

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

  React.useEffect(() => {
    if (scannedAddress) setRecipientAddress(scannedAddress);
    if (scannedAmount) setAmount(scannedAmount);
  }, [scannedAddress, scannedAmount]);

  React.useEffect(() => {
    if (!activeChain) {
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
  }, [activeChain, balance]);

  React.useEffect(() => {
    if (!activeChain || !balance) {
      return;
    }

    if (selectedToken.symbol !== activeChain.nativeToken.symbol) {
      return;
    }

    setSelectedToken((current) => ({
      ...current,
      balance,
    }));
  }, [activeChain, balance, selectedToken.symbol]);

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
      toast.show(`Invalid ${activeChain?.name || 'EVM'} address format`, 'error');
      return false;
    }

    if (!isAmountValid) {
      trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_VALIDATION_FAILED, {
        reason: 'invalid_amount',
      });
      toast.show('Please enter a valid amount', 'error');
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

    if (biometricsEnabled) {
      if (!isAvailable) {
        toast.show('Biometric authentication is unavailable on this device', 'error');
        setIsAuthenticating(false);
        return;
      }

      const authenticated = await authenticate();
      if (!authenticated) {
        toast.show('Biometric authentication failed', 'error');
        setIsAuthenticating(false);
        return;
      }
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

    // Navigate to privacy level selection
    navigation.navigate(SCREENS.PRIVACY_LEVEL, {
      recipient: recipientAddress.trim(),
      amount: finalCryptoAmount,
      memo: memo.trim(),
      token: selectedToken.symbol,
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

    toast.show('This build supports only the network native token for sends.', 'info');
  };

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
          <Text style={styles.headerTitle}>SEND PAYMENT</Text>
          <View style={{ width: 44 }} />
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
                  <Text style={styles.cardLabel}>SENDING FROM</Text>
                  <Text style={styles.chainName}>{activeChain?.name.toUpperCase() || 'ETHEREUM'}</Text>
                </View>
                <View style={styles.iconCircle}>
                  <Logo variant="icon" size="small" />
                </View>
              </View>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Available Balance</Text>
                <Text style={styles.balanceAmount}>≈ {selectedToken.balance} {selectedToken.symbol}</Text>
              </View>
            </SovereignCard>

            {/* Recipient Address */}
            <Text style={styles.sectionLabel}>{activeChain?.type?.toUpperCase() || 'EVM'} RECIPIENT ADDRESS</Text>
            <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.addressInput}
                  value={recipientAddress}
                  onChangeText={handleRecipientAddressChange}
                  onBlur={() => setIsRecipientTouched(true)}
                  placeholder={`Enter ${activeChain?.name || 'Ethereum'} address`}
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  numberOfLines={2}
                />
                <View style={styles.inputActions}>
                  <TouchableOpacity
                    onPress={() => setIsAddressBookVisible(true)}
                    style={styles.inputActionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Open address book"
                  >
                    <Icon name="wallet" size={20} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleScanQR}
                    style={styles.inputActionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Scan QR code"
                  >
                    <Icon name="camera" size={20} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handlePaste}
                    style={styles.inputActionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Paste from clipboard"
                  >
                    <Icon name="copy" size={20} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              </View>
            </SovereignCard>
            {recipientError ? <Text style={styles.validationError}>{recipientError}</Text> : null}

            {/* Amount Input */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>AMOUNT</Text>
              <TouchableOpacity onPress={toggleInputCurrency}>
                <Text style={{ fontFamily: typography.fontFamily.mono, fontSize: 11, color: colors.accent, fontWeight: 'bold' }}>
                  SWAP TO {isUsdInput ? selectedToken.symbol : (nativeCurrency || 'USD')}
                </Text>
              </TouchableOpacity>
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
                />
                <TouchableOpacity
                  onPress={handleSelectToken}
                  style={styles.tokenSelector}
                  accessibilityRole="button"
                >
                  <Text style={styles.tokenSymbol}>{isUsdInput ? (nativeCurrency || 'USD') : selectedToken.symbol}</Text>
                  {!isUsdInput && <Icon name={'chevron-down'} size={14} color={colors.textMuted} />}
                </TouchableOpacity>
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
                <TouchableOpacity
                  key={percent}
                  onPress={() => handleQuickAmount(percent)}
                  style={[
                    styles.quickAmountCard,
                    selectedPercent === percent && styles.quickAmountCardActive,
                  ]}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.quickAmountText,
                      selectedPercent === percent && styles.quickAmountTextActive,
                    ]}
                  >
                    {percent}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Memo */}
            <Text style={styles.sectionLabel}>MEMO (OPTIONAL)</Text>
            <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
              <TextInput
                style={styles.memoInput}
                value={memo}
                onChangeText={setMemo}
                placeholder="Add a note for this transaction"
                placeholderTextColor={colors.textFaint}
              />
            </SovereignCard>

            {/* Privacy Level Info */}
            <SovereignCard backgroundColor={colors.surfaceCard} padding={16} style={styles.privacyCard}>
              <View style={styles.privacyHeader}>
                <Icon name="shield" size={18} color={colors.accent} />
                <Text style={styles.privacyTitle}>PRIVATE BY DEFAULT</Text>
              </View>
              <Text style={styles.privacyDescription}>
                All transactions use stealth addresses. Choose your privacy level on the next screen.
              </Text>
            </SovereignCard>
          </ScrollView>

          <View style={[styles.footerContainer, { marginBottom: 72 + Math.max(insets.bottom, 16) }]}>
            <SovereignButton
              title={isAuthenticating ? "AUTHENTICATING..." : "CONTINUE"}
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  headerTitle: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 16,
    color: colors.textPrimary,
    letterSpacing: 1,
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

export default SendPaymentScreen;
