import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,  TextInput,  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useShallow } from "zustand/react/shallow";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { SCREENS } from "../constants/screens";
import { useTheme, useStyles, typography } from "../styles/design-tokens";
import { ScreenBackButton } from "../components/ScreenBackButton";
import { SovereignButton } from "../components/SovereignButton";
import { SovereignCard } from "../components/SovereignCard";
import { SelectablePill, SelectableCard } from "../components/SelectableControls";
import Toast, { useToast } from "../components/Toast";
import { Icon } from "../components/Icon";
import { useWalletStore, type ChainType } from "../stores/walletStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useBiometrics } from "../hooks/useBiometrics";
import { useMarketData } from "../hooks/useMarketData";
import { useTransakQuote } from "../hooks/useTransakQuote";
import { triggerLightImpactHaptic } from "../utils/haptics";
import { formatChangePercent, getCurrencySymbol } from "../utils/formatters";
import {
  CRYPTO_TOKENS,
  FIAT_CURRENCIES,
  PAYMENT_METHODS,
  QUICK_AMOUNTS,
  buildTransakDepositUrl,
  calculateDepositFees,
  estimateCryptoAmount,
  formatCrypto,
  formatFiat,
  getMaxDepositAmount,
  getMinDepositAmount,
  getTokensForChain,
  getTokenGroups,
  isTransakConfigured,
  type CryptoToken,
  type FiatCurrency,
  type PaymentMethodId,
} from "../utils/transak";
import { type TransakQuoteRequest } from "../utils/transakQuote";

type DepositCryptoScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "DepositCrypto"
>;
type DepositCryptoRouteProp = RouteProp<RootStackParamList, "DepositCrypto">;

