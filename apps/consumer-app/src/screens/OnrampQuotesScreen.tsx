import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar, ActivityIndicator } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { ScreenBackButton } from '../components/ScreenBackButton';
import { SovereignCard } from '../components/SovereignCard';
import { Icon } from '../components/Icon';
import { CURRENCIES } from '../constants/currencies';
import { useWalletStore, SUPPORTED_CHAINS, type ChainType } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import { triggerLightImpactHaptic } from '../utils/haptics';
import { buildTransakDepositUrl, FIAT_CURRENCIES, type FiatCurrency } from '../utils/transak';
import { filterSupportedQuotes, getSupportedTokens, isTokenSupported } from '../utils/onrampProviderMatrix';
import { logQuotesFetched, logQuotesFetchError, logProviderSelected, logUnsupportedChain } from '../utils/onrampLogger';
import { useOnramp } from '../hooks/useOnramp';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';

type OnrampQuotesScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'OnrampQuotes'>;
type OnrampQuotesRouteProp = RouteProp<RootStackParamList, 'OnrampQuotes'>;

interface OnrampQuotesScreenProps {
  navigation: OnrampQuotesScreenNavigationProp;
  route: OnrampQuotesRouteProp;
}

interface Quote {
  provider: string;
  estimatedCryptoAmount: string;
  exchangeRate: string;
  providerFee: string;
  networkFee: string;
}

/** Maps chain keys to their address type — derived from SUPPORTED_CHAINS to stay in sync */
const CHAIN_KEY_TO_TYPE: Record<string, ChainType> = Object.fromEntries(
  SUPPORTED_CHAINS.map(c => [c.key, c.type]),
);

/** Maps chain keys to their native token symbol — used to render provider token support */
const CHAIN_KEY_TO_NATIVE_SYMBOL: Record<string, string> = Object.fromEntries(
  SUPPORTED_CHAINS.map(c => [c.key, c.nativeToken.symbol]),
);

/** Chains that no on-ramp provider currently supports */
const UNSUPPORTED_ONRAMP_CHAINS = new Set([
  'aptos',
  'stellar',
  'sepolia',
  'solana-devnet',
  'stellar-testnet',
]);

const getProviderName = (providerId: string) => {
  switch(providerId) {
    case 'onramp_money': return 'Onramp.money';
    case 'moonpay': return 'MoonPay';
    case 'transak': return 'Transak';
    default: return providerId;
  }
};

const getProviderIcon = (providerId: string) => {
  switch(providerId) {
    case 'onramp_money': return 'flash';
    case 'moonpay': return 'card';
    case 'stripe': return 'card';
    case 'transak': return 'globe';
    default: return 'card';
  }
};

