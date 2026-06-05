import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { ScreenBackButton } from '../components/ScreenBackButton';
import { SovereignCard } from '../components/SovereignCard';
import { Icon } from '../components/Icon';
import { useWalletStore } from '../stores/walletStore';
import { useSettingsStore } from '../stores/settingsStore';
import { SCREENS } from '../constants/screens';
import { triggerLightImpactHaptic } from '../utils/haptics';
import { buildTransakDepositUrl } from '../utils/transak';
import { useOnramp } from '../features/fiat-gateway';
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

export function OnrampQuotesScreen({ navigation, route }: OnrampQuotesScreenProps) {
  const { flow, fiatAmount, cryptoToken, chainKey } = route.params;
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { address } = useWalletStore();
  const { nativeCurrency } = useSettingsStore();
  const { getOnrampUrl } = useOnramp();
  
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuotes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';
      const response = await fetch(`${baseUrl}/api/v1/onramp/quotes?fiatAmount=${fiatAmount}&fiatCurrency=${nativeCurrency}&cryptoToken=${cryptoToken}&flow=${flow}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch quotes');
      }
      
      const data = await response.json();
      setQuotes(data.quotes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [fiatAmount, cryptoToken, flow]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  const handleProviderSelect = async (provider: string) => {
    triggerLightImpactHaptic();

    if (!address) {
      alert(`Wallet not connected for ${chainKey.toUpperCase()}`);
      return;
    }

    if (provider === 'transak') {
      if (chainKey === 'aptos') {
        alert('Transak does not natively support Aptos. Please select Onramp.money or another provider.');
        return;
      }

      const url = buildTransakDepositUrl({
        walletAddress: address,
        fiatAmount: parseFloat(fiatAmount),
        fiatCurrency: nativeCurrency,
        cryptoToken: cryptoToken,
        network: chainKey, // Using chainKey directly, Transak utils might map it internally
        paymentMethod: 'credit_debit_card',
      });

      navigation.navigate(SCREENS.TRANSAK_WEBVIEW, {
        url,
        title: flow === 'buy' ? 'Buy via Transak' : 'Sell via Transak',
        flow,
      });
    } else if (provider === 'onramp_money') {
      setIsLoading(true);
      const session = await getOnrampUrl({
        fiatAmount,
        cryptoToken,
        chainKey,
        flow,
      });
      setIsLoading(false);

      if (session) {
        navigation.navigate(SCREENS.ONRAMP_WIDGET, {
          url: session.url,
          orderId: session.orderId,
          title: flow === 'buy' ? 'Buy via Onramp.money' : 'Sell via Onramp.money',
        });
      }
    } else {
      // Moonpay / Stripe stub
      alert(`${provider} integration coming soon! Please use Transak or Onramp.money.`);
    }
  };

  const getProviderName = (providerId: string) => {
    switch(providerId) {
      case 'onramp_money': return 'Onramp.money';
      case 'moonpay': return 'MoonPay';
      case 'stripe': return 'Stripe';
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>SELECT PROVIDER</Text>
        <View style={{ width: 44 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.summaryContainer}>
          <Text style={styles.summaryLabel}>YOU {flow === 'buy' ? 'PAY' : 'RECEIVE'}</Text>
          <Text style={styles.summaryAmount}>₹{fiatAmount}</Text>
        </View>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>Fetching best rates...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={fetchQuotes} style={styles.retryButton}>
              <Text style={styles.retryText}>RETRY</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.quotesContainer}>
            {quotes.map((quote, index) => (
              <TouchableOpacity
                key={quote.provider}
                onPress={() => handleProviderSelect(quote.provider)}
                activeOpacity={0.9}
              >
                <SovereignCard backgroundColor="transparent" style={[styles.quoteCard, { borderRadius: 0, borderWidth: 1, borderColor: colors.textPrimary }] as any}>
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
                  
                  <View style={styles.quoteDetails}>
                    <View style={styles.amountBox}>
                      <Text style={styles.amountLabel}>YOU {flow === 'buy' ? 'RECEIVE' : 'PAY'} (EST)</Text>
                      <Text style={styles.cryptoAmount}>{quote.estimatedCryptoAmount} {cryptoToken}</Text>
                    </View>
                    <View style={styles.feeBox}>
                      <Text style={styles.feeLabel}>TOTAL FEES</Text>
                      <Text style={styles.feeAmount}>₹{parseFloat(quote.providerFee) + parseFloat(quote.networkFee)}</Text>
                    </View>
                  </View>
                </SovereignCard>
              </TouchableOpacity>
            ))}
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 1,
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
