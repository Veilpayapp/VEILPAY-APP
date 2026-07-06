/**
 * Veilpay Payment Success Screen
 * Full-screen premium success state for completed transactions
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, BackHandler, StatusBar } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  FadeInUp,
  ZoomIn,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withSpring,
  withDelay,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme, useStyles, typography, spacing } from '../styles/design-tokens';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import { Icon } from '../components/Icon';
import { getNetworkIcon } from '../components/NetworkIcons';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import { triggerNotificationHaptic } from '../utils/haptics';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';

type PaymentSuccessScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'PaymentSuccess'>;
type PaymentSuccessScreenRoute = RouteProp<RootStackParamList, 'PaymentSuccess'>;

interface PaymentSuccessScreenProps {
  navigation: PaymentSuccessScreenNavigationProp;
  route: PaymentSuccessScreenRoute;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function SuccessCheckmark({ color }: { color: string }) {
  const progress = useSharedValue(0);
  const circleProgress = useSharedValue(0);

  useEffect(() => {
    // Animate circle first, then checkmark
    circleProgress.value = withTiming(1, { duration: 600 });
    progress.value = withDelay(400, withTiming(1, { duration: 400 }));
  }, []);

  const animatedCheckProps = useAnimatedProps(() => ({
    strokeDashoffset: 100 - (progress.value * 100),
  }));

  const animatedCircleProps = useAnimatedProps(() => ({
    strokeDashoffset: 300 - (circleProgress.value * 300),
  }));

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', height: 120, width: 120 }}>
      <Animated.View entering={ZoomIn.duration(400).springify()}>
        <Svg width="120" height="120" viewBox="0 0 100 100" fill="none">
          <AnimatedCircle
            cx="50"
            cy="50"
            r="45"
            stroke={color}
            strokeWidth="4"
            strokeDasharray="300"
            animatedProps={animatedCircleProps}
          />
          <AnimatedPath
            d="M30 50 L45 65 L70 35"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="100"
            animatedProps={animatedCheckProps}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

export function PaymentSuccessScreen({ navigation, route }: PaymentSuccessScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const { transaction } = route.params;

  useEffect(() => {
    triggerNotificationHaptic(Haptics.NotificationFeedbackType.Success);
    
    // Disable back button on Android to prevent going back to confirmation screen
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleDone();
      return true;
    });

    return () => backHandler.remove();
  }, []);

  const handleDone = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: SCREENS.HOME }],
    });
  };

  const handleViewDetails = () => {
    navigation.replace(SCREENS.TRANSACTION_DETAILS, { transaction });
  };

  const NetworkIconSVG = getNetworkIcon(transaction.network || '');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerSpacer} />
        
        {/* Success Animation */}
        <View style={styles.animationContainer}>
          <SuccessCheckmark color={colors.accent} />
          <Animated.Text 
            entering={FadeInUp.delay(600).duration(400)} 
            style={styles.successTitle}
          >
            Payment Sent
          </Animated.Text>
        </View>

        {/* Receipt Card */}
        <Animated.View entering={FadeInDown.delay(800).duration(600).springify()}>
          <SovereignCard backgroundColor={colors.surfaceCard} padding={20} style={styles.receiptCard}>
            <View style={styles.amountContainer}>
              <Text style={styles.amountLabel}>Total Amount</Text>
              <Text style={styles.amountValue}>
                {transaction.amount} {transaction.tokenSymbol}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>To</Text>
              <Text style={styles.detailValue} numberOfLines={1} ellipsizeMode="middle">
                {transaction.to ? `${transaction.to.slice(0, 8)}...${transaction.to.slice(-6)}` : 'Unknown'}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Network</Text>
              <View style={styles.networkBadge}>
                {NetworkIconSVG && <NetworkIconSVG size={14} />}
                <Text style={styles.networkName}>{transaction.network?.toUpperCase() || 'UNKNOWN'}</Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Date</Text>
              <Text style={styles.detailValue}>
                {new Date(transaction.timestamp).toLocaleDateString()} at {new Date(transaction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </SovereignCard>
        </Animated.View>
        
        <View style={styles.flexSpacer} />

        {/* Actions */}
        <Animated.View entering={FadeInDown.delay(1000).duration(400)} style={styles.actionsContainer}>
          <SovereignButton
            title="VIEW TRANSACTION"
            variant="outline"
            onPress={handleViewDetails}
            style={styles.actionButton}
          />
          <SovereignButton
            title="DONE"
            variant="primary"
            onPress={handleDone}
            style={styles.actionButton}
          />
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  headerSpacer: {
    height: 40,
  },
  animationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  successTitle: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 28,
    color: colors.textPrimary,
    marginTop: 24,
    letterSpacing: 0.5,
  },
  receiptCard: {
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.outlineSubtle,
  },
  amountContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  amountLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
    letterSpacing: 1,
  },
  amountValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineSubtle,
    marginVertical: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  detailLabel: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
  },
  detailValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    maxWidth: '60%',
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  networkName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  flexSpacer: {
    flex: 1,
    minHeight: 40,
  },
  actionsContainer: {
    gap: 16,
  },
  actionButton: {
    width: '100%',
  },
});

export default PaymentSuccessScreen;