export function OnrampQuotesScreen({ navigation, route }: OnrampQuotesScreenProps) {
  const { flow, fiatAmount, fiatCurrency, cryptoToken, chainKey } = route.params;
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { getOnrampUrl } = useOnramp();
  const addresses = useWalletStore(s => s.addresses);
  
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resolve the correct wallet address for the target chain type (fund-safety fix)
  const walletAddress = useMemo(() => {
    const chainType = CHAIN_KEY_TO_TYPE[chainKey.toLowerCase()] || 'evm';
    return addresses[chainType] ?? null;
  }, [chainKey, addresses]);

  // Native symbol of the target chain — used to render each provider's token
  // support. Falls back to the requested token so we never wrongly flag a
  // mismatch if the chain is somehow unknown.
  const nativeSymbol = CHAIN_KEY_TO_NATIVE_SYMBOL[chainKey.toLowerCase()] ?? cryptoToken;

  // Resolve currency symbol for display (replaces hardcoded ₹)
  const currencySymbol = useMemo(() => {
    const match = CURRENCIES.find(c => c.id === fiatCurrency);
    return match?.symbol ?? fiatCurrency;
  }, [fiatCurrency]);

  const fetchQuotes = useCallback(async () => {
    // Block unsupported chains before hitting the backend
    if (UNSUPPORTED_ONRAMP_CHAINS.has(chainKey.toLowerCase())) {
      logUnsupportedChain({ chainKey });
      setError(`On-ramp is not available for ${chainKey}. Please switch to a supported chain.`);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';
      const query = new URLSearchParams({
        fiatAmount,
        fiatCurrency,
        cryptoToken,
        flow,
      });
      const response = await fetch(`${baseUrl}/api/v1/onramp/quotes?${query.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to fetch quotes');
      }
      
      const data = await response.json();
      const allQuotes: Quote[] = data.quotes || [];
      // Filter out providers that don't support this chain + fiat combination
      const filtered = filterSupportedQuotes(allQuotes, chainKey, fiatCurrency);
      setQuotes(filtered);
      logQuotesFetched({
        fiatAmount,
        fiatCurrency,
        cryptoToken,
        chainKey,
        quoteCount: filtered.length,
        providers: filtered.map((q) => q.provider),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMsg);
      logQuotesFetchError({ fiatAmount, fiatCurrency, cryptoToken, error: errorMsg });
    } finally {
      setIsLoading(false);
    }
  }, [fiatAmount, fiatCurrency, cryptoToken, flow, chainKey]);

  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- fetches quotes into this screen's own local state; no parent callback involved.
    fetchQuotes();
  }, [fetchQuotes]);

  const handleProviderSelect = async (provider: string) => {
    triggerLightImpactHaptic();
    logProviderSelected({ provider, chainKey, fiatCurrency, fiatAmount });

    // Block the hand-off if the provider doesn't sell the chosen token on this
    // chain — otherwise the user hits a dead-end inside the provider's widget.
    if (!isTokenSupported(provider, chainKey, cryptoToken, nativeSymbol)) {
      alert(
        `${getProviderName(provider)} doesn't sell ${cryptoToken.toUpperCase()} on ${chainKey.toUpperCase()}. ` +
        `Pick another provider, or go back and change your token.`,
      );
      return;
    }

    if (!walletAddress) {
      alert(`Wallet not connected for ${chainKey.toUpperCase()}`);
      return;
    }

    // Narrow the route-param currency string to Transak's FiatCurrency union.
    const transakFiatCurrency: FiatCurrency =
      (FIAT_CURRENCIES as readonly string[]).includes(fiatCurrency)
        ? (fiatCurrency as FiatCurrency)
        : 'USD';

    if (provider === 'transak') {
      if (chainKey === 'aptos') {
        alert('Transak does not natively support Aptos. Please select Onramp.money or another provider.');
        return;
      }

      const url = buildTransakDepositUrl({
        walletAddress,
        fiatAmount: parseFloat(fiatAmount),
        fiatCurrency: transakFiatCurrency,
        cryptoToken: cryptoToken,
        network: chainKey,
        paymentMethod: 'credit_debit_card',
      });

      navigation.navigate(SCREENS.TRANSAK_WEBVIEW, {
        url,
        title: flow === 'buy' ? 'Buy via Transak' : 'Sell via Transak',
        flow,
      });
    } else if (provider === 'onramp_money' || provider === 'moonpay') {
      setIsLoading(true);
      const session = await getOnrampUrl({
        walletAddress,
        fiatAmount,
        fiatCurrency,
        cryptoToken,
        chainKey,
        flow,
        provider,
      });
      setIsLoading(false);

      if (session) {
        navigation.navigate(SCREENS.ONRAMP_WIDGET, {
          url: session.url,
          orderId: session.orderId,
          title: flow === 'buy' ? `Buy via ${getProviderName(provider)}` : `Sell via ${getProviderName(provider)}`,
        });
      }
    } else {
      // Filtered by the provider matrix — should be unreachable. Log defensively.
      logUnsupportedChain({ chainKey, provider });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>SELECT PROVIDER</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.summaryContainer}>
          <Text style={styles.summaryLabel}>YOU {flow === 'buy' ? 'PAY' : 'RECEIVE'}</Text>
          <Text style={styles.summaryAmount}>{currencySymbol}{fiatAmount}</Text>
        </View>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>Fetching best rates...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <PressableOpacity onPress={fetchQuotes} style={styles.retryButton}>
              <Text style={styles.retryText}>RETRY</Text>
            </PressableOpacity>
          </View>
        ) : (
          <View style={styles.quotesContainer}>
            {quotes.map((quote, index) => {
              const supportedTokens = getSupportedTokens(quote.provider, chainKey, nativeSymbol);
              const tokenOk = supportedTokens.includes(cryptoToken.toUpperCase());
              return (
              <PressableOpacity
                key={quote.provider}
                onPress={() => handleProviderSelect(quote.provider)}
                activeOpacity={0.9}
              >
                <SovereignCard backgroundColor="transparent" style={[styles.quoteCard, { borderRadius: 0, borderWidth: 1, borderColor: colors.textPrimary }, !tokenOk && styles.quoteCardDimmed] as any}>
                  <View style={styles.quoteHeader}>
                    <View style={styles.providerInfo}>
                      <Icon name={getProviderIcon(quote.provider)} size={18} color={colors.accent} />
                      <Text style={styles.providerName}>{getProviderName(quote.provider)}</Text>
                      {index === 0 && (
                        <View style={styles.bestRateBadge}>
                          <Text style={styles.bestRateText}>BEST RATE</Text>
                        </View>
                      )}
                    </View>
                    <Icon name="chevron-right" size={20} color={colors.textMuted} />
                  </View>

                  <Text style={[styles.providerTokens, !tokenOk && styles.providerTokensWarn]}>
                    {tokenOk
                      ? `Supports: ${supportedTokens.join(' · ')}`
                      : `${cryptoToken.toUpperCase()} not available here · Supports: ${supportedTokens.join(' · ')}`}
                  </Text>

                  <View style={styles.quoteDetails}>
                    <View style={styles.amountBox}>
                      <Text style={styles.amountLabel}>YOU {flow === 'buy' ? 'RECEIVE' : 'PAY'} (EST)</Text>
                      <Text style={styles.cryptoAmount}>{quote.estimatedCryptoAmount} {cryptoToken}</Text>
                    </View>
                    <View style={styles.feeBox}>
                      <Text style={styles.feeLabel}>TOTAL FEES</Text>
                      <Text style={styles.feeAmount}>{currencySymbol}{parseFloat(quote.providerFee) + parseFloat(quote.networkFee)}</Text>
                    </View>
                  </View>
                </SovereignCard>
              </PressableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
  },
  scrollContent: {
    padding: 24,
  },
  summaryContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  summaryLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 2,
    marginBottom: 8,
  },
  summaryAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 48,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: typography.fontFamily.mono,
    color: colors.textSecondary,
    marginTop: 16,
    fontSize: 12,
  },
  errorContainer: {
    padding: 20,
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
  },
  errorText: {
    fontFamily: typography.fontFamily.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.error,
  },
  retryText: {
    fontFamily: typography.fontFamily.mono,
    color: colors.error,
    fontWeight: 'bold',
  },
  quotesContainer: {
    gap: 16,
  },
  quoteCard: {
    marginBottom: 0,
    padding: 20,
  },
  quoteCardDimmed: {
    opacity: 0.55,
  },
  providerTokens: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginTop: -8,
    marginBottom: 16,
  },
  providerTokensWarn: {
    color: colors.warning,
  },
  quoteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  providerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  providerName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  bestRateBadge: {
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.success,
    marginLeft: 8,
  },
  bestRateText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.success,
    fontWeight: 'bold',
  },
  quoteDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.outlineSubtle,
    paddingTop: 16,
  },
  amountBox: {
    flex: 1,
  },
  amountLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  cryptoAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    color: colors.accent,
    fontWeight: '700',
  },
  feeBox: {
    alignItems: 'flex-end',
  },
  feeLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  feeAmount: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    color: colors.textPrimary,
    fontWeight: '700',
  },
});
