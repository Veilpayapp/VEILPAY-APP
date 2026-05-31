import React, { useState, useCallback, useMemo } from 'react';
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
import { SCREENS } from '../constants/screens';
import { triggerLightImpactHaptic } from '../utils/haptics';
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
  const [amount, setAmount] = useState('5000');
  const { activeChain } = useWalletStore();
  const handleContinue = useCallback(() => {
    if (!amount || !activeChain) return;
    
    navigation.navigate(SCREENS.ONRAMP_QUOTES, {
      flow,
      fiatAmount: amount,
      cryptoToken: activeChain.nativeToken.symbol,
      chainKey: activeChain.key,
    });
  }, [amount, activeChain, flow, navigation]);

  const handleQuickAmount = (val: string) => {
    triggerLightImpactHaptic();
    setAmount(val);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      <View style={styles.header}>
        <ScreenBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>{flow === 'buy' ? 'BUY CRYPTO' : 'SELL CRYPTO'}</Text>
        <View style={{ width: 44 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.inputSection}>
          <Text style={styles.label}>AMOUNT IN INR</Text>
          <View style={styles.amountInputRow}>
            <Text style={styles.currencyPrefix}>₹</Text>
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
            {['1000', '5000', '10000', '25000'].map((val) => (
              <TouchableOpacity
                key={val}
                style={[styles.quickAmountBtn, amount === val && styles.quickAmountBtnActive]}
                onPress={() => handleQuickAmount(val)}
              >
                <Text style={[styles.quickAmountText, amount === val && styles.quickAmountTextActive]}>
                  ₹{parseInt(val).toLocaleString('en-IN')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.infoSection}>
          <SovereignCard backgroundColor={colors.bgSecondary}>
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
          disabled={!amount || parseInt(amount) < 100}
        />
      </View>
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
  inputSection: {
    marginTop: 40,
    alignItems: 'center',
  },
  label: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 2,
    marginBottom: 20,
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
  },
  amountInput: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 64,
    color: colors.accent,
    fontWeight: '700',
    minWidth: 100,
    textAlign: 'center',
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
    backgroundColor: colors.surfaceCard,
  },
  quickAmountBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
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
    backgroundColor: colors.errorBg,
    borderRadius: 8,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    textAlign: 'center',
    fontFamily: typography.fontFamily.mono,
  },
});
