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
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { getClipboardString } from '../utils/clipboard';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import { useBiometrics } from '../hooks/useBiometrics';
import { FALLBACK_ETH_PRICE } from '../utils/priceFeed';
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
  const styles = useStyles(themeStyles);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isRecipientTouched, setIsRecipientTouched] = useState(false);
  const [isAmountTouched, setIsAmountTouched] = useState(false);
  const [selectedPercent, setSelectedPercent] = useState<string | null>(null);
  const lastContinueAttemptRef = useRef(0);

  const { activeChain, balance, biometricsEnabled } = useWalletStore();
  const toast = useToast();
  const { isAvailable, authenticate } = useBiometrics();
  const isNativeTransferSupported = activeChain?.type === 'evm';
  const [selectedToken, setSelectedToken] = useState<PaymentToken>({
    id: `${activeChain?.key || 'ethereum'}-${activeChain?.nativeToken.symbol || 'ETH'}`,
    name: activeChain?.nativeToken.name || 'Ether',
    symbol: activeChain?.nativeToken.symbol || 'ETH',
    balance: balance || '0.000',
    usdPrice: FALLBACK_ETH_PRICE,
    chainTypes: [activeChain?.type || 'evm'],
  });

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

  const canContinue = isRecipientValid && isAmountValid && isNativeTransferSupported;

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

  const handleAmountChange = (value: string) => {
    const normalizedValue = value.replace(',', '.').replace(/[^0-9.]/g, '');
    const [whole, ...fraction] = normalizedValue.split('.');
    const sanitizedAmount = fraction.length > 0 ? `${whole}.${fraction.join('')}` : whole;

    setAmount(sanitizedAmount);
    setSelectedPercent(null); // Clear selected percent when manual input
    if (!isAmountTouched) {
      setIsAmountTouched(true);
    }
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

    if (!isNativeTransferSupported) {
      toast.show('Send payment is only supported on EVM networks in this build.', 'error');
      return;
    }

    lastContinueAttemptRef.current = now;

    if (biometricsEnabled) {
      if (!isAvailable) {
        toast.show('Biometric authentication is unavailable on this device', 'error');
        return;
      }

      const authenticated = await authenticate();
      if (!authenticated) {
        toast.show('Biometric authentication failed', 'error');
        return;
      }
    }

    trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_CONTINUE_PRESSED, {
      chain_key: activeChain?.key || 'unknown',
      token_symbol: selectedToken.symbol,
      has_memo: Boolean(memo.trim()),
    });

    // Navigate to privacy level selection
    navigation.navigate(SCREENS.PRIVACY_LEVEL, {
      recipient: recipientAddress.trim(),
      amount: amount.trim(),
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      {/* Header */}
      <View style={styles.header}>
        <ScreenBackButton onPress={handleBack} />
        <Text style={styles.headerTitle}>SEND PAYMENT</Text>
        <View style={{ width: 80 }} />
      </View>

      <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
        <Animated.View entering={FadeInDown.duration(260)} style={styles.animatedContent}>
          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Chain & Balance Info */}
<SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
      <View style={styles.chainInfoRow}>
                <View style={styles.chainInfoLeft}>
                  <Text style={styles.chainLabel}>SENDING FROM</Text>
                  <Text style={styles.chainName}>{activeChain?.name?.toUpperCase() || 'ETHEREUM'}</Text>
                </View>
                <View style={styles.chainInfoRight}>
                  <Logo variant="icon" size="small" />
                </View>
              </View>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Available Balance</Text>
                <Text style={styles.balanceAmount}>≈ {selectedToken.balance} {selectedToken.symbol}</Text>
              </View>
            </SovereignCard>

            {/* Network Selection Warning */}
            <View style={styles.warningBanner}>
              <Icon name="info" size={16} color={colors.warning} />
              <Text style={styles.warningText}>
                Double check that the recipient address is on the {activeChain?.name?.toUpperCase() || 'ETHEREUM'} network.
              </Text>
            </View>

            {/* Recipient Address */}
            <Text style={styles.sectionLabel}>{activeChain?.type?.toUpperCase() || 'EVM'} RECIPIENT ADDRESS</Text>
<SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 16 }}>
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
                    onPress={handleScanQR}
                    style={styles.inputActionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Scan QR code"
                    accessibilityHint="Opens the QR scanner to fill recipient details"
                  >
                    <Icon name="camera" size={20} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handlePaste}
                    style={styles.inputActionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Paste from clipboard"
                    accessibilityHint="Pastes recipient details from the clipboard"
                  >
                    <Icon name="copy" size={20} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              </View>
            </SovereignCard>
            {recipientError ? <Text style={styles.validationError}>{recipientError}</Text> : null}

            {/* Amount Input */}
            <Text style={styles.sectionLabel}>AMOUNT</Text>
<SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 16 }}>
      <View style={styles.amountRow}>
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
                  disabled={!isNativeTransferSupported}
                  onPress={handleSelectToken}
                  style={styles.tokenSelector}
                  accessibilityRole="button"
                  accessibilityLabel={`Network token ${selectedToken.symbol}`}
                  accessibilityHint="Only the network native token is supported in this build"
                >
                  <Text style={styles.tokenSymbol}>{selectedToken.symbol}</Text>
                  <Icon name={isNativeTransferSupported ? 'chevron-down' : 'info'} size={14} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.usdRow}>
                <Text style={styles.usdAmount}>
                  ≈ ${((Number.isFinite(parsedAmount) ? parsedAmount : 0) * selectedToken.usdPrice).toFixed(2)} USD
                </Text>
              </View>
              {!isNativeTransferSupported ? (
                <Text style={styles.validationError}>
                  Send payment is only supported on EVM networks in this build.
                </Text>
              ) : null}
            </SovereignCard>
            {amountError ? <Text style={styles.validationError}>{amountError}</Text> : null}

            {/* Quick Amount Buttons */}
            <View style={styles.quickAmountRow}>
              {['25%', '50%', '75%', 'MAX'].map((percent) => (
                <TouchableOpacity
                  key={percent}
                  onPress={() => {
                    setSelectedPercent(percent);
                    // Calculate percentage of balance
                    const balance = parseFloat(selectedToken.balance || '0');
                    const multiplier = percent === 'MAX' ? 1 : parseInt(percent) / 100;

                    if (percent === 'MAX') {
                      const gasReserveMap: Record<string, number> = {
                        ethereum: 0.01,
                        polygon: 0.005,
                        arbitrum: 0.002,
                        sepolia: 0.001,
                      };
                      const gasReserve = activeChain?.type === 'evm'
                        ? (gasReserveMap[activeChain.key] ?? 0.005)
                        : 0;
                      const maxAmount = Math.max(0, balance - gasReserve);
                      setAmount(maxAmount.toFixed(6));
                    } else {
                      setAmount((balance * multiplier).toFixed(6));
                    }
                    setIsAmountTouched(true);
                    trackEvent(ANALYTICS_EVENTS.SEND_PAYMENT_QUICK_AMOUNT_SELECTED, {
                      percent,
                      token_symbol: selectedToken.symbol,
                    });
                  }}
                  activeOpacity={0.7}
                  style={[
                    styles.quickAmountCard,
                    selectedPercent === percent && styles.quickAmountCardActive
                  ]}
                >
                  <Text style={[
                    styles.quickAmountText,
                    selectedPercent === percent && styles.quickAmountTextActive
                  ]}>
                    {percent}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Memo (Optional) */}
            <Text style={styles.sectionLabel}>MEMO (OPTIONAL)</Text>
<SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
      <TextInput
        style={styles.memoInput}
        value={memo}
        onChangeText={setMemo}
        placeholder="Add a note for this transaction"
        placeholderTextColor={colors.textFaint}
                multiline
                numberOfLines={2}
              />
            </SovereignCard>

            {/* Privacy Notice */}
<SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
      <View style={styles.privacyNotice}>
        <Icon name="private" size={24} color={colors.accent} />
                <View style={styles.privacyTextContainer}>
                  <Text style={styles.privacyTitle}>PRIVATE BY DEFAULT</Text>
                  <Text style={styles.privacyDesc}>
                    All transactions use stealth addresses. Choose your privacy level on the next screen.
                  </Text>
                </View>
              </View>
            </SovereignCard>

            {/* Continue Button */}
            <SovereignButton
              title="CONTINUE"
              variant={canContinue ? 'primary' : 'outline'}
              onPress={handleContinue}
              disabled={!canContinue}
              style={{ marginBottom: 32 }}
            />
            <View style={{ height: 120 }} />
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      <BottomNavBar currentScreen={SCREENS.SEND_PAYMENT} onNavigate={handleNavPress} />

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
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  backButton: {
    width: 80,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
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
  chainInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  chainInfoLeft: {
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
    fontSize: 18,
    color: colors.accent,
    fontWeight: 'bold',
  },
  chainInfoRight: {
    alignItems: 'center',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  balanceLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
  },
  balanceAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  sectionLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    gap: 12,
  },
  addressInput: {
    flex: 1,
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 48,
  },
  inputActions: {
    flexDirection: 'row',
    gap: 8,
  },
  inputActionBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputActionIcon: {
    fontSize: 18,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
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
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    minHeight: 44,
  },
  tokenSymbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.accent,
    fontWeight: 'bold',
  },
  tokenArrow: {
    fontSize: 10,
    color: colors.textMuted,
  },
  usdRow: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  usdAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
  },
  quickAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 12,
  },
  quickAmountCard: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
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
  validationError: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: 12,
    color: colors.error,
    marginBottom: 12,
    marginTop: -8,
  },
  memoInput: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 16,
    minHeight: 60,
  },
  privacyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  privacyIcon: {
    fontSize: 24,
  },
  privacyTextContainer: {
    flex: 1,
    gap: 4,
  },
  privacyTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  privacyDesc: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  warningBanner: {
    flexDirection: 'row',
    backgroundColor: colors.warningBg + '15',
    padding: 12,
    borderRadius: 16,
    marginBottom: 24,
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.warningBg + '30',
  },
  warningText: {
    flex: 1,
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: 11,
    color: colors.warning,
    lineHeight: 15,
  },
});

export default SendPaymentScreen;