interface DepositCryptoScreenProps {
  navigation: DepositCryptoScreenNavigationProp;
  route: DepositCryptoRouteProp;}export function DepositCryptoScreen({ navigation }: DepositCryptoScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const biometricsEnabled = useSettingsStore(state => state.biometricsEnabled);
  const { address, activeChain } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
    }))
  );
  const [fiatAmount, setFiatAmount] = useState("100");
  const [selectedCurrency, setSelectedCurrency] = useState<FiatCurrency>("USD");  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodId>(
    "credit_debit_card"
  );  const [selectedNetwork, setSelectedNetwork] = useState<string>(activeChain?.key || "ethereum");
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoToken>(CRYPTO_TOKENS[0]);
  const [inputError, setInputError] = useState<string | null>(null);
  const toast = useToast();
  const { isAvailable, authenticate } = useBiometrics();

  const marketData = useMarketData(CRYPTO_TOKENS.map((token) => token.symbol));
  const selectedMarketQuote = marketData.getQuote(selectedCrypto.symbol);
  const currencySymbol = useMemo(() => getCurrencySymbol(selectedCurrency), [selectedCurrency]);

  const defaultToken = useMemo(
    () =>
      CRYPTO_TOKENS.find((token) => token.symbol === activeChain?.nativeToken.symbol) ??
      CRYPTO_TOKENS[0],
    [activeChain?.nativeToken.symbol]
  );

  useEffect(() => {
    setSelectedCrypto((current) => (current.symbol === defaultToken.symbol ? current : defaultToken));
  }, [defaultToken]);

  const parsedAmount = useMemo(() => {
    const parsed = Number.parseFloat(fiatAmount);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [fiatAmount]);

  const validation = useMemo(() => {
    const minAmount = getMinDepositAmount(selectedCurrency);
    const maxAmount = getMaxDepositAmount(selectedCurrency);

    if (parsedAmount <= 0) {
      return { valid: false as const, error: "Enter a valid amount" };
    }

    if (parsedAmount < minAmount) {
      return { valid: false as const, error: `Minimum amount is ${formatFiat(minAmount, selectedCurrency)}` };
    }

    if (parsedAmount > maxAmount) {
      return { valid: false as const, error: `Maximum amount is ${formatFiat(maxAmount, selectedCurrency)}` };
    }

    return { valid: true as const, error: null };
  }, [parsedAmount, selectedCurrency]);

  const fallbackFees = useMemo(() => calculateDepositFees(parsedAmount, selectedCurrency), [parsedAmount, selectedCurrency]);
  const fallbackCryptoAmount = useMemo(() => {
    if (parsedAmount <= 0 || selectedMarketQuote.price <= 0) {
      return 0;
    }

    return estimateCryptoAmount(parsedAmount, selectedMarketQuote.price, fallbackFees, selectedCurrency);
  }, [parsedAmount, selectedMarketQuote.price, fallbackFees, selectedCurrency]);

  const quoteRequest = useMemo<TransakQuoteRequest | null>(() => {
    if (!validation.valid || parsedAmount <= 0) {
      return null;
    }

    return {
      isBuyOrSell: "BUY",
      fiatCurrency: selectedCurrency,
      cryptoCurrency: selectedCrypto.symbol,
      network: selectedCrypto.network,
      fiatAmount: parsedAmount,
      paymentMethod: selectedPaymentMethod,
      referencePriceUsd: selectedMarketQuote.price > 0 ? selectedMarketQuote.price : undefined,
    };
  }, [
    parsedAmount,
    selectedCurrency,
    selectedCrypto,
    selectedMarketQuote.price,
    selectedPaymentMethod,
    validation.valid,
  ]);

  const { quote, isLoading: isQuoteLoading, error: quoteError } = useTransakQuote(quoteRequest, {
    enabled: quoteRequest !== null,
    debounceMs: 300,
    preferCache: true,
  });

  const displayCryptoAmount = quote?.cryptoAmount ?? fallbackCryptoAmount;
  const displayFeeTotal = quote?.totalFee ?? fallbackFees.total;
  const feeRows = quote?.feeBreakdown?.length
    ? quote.feeBreakdown
    : [
        { id: "network_fee", name: "Network Fee", value: fallbackFees.networkFee },
        { id: "transak_fee", name: "Transak Fee", value: fallbackFees.transakFee },
      ];

  const marketFeedLabel = marketData.isLoading
    ? "REFRESHING TOKEN FEEDS"
    : selectedMarketQuote.source === "binance"
      ? "LIVE BINANCE FEED"
      : selectedMarketQuote.source === "cache"
        ? "CACHED MARKET FEED"
        : "FALLBACK MARKET FEED";
  const quoteStatusLabel = isQuoteLoading
    ? "FETCHING LIVE TRANSAK QUOTE"
    : quote?.source === "live"
      ? "LIVE TRANSAK QUOTE"
      : quote?.source === "cache"
        ? "CACHED TRANSAK QUOTE"
        : quote?.source === "fallback"
          ? "ESTIMATED TRANSAK QUOTE"
          : "QUOTE READY";
  const marketChangeStyle =
    selectedMarketQuote.change24h === null
      ? styles.neutralText
      : selectedMarketQuote.change24h >= 0
        ? styles.positiveText
        : styles.negativeText;
  const quoteDetailLabel = quote?.fallbackReason ?? quoteError ?? null;

  const handleAmountChange = useCallback((text: string) => {
    setFiatAmount(text.replace(/[^0-9.]/g, ""));
    setInputError(null);
  }, []);

  const handleQuickAmount = useCallback((amount: number) => {
    triggerLightImpactHaptic();
    setFiatAmount(amount.toString());
    setInputError(null);
  }, []);

  const handleContinue = useCallback(async () => {
    if (!validation.valid) {
      setInputError(validation.error ?? "Enter a valid amount");
      return;
    }

    const networkTypeMap: Record<string, ChainType> = {
      ethereum: 'evm',
      bsc: 'evm',
      polygon: 'evm',
      arbitrum: 'evm',
      base: 'evm',
      solana: 'svm',
      aptos: 'mvm',
      stellar: 'xlm',
    };
    
    const targetChainType = networkTypeMap[selectedCrypto.network.toLowerCase()] || 'evm';
    const targetAddress = useWalletStore.getState().addresses[targetChainType];

    if (!targetAddress) {
      toast.show(`Wallet not connected for ${selectedCrypto.network.toUpperCase()}`, "error");
      return;
    }

    if (!isTransakConfigured()) {
      toast.show("Buy / sell is not configured in this build yet.", "error");
      return;
    }

    if (biometricsEnabled) {
      if (!isAvailable) {
        toast.show("Biometrics not available on this device", "error");
        return;
      }

      const authenticated = await authenticate();
      if (!authenticated) {
        toast.show("Biometric verification failed", "error");
        return;
      }
    }

    const url = buildTransakDepositUrl({
      walletAddress: targetAddress,
      fiatAmount: parsedAmount,
      fiatCurrency: selectedCurrency,
      cryptoToken: selectedCrypto.symbol,
      network: selectedCrypto.network,
      paymentMethod: selectedPaymentMethod,
    });

    navigation.navigate(SCREENS.TRANSAK_WEBVIEW, {
      url,      title: "BUY CRYPTO",
      flow: "buy",
    });
  }, [    address,
    authenticate,
    biometricsEnabled,
    isAvailable,
    navigation,
    parsedAmount,
    selectedCrypto,
    selectedCurrency,
    selectedPaymentMethod,
    toast,
    validation.error,
    validation.valid,
  ]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>BUY CRYPTO</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={{ flex: 1 }}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <SovereignCard style={styles.sectionCard} padding={20}>
          <Text style={styles.label}>YOU PAY</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currencySymbol}>{currencySymbol}</Text>
            <TextInput
              value={fiatAmount}
              onChangeText={handleAmountChange}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textFaint}
              selectionColor={colors.accent}
              style={styles.amountInput}
              accessibilityLabel="Fiat amount input"
            />
          </View>
          {inputError ? <Text style={styles.errorText}>{inputError}</Text> : null}
          <Text style={styles.helperText}>Minimum: {formatFiat(getMinDepositAmount(selectedCurrency), selectedCurrency)}</Text>

          <View style={styles.quickRow}>
            {QUICK_AMOUNTS.map((amount) => (
              <TouchableOpacity
                key={amount}
                onPress={() => handleQuickAmount(amount)}
                style={[
                  styles.quickChip,
                  fiatAmount === amount.toString() && styles.quickChipActive
                ]}
                accessibilityRole="button"
              >
                <Text style={[
                  styles.quickChipText,
                  fiatAmount === amount.toString() && styles.quickChipTextActive
                ]}>
                  {currencySymbol}{amount}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.currencyRow}>
            {FIAT_CURRENCIES.map((currency) => (
              <TouchableOpacity
                key={currency}
                onPress={() => {
                  setSelectedCurrency(currency);
                  triggerLightImpactHaptic();
                }}
                style={[
                  styles.quickChip,
                  selectedCurrency === currency && styles.quickChipActive
                ]}
              >
                <Text style={[
                  styles.quickChipText,
                  selectedCurrency === currency && styles.quickChipTextActive
                ]}>
                  {currency}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.helperText}>
            Changing fiat currency updates the quote, limits, and Transak checkout.
          </Text>
          <Text style={styles.helperText}>
            Current limits: {formatFiat(getMinDepositAmount(selectedCurrency), selectedCurrency)} - {formatFiat(getMaxDepositAmount(selectedCurrency), selectedCurrency)}
          </Text>
        </SovereignCard>

        <SovereignCard style={styles.sectionCard} padding={20}>
          <Text style={styles.label}>LIVE TOKEN PRICE</Text>
          <Text style={styles.priceValue}>{formatFiat(selectedMarketQuote.price, "USD")}</Text>
          <View style={styles.feedRow}>
            <Text style={styles.feedLabel}>{marketFeedLabel}</Text>
            <Text style={[styles.feedLabel, marketChangeStyle]}>{formatChangePercent(selectedMarketQuote.change24h)}</Text>
          </View>
          <Text style={styles.helperText}>{quoteStatusLabel}</Text>
        </SovereignCard>

        <SovereignCard style={styles.sectionCard} padding={20}>
          <Text style={styles.label}>YOU RECEIVE</Text>
          <Text style={styles.receiveValue}>{formatCrypto(displayCryptoAmount, selectedCrypto.symbol)}</Text>
          <Text style={styles.helperText}>On {selectedCrypto.network.toUpperCase()}</Text>
          {quoteDetailLabel ? <Text style={styles.helperText}>{quoteDetailLabel}</Text> : null}
        </SovereignCard>

        <SovereignCard style={styles.sectionCard} padding={20}>
          <Text style={styles.label}>CRYPTO TOKEN</Text>
          
          {/* Network Tab Bar */}
          <View style={styles.networkTabsContainer}>            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              contentContainerStyle={styles.networkTabsScroll}
            >              {getTokenGroups(CRYPTO_TOKENS).map((group) => (
                <TouchableOpacity
                  key={group}
                  onPress={() => {
                    setSelectedNetwork(group.toLowerCase());
                    triggerLightImpactHaptic();
                    // Auto-select first token of this group if current selection is not in this group
                    if (selectedCrypto.group.toLowerCase() !== group.toLowerCase()) {
                      const firstInGroup = CRYPTO_TOKENS.find(t => t.group.toLowerCase() === group.toLowerCase());
                      if (firstInGroup) setSelectedCrypto(firstInGroup);
                    }
                  }}
                  style={styles.networkTab}
                >
                  <Text style={[
                    styles.networkTabText,
                    selectedCrypto.group.toLowerCase() === group.toLowerCase() && styles.networkTabTextActive
                  ]}>
                    {group.toUpperCase()}
                  </Text>
                  {selectedCrypto.group.toLowerCase() === group.toLowerCase() && (
                    <View style={styles.networkTabIndicator} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.scrollIndicatorHint}>              <Icon name="chevron-right" size={14} color={colors.textMuted} />
            </View>
          </View>

          {/* Tokens Grid for active network */}
          <View style={styles.tokenPillsContainer}>            {CRYPTO_TOKENS.filter((t) => t.group.toLowerCase() === selectedCrypto.group.toLowerCase()).map((token, idx) => (
              <TouchableOpacity
                key={`${token.symbol}-${token.network}-${idx}`}
                onPress={() => {
                  setSelectedCrypto(token);
                  triggerLightImpactHaptic();
                }}
                style={[
                  styles.tokenPill,
                  selectedCrypto.symbol === token.symbol && selectedCrypto.network === token.network && styles.tokenPillActive
                ]}
              >
                <Text style={[
                  styles.tokenPillText,
                  selectedCrypto.symbol === token.symbol && selectedCrypto.network === token.network && styles.tokenPillTextActive
                ]}>
                  {token.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SovereignCard>

        <SovereignCard style={styles.sectionCard} padding={20}>
          <Text style={styles.label}>PAYMENT METHOD</Text>
          {PAYMENT_METHODS.map((method) => (
            <SelectableCard
              key={method.id}
              active={selectedPaymentMethod === method.id}
              onPress={() => setSelectedPaymentMethod(method.id)}
            >
              <Text style={styles.choiceTitle}>{method.label}</Text>
              {method.id === "credit_debit_card" ? (
                <Text style={styles.choiceSubtitle}>INSTANT DELIVERY</Text>
              ) : null}
            </SelectableCard>
          ))}
        </SovereignCard>

        <SovereignCard style={styles.sectionCard} padding={20}>
          <Text style={styles.label}>FEES</Text>
          {feeRows.map((row) => (
            <View key={row.id} style={styles.feeRow}>
              <Text style={styles.feeLabel}>{row.name}</Text>
              <Text style={styles.feeValue}>{formatFiat(row.value, selectedCurrency)}</Text>
            </View>
          ))}
          <View style={[styles.feeRow, styles.feeTotalRow]}>
            <Text style={styles.feeTotalLabel}>TOTAL FEES</Text>
            <Text style={styles.feeTotalValue}>{formatFiat(displayFeeTotal, selectedCurrency)}</Text>
          </View>
        </SovereignCard>

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.footer}>
        <SovereignButton
          title="CONTINUE TO TRANSAK"
          variant={(!validation.valid || !address) ? "outline" : "primary"}
          onPress={handleContinue}
          disabled={!validation.valid || !address}
        />
      </View>
      </Animated.View>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />
    </SafeAreaView>);
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
    height: 64,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "700",
    letterSpacing: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  sectionCard: {
    marginBottom: 24,
  },
  label: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 2,
    marginBottom: 16,
    fontWeight: "700",
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  currencySymbol: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 40,
    color: colors.textPrimary,
    marginRight: 8,
    fontWeight: "700",
  },
  amountInput: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: typography.fontFamily.mono,
    fontSize: 56,
    paddingVertical: 0,
    fontWeight: "700",
    letterSpacing: -0.02,
  },
  errorText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.error,
    marginTop: 8,
  },
  helperText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 8,
  },
  quickRow: {
    flexDirection: "row",
    marginTop: 16,
    gap: 10,
  },
  currencyRow: {
    flexDirection: "row",
    marginTop: 12,
    gap: 10,
  },
  quickChip: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.textPrimary,
  },
  quickChipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  quickChipText: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  quickChipTextActive: {
    color: colors.bgPrimary,
  },
  networkTabsContainer: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  networkTabsScroll: {
    paddingBottom: 0,
  },
  networkTab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 8,
    alignItems: 'center',
    position: 'relative',
  },
  networkTabText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  networkTabTextActive: {
    color: colors.accent,
  },
  networkTabIndicator: {
    position: 'absolute',
    bottom: -1,
    left: 16,
    right: 16,
    height: 2,
    backgroundColor: colors.textPrimary,
    borderRadius: 0,
  },
  scrollIndicatorHint: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // very subtle highlight
  },
  tokenPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tokenPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.textPrimary,
  },
  tokenPillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  tokenPillText: {
    fontFamily: typography.fontFamily.bodyBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  tokenPillTextActive: {
    color: colors.bgPrimary,
  },
  choiceTitle: {
    fontFamily: typography.fontFamily.body,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  choiceSubtitle: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 4,
    fontWeight: "700",
  },
  priceValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 28,
    color: colors.accent,
    fontWeight: "900",
  },
  receiveValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 30,
    color: colors.textPrimary,
    fontWeight: "900",
  },
  feedRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  feedLabel: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  positiveText: {
    color: colors.success,
  },
  negativeText: {
    color: colors.error,
  },
  neutralText: {
    color: colors.textMuted,
  },
  feeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  feeLabel: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  feeValue: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textPrimary,
    fontSize: 12,
  },
  feeTotalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineSubtle,
    paddingTop: 12,
    marginTop: 4,
  },
  feeTotalLabel: {
    fontFamily: typography.fontFamily.mono,
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900",
  },
  feeTotalValue: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  footer: {
    padding: 24,
    backgroundColor: colors.surfaceScreen,
  },
});

export default DepositCryptoScreen;
