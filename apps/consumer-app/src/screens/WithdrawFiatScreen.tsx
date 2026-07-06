import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { PressableOpacity } from '../components/PressableOpacity';
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
import { useWalletStore } from "../stores/walletStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useBiometrics } from "../hooks/useBiometrics";
import { useMarketData } from "../hooks/useMarketData";
import { useTransakQuote } from "../hooks/useTransakQuote";
import { triggerLightImpactHaptic } from "../utils/haptics";
import { formatChangePercent, getBalanceAmount } from "../utils/formatters";
import {
  CRYPTO_TOKENS,
  FIAT_CURRENCIES,
  PAYOUT_METHODS,
  buildTransakWithdrawUrl,
  calculateWithdrawalFees,
  estimateFiatPayout,
  formatCrypto,
  formatFiat,
  formatFeePercent,
  getTokensForChain,
  getTokenGroups,
  isTransakConfigured,
  type CryptoToken,
  type FiatCurrency,
  type PayoutMethodId,
} from "../utils/transak";
import { type TransakQuoteRequest } from "../utils/transakQuote";

type WithdrawFiatScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "WithdrawFiat"
>;
type WithdrawFiatRouteProp = RouteProp<RootStackParamList, "WithdrawFiat">;

interface WithdrawFiatScreenProps {
  navigation: WithdrawFiatScreenNavigationProp;
  route: WithdrawFiatRouteProp;
}
export function WithdrawFiatScreen({ navigation }: WithdrawFiatScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { address, activeChain, balance } = useWalletStore(
    useShallow((state) => ({
      address: state.address,
      activeChain: state.activeChain,
      balance: state.balance,
    }))
  );
  const { nativeCurrency, setNativeCurrency } = useSettingsStore((state: any) => ({
    nativeCurrency: state.nativeCurrency,
    setNativeCurrency: state.setNativeCurrency,
  }));
  const [cryptoAmount, setCryptoAmount] = useState("0.5");
  const [selectedCurrency, setSelectedCurrency] = useState<FiatCurrency>((nativeCurrency as FiatCurrency) || "USD");
  const [selectedPayoutMethod, setSelectedPayoutMethod] = useState<PayoutMethodId>("neft_rtgs");
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoToken>(CRYPTO_TOKENS[0]);
  // Single-pass filter (avoids .filter().map() double iteration in render).
  const activeGroupTokens = useMemo(() => {
    const groupKey = selectedCrypto.group.toLowerCase();
    const out: CryptoToken[] = [];
    for (const token of CRYPTO_TOKENS) {
      if (token.group.toLowerCase() === groupKey) out.push(token);
    }
    return out;
  }, [selectedCrypto.group]);
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const toast = useToast();
  const { authenticate } = useBiometrics();

  const marketData = useMarketData(CRYPTO_TOKENS.map((token) => token.symbol));
  const selectedMarketQuote = marketData.getQuote(selectedCrypto.symbol);
  const availableBalance = useMemo(() => getBalanceAmount(balance), [balance]);

  // Multi-chain: filter tokens by active chain
  const chainTokens = useMemo(
    () => activeChain ? getTokensForChain(activeChain.key ?? 'ethereum') : [...CRYPTO_TOKENS],
    [activeChain]
  );
  const tokenGroups = useMemo(() => getTokenGroups(chainTokens), [chainTokens]);

  const parsedAmount = useMemo(() => {
    const parsed = Number.parseFloat(cryptoAmount);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [cryptoAmount]);

  const validation = useMemo(() => {
    if (parsedAmount <= 0) {
      return { valid: false as const, error: "Enter a valid amount" };
    }

    if (parsedAmount > availableBalance) {
      return { valid: false as const, error: "Enter an amount within your available balance" };
    }

    return { valid: true as const, error: null };
  }, [availableBalance, parsedAmount]);

  const quickPercentAmounts = useMemo(
    () => [25, 50, 75, 100].map((percent) => ({ percent })),
    []
  );

  const fallbackFees = useMemo(
    () => calculateWithdrawalFees(parsedAmount, selectedMarketQuote.price, selectedCurrency),
    [parsedAmount, selectedMarketQuote.price, selectedCurrency]
  );
  const fallbackFiatPayout = useMemo(() => {
    if (parsedAmount <= 0 || selectedMarketQuote.price <= 0) {
      return 0;
    }

    return estimateFiatPayout(parsedAmount, selectedMarketQuote.price, fallbackFees, selectedCurrency);
  }, [fallbackFees, parsedAmount, selectedMarketQuote.price, selectedCurrency]);

  const quoteRequest = useMemo<TransakQuoteRequest | null>(() => {
    if (!validation.valid) {
      return null;
    }

    return {
      isBuyOrSell: "SELL",
      fiatCurrency: selectedCurrency,
      cryptoCurrency: selectedCrypto.symbol,
      network: selectedCrypto.network,
      cryptoAmount: parsedAmount,
      paymentMethod: selectedPayoutMethod,
      referencePriceUsd: selectedMarketQuote.price > 0 ? selectedMarketQuote.price : undefined,
    };
  }, [
    parsedAmount,
    selectedCurrency,
    selectedCrypto,
    selectedMarketQuote.price,
    selectedPayoutMethod,
    validation.valid,
  ]);

  const { quote, isLoading: isQuoteLoading, error: quoteError } = useTransakQuote(quoteRequest, {
    enabled: quoteRequest !== null,
    debounceMs: 300,
    preferCache: true,
  });

  const displayFiatPayout = quote?.fiatAmount ?? fallbackFiatPayout;
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
    setCryptoAmount(text.replace(/[^0-9.]/g, ""));
    setSelectedPercent(null);
    setInputError(null);
  }, []);

  const handlePercentPress = useCallback(
    (percent: number) => {
      triggerLightImpactHaptic();
      setSelectedPercent(percent);
      const amount = availableBalance * (percent / 100);
      setCryptoAmount(amount.toFixed(6).replace(/\.?0+$/, ""));
      setInputError(null);
    },
    [availableBalance]
  );

  const handleContinue = useCallback(async () => {
    if (!validation.valid) {
      setInputError(validation.error ?? "Enter a valid amount");
      return;
    }

    if (!address) {
      toast.show("Wallet not connected", "error");
      return;
    }

    if (!isTransakConfigured()) {
      toast.show("Buy / sell is not configured in this build yet.", "error");
      return;
    }

    // ALWAYS require authentication, regardless of the app biometric-lock
    // toggle. `true` allows the device PIN/passcode fallback when no biometrics
    // are enrolled. Check `.success` — the result is an object, not a boolean.
    const authResult = await authenticate('send_payment', true);
    if (!authResult.success) {
      toast.show(
        authResult.cancelled ? "Authentication cancelled" : "Authentication failed",
        "error",
      );
      return;
    }

    const url = buildTransakWithdrawUrl({
      walletAddress: address,
      cryptoAmount: parsedAmount,
      cryptoToken: selectedCrypto.symbol,
      network: selectedCrypto.network,
      fiatCurrency: selectedCurrency,
      payoutMethod: selectedPayoutMethod,
    });

    navigation.navigate(SCREENS.TRANSAK_WEBVIEW, {
      url,
      title: "SELL CRYPTO",
      flow: "sell",
    });
  }, [
    address,
    authenticate,
    navigation,
    parsedAmount,
    selectedCrypto,
    selectedCurrency,
    selectedPayoutMethod,
    toast,
    validation.error,
    validation.valid,
  ]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>SELL CRYPTO</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={{ flex: 1 }}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <SovereignCard style={styles.sectionCard} padding={20}>
          <Text style={styles.label}>AMOUNT TO SELL</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currencySymbol}>{selectedCrypto.symbol}</Text>
            <TextInput
              value={cryptoAmount}
              onChangeText={handleAmountChange}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textFaint}
              selectionColor={colors.accent}
              style={styles.amountInput}
              accessibilityLabel="Crypto amount input"
            />
          </View>
          <Text style={styles.helperText}>Available: {formatCrypto(availableBalance, selectedCrypto.symbol)}</Text>
          {inputError ? <Text style={styles.errorText}>{inputError}</Text> : null}

          <View style={styles.quickRow}>
            {quickPercentAmounts.map(({ percent }) => (
              <PressableOpacity
                key={percent}
                onPress={() => handlePercentPress(percent)}
                style={[
                  styles.quickChip,
                  selectedPercent === percent && styles.quickChipActive
                ]}
                accessibilityRole="button"
              >
                <Text style={[
                  styles.quickChipText,
                  selectedPercent === percent && styles.quickChipTextActive
                ]}>
                  {percent === 100 ? "MAX" : `${percent}%`}
                </Text>
              </PressableOpacity>
            ))}
          </View>

          <View style={styles.currencyRow}>
            {FIAT_CURRENCIES.map((currency) => (
              <PressableOpacity
                key={currency}
                onPress={() => {
                  setSelectedCurrency(currency as FiatCurrency);
                  setNativeCurrency(currency);
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
              </PressableOpacity>
            ))}
          </View>
          <Text style={styles.helperText}>
            Changing fiat currency updates the payout estimate and checkout.
          </Text>
          <Text style={styles.helperText}>
            Quotes refresh automatically when you change amount, currency, token, or payout method.
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
          <Text style={styles.label}>ESTIMATED PAYOUT</Text>
          <Text style={styles.receiveValue}>{formatFiat(displayFiatPayout, selectedCurrency)}</Text>
          <Text style={styles.helperText}>Remaining balance: {formatCrypto(Math.max(availableBalance - parsedAmount, 0), selectedCrypto.symbol)}</Text>
          {quoteDetailLabel ? <Text style={styles.helperText}>{quoteDetailLabel}</Text> : null}
        </SovereignCard>

        <SovereignCard style={styles.sectionCard} padding={20}>
          <Text style={styles.label}>CRYPTO TOKEN</Text>
          
          {/* Network Tab Bar */}
          <View style={styles.networkTabsContainer}>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              contentContainerStyle={styles.networkTabsScroll}
            >
              {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list -- short static horizontal token-group tab bar; virtualization unwarranted */}
              {getTokenGroups(CRYPTO_TOKENS).map((group) => (
                <PressableOpacity
                  key={group}
                  onPress={() => {
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
                </PressableOpacity>
              ))}
            </ScrollView>
            <View style={styles.scrollIndicatorHint}>
              <Icon name="chevron-right" size={14} color={colors.textMuted} />
            </View>
          </View>

          {/* Tokens Grid for active network */}
          <View style={styles.tokenPillsContainer}>
            {activeGroupTokens.map((token, idx) => (
              <PressableOpacity
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
              </PressableOpacity>
            ))}
          </View>
        </SovereignCard>

        <SovereignCard style={styles.sectionCard} padding={20}>
          <Text style={styles.label}>PAYOUT METHOD</Text>
          {PAYOUT_METHODS.map((method) => (
            <SelectableCard
              key={method.id}
              active={selectedPayoutMethod === method.id}
              onPress={() => setSelectedPayoutMethod(method.id)}
            >
              <Text style={styles.choiceTitle}>{method.label}</Text>
              <Text style={styles.choiceSubtitle}>TRANSAK HANDLES KYC</Text>
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
          <Text style={styles.helperText}>Fee percent: {formatFeePercent(fallbackFees.transakFeePercent)}</Text>
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
    </SafeAreaView>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    height: 64,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  // Matches ScreenBackButton width (80) so the centered title is truly centered.
  headerSpacer: {
    width: 80,
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "700",
    letterSpacing: 1,
    textAlign: "center",
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
    borderRadius: 18,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  quickChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
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
    backgroundColor: colors.accent,
    borderRadius: 1,
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
    borderTopRightRadius: 12, // match container if needed
  },
  tokenPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tokenPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.surfaceInput,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  tokenPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
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

export default WithdrawFiatScreen;
