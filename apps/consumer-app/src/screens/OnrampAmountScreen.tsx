import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,  TextInput,  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { ScreenBackButton } from '../components/ScreenBackButton';
import { SovereignButton } from '../components/SovereignButton';
import { SovereignCard } from '../components/SovereignCard';
import { Icon } from '../components/Icon';

import { useWalletStore } from '../stores/walletStore';
import { useSettingsStore } from '../stores/settingsStore';
import { CurrencySelectorModal, CURRENCIES } from '../components/CurrencySelectorModal';
import { SCREENS } from '../constants/screens';
import { triggerLightImpactHaptic } from '../utils/haptics';
import { getMinDepositAmount, type FiatCurrency } from '../utils/transak';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';

type OnrampAmountScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'OnrampAmount'>;
type OnrampAmountScreenRouteProp = RouteProp<RootStackParamList, 'OnrampAmount'>;

interface OnrampAmountScreenProps {
  navigation: OnrampAmountScreenNavigationProp;
  route: OnrampAmountScreenRouteProp;
}

export function OnrampAmountScreen({ navigation, route }: OnrampAmountScreenProps) {
  const { flow } = route.params;
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { activeChain } = useWalletStore();
  const { nativeCurrency, setNativeCurrency } = useSettingsStore();
  const [showCurrencySelector, setShowCurrencySelector] = useState(false);

  // Currency-aware quick amounts and defaults.
  // minAmount is tied to the real provider floor (getMinDepositAmount) so the
  // CONTINUE gate never lets a user through with an amount every provider will
  // reject — which previously produced an empty quotes list. Every quickAmount
  // preset is kept at or above minAmount so the presets never fight the gate.
  const { quickAmounts, defaultAmount, minAmount } = useMemo(() => {
    switch (nativeCurrency) {
      case 'INR':
        // Onramp.money INR floor (~₹1000 for most token/chain combos).
        return { quickAmounts: ['1000', '5000', '10000', '25000'], defaultAmount: '5000', minAmount: 1000 };
      case 'JPY':
        return { quickAmounts: ['5000', '10000', '25000', '50000'], defaultAmount: '10000', minAmount: getMinDepositAmount('JPY') };
      default: {
        // USD, EUR, GBP, AUD, CAD — western fiat via Transak/MoonPay.
        const min = getMinDepositAmount(nativeCurrency as FiatCurrency);
        return { quickAmounts: ['50', '100', '250', '500'], defaultAmount: '100', minAmount: min };
      }
    }
  }, [nativeCurrency]);

  const [amount, setAmount] = useState(defaultAmount);

  // Reset amount when currency changes so the user doesn't carry over
  // an INR-scale value into a USD context (or vice-versa).
  useEffect(() => {
    setAmount(defaultAmount);
  }, [defaultAmount]);

  // Build available tokens for the selected chain (native + stablecoins)
  const availableTokens = useMemo(() => {
    if (!activeChain) return [];
    const tokens = [activeChain.nativeToken.symbol];
    // Add stablecoins for EVM chains
    if (activeChain.type === 'evm') {
      tokens.push('USDC', 'USDT');
    }
    return tokens;
  }, [activeChain]);

  const [selectedToken, setSelectedToken] = useState<string>(
    activeChain?.nativeToken.symbol ?? 'ETH',
  );

  // Reset token selection when chain changes
  useEffect(() => {
    if (activeChain && !availableTokens.includes(selectedToken)) {
      setSelectedToken(activeChain.nativeToken.symbol);
    }
  }, [activeChain, availableTokens, selectedToken]);

  const currencyObj = useMemo(() => {
    return CURRENCIES.find(c => c.id === nativeCurrency) || CURRENCIES[0];
  }, [nativeCurrency]);
  const handleContinue = useCallback(() => {
    if (!amount || !activeChain) return;
    
    navigation.navigate(SCREENS.ONRAMP_QUOTES, {
      flow,
      fiatAmount: amount,
      fiatCurrency: nativeCurrency,
      cryptoToken: selectedToken,
      chainKey: activeChain.key,
    });
  }, [amount, activeChain, flow, navigation, nativeCurrency, selectedToken]);

  const handleQuickAmount = (val: string) => {
    triggerLightImpactHaptic();
    setAmount(val);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{flow === 'buy' ? 'BUY CRYPTO' : 'SELL CRYPTO'}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.inputSection}>
          <TouchableOpacity onPress={() => setShowCurrencySelector(true)} style={styles.currencyToggleBtn}>
            <Text style={styles.label}>AMOUNT IN {currencyObj.id}</Text>
            <Icon name="chevron-down" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
          
          <View style={styles.amountInputRow}>
            <Text style={styles.currencyPrefix}>{currencyObj.symbol}</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textFaint}
              autoFocus
            />
          </View>
          
          <View style={styles.quickAmountRow}>
            {quickAmounts.map((val) => (
              <TouchableOpacity
                key={val}
                style={[styles.quickAmountBtn, amount === val && styles.quickAmountBtnActive]}
                onPress={() => handleQuickAmount(val)}
              >
                <Text style={[styles.quickAmountText, amount === val && styles.quickAmountTextActive]}>
                  {currencyObj.symbol}{parseInt(val).toLocaleString('en-US')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {availableTokens.length > 1 && (
          <View style={styles.tokenSection}>
            <Text style={styles.label}>RECEIVE TOKEN</Text>
            <View style={styles.tokenRow}>
              {availableTokens.map((token) => (
                <TouchableOpacity
                  key={token}
                  style={[styles.tokenBtn, selectedToken === token && styles.tokenBtnActive]}
                  onPress={() => {
                    triggerLightImpactHaptic();
                    setSelectedToken(token);
                  }}
                >
                  <Text style={[styles.tokenText, selectedToken === token && styles.tokenTextActive]}>
                    {token}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={styles.infoSection}>
          <SovereignCard backgroundColor="transparent" padding={16} style={{ borderRadius: 0, borderWidth: 1, borderColor: colors.textPrimary }}>
            <View style={styles.infoRow}>
              <Icon name="info" size={16} color={colors.accent} />
              <Text style={styles.infoText}>
                You are using the VeilPay Aggregator for this transaction. 
                We will find the best rate across multiple providers.
              </Text>
            </View>
          </SovereignCard>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <SovereignButton
          title="CONTINUE"
          onPress={handleContinue}
          disabled={!amount || parseInt(amount) < minAmount}
        />
      </View>
      </Animated.View>

      <CurrencySelectorModal
        visible={showCurrencySelector}
        activeCurrency={nativeCurrency}
        onSelect={(curr) => {
          setNativeCurrency(curr);
          setShowCurrencySelector(false);
        }}
        onClose={() => setShowCurrencySelector(false)}
      />
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
  inputSection: {
    marginTop: 40,
    alignItems: 'center',
  },
  label: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 2,
  },
  currencyToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
    borderRadius: 0,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencyPrefix: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 40,
    color: colors.textPrimary,
    marginRight: 10,
    fontWeight: '700',
    letterSpacing: -1,
  },
  amountInput: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 64,
    color: colors.accent,
    fontWeight: '700',
    minWidth: 100,
    textAlign: 'center',
    letterSpacing: -2,
  },
  quickAmountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 40,
  },
  quickAmountBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    backgroundColor: 'transparent',
  },
  quickAmountBtnActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  quickAmountText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
  },
  quickAmountTextActive: {
    color: colors.bgPrimary,
    fontWeight: '700',
  },
  infoSection: {
    marginTop: 40,
  },
  tokenSection: {
    marginTop: 24,
    alignItems: 'center',
  },
  tokenRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  tokenBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    backgroundColor: 'transparent',
  },
  tokenBtnActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  tokenText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  tokenTextActive: {
    color: colors.bgPrimary,
    fontWeight: '700',
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontFamily: typography.fontFamily.body,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  footer: {
    padding: 24,
    paddingBottom: 40,
  },
  errorContainer: {
    marginTop: 20,
    padding: 12,
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    textAlign: 'center',
    fontFamily: typography.fontFamily.mono,
  },
});
