/**
 * Veilpay Receive QR Code Screen
 * Displays QR code for receiving payments
 * Uses the current hybrid structural design language for all interactive elements
 * 
 * UPDATED: Now generates real QR codes using react-native-qrcode-svg
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Share,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { useWalletStore } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import Toast, { useToast } from '../components/Toast';
import { Logo } from '../components/Logo';
import { BottomNavBar } from '../components/BottomNavBar';
import { Icon } from '../components/Icon';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { setClipboardString } from '../utils/clipboard';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type ReceiveQRScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ReceiveQR'>;

interface ReceiveQRScreenProps {
  navigation: ReceiveQRScreenNavigationProp;
}

export function ReceiveQRScreen({ navigation }: ReceiveQRScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [requestedAmount, setRequestedAmount] = useState('');
  const { address, activeChain } = useWalletStore();
  const toast = useToast();

  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.RECEIVE_QR_VIEWED, {
      chain_key: activeChain?.key || 'unknown',
      chain_type: activeChain?.type || 'unknown',
      has_address: Boolean(address),
    });
  }, [activeChain?.key, activeChain?.type, address]);

  // Generate QR code value based on address and optional amount
  const qrValue = useMemo(() => {
    if (!address) return '';

    // If amount is specified, create a payment request URI
    if (requestedAmount && parseFloat(requestedAmount) > 0) {
      const schemeMap: Record<string, string> = {
        evm: 'ethereum',
        svm: 'solana',
        xlm: 'stellar',
        mvm: 'aptos',
      };
      const scheme = schemeMap[activeChain?.type || 'evm'] || 'ethereum';
      return `${scheme}:${address}?amount=${requestedAmount}`;
    }

    // Otherwise just encode the address
    return address;
  }, [address, requestedAmount]);

  const handleBack = () => {
    trackEvent(ANALYTICS_EVENTS.RECEIVE_QR_BACK_PRESSED, {
      chain_key: activeChain?.key || 'unknown',
    });
    navigation.goBack();
  };

  const handleCopyAddress = async () => {
    if (address) {
      const copied = await setClipboardString(address);
      if (!copied) {
        trackEvent(ANALYTICS_EVENTS.RECEIVE_ADDRESS_COPY_FAILED, {
          reason: 'clipboard_unavailable',
        });
        toast.show('Clipboard unavailable in this runtime', 'error');
        return;
      }

      trackEvent(ANALYTICS_EVENTS.RECEIVE_ADDRESS_COPIED, {
        chain_key: activeChain?.key || 'unknown',
      });

      toast.show('Address copied to clipboard', 'success');
    }
  };

  const handleShareAddress = async () => {
    if (!address) {
      trackEvent(ANALYTICS_EVENTS.RECEIVE_ADDRESS_SHARE_FAILED, {
        reason: 'missing_address',
      });
      return;
    }

    try {
      await Share.share({
        message: `Send ${activeChain?.symbol || 'ETH'} on ${activeChain?.name || 'Ethereum'} network to my Veilpay wallet: ${address}`,
        title: 'Veilpay Wallet Address',
      });
      trackEvent(ANALYTICS_EVENTS.RECEIVE_ADDRESS_SHARED, {
        chain_key: activeChain?.key || 'unknown',
      });
    } catch (error) {
      trackEvent(ANALYTICS_EVENTS.RECEIVE_ADDRESS_SHARE_FAILED, {
        reason: 'share_error',
      });
      toast.show('Failed to share address', 'error');
    }
  };

  const handleRequestAmount = async () => {
    if (!address) {
      trackEvent(ANALYTICS_EVENTS.RECEIVE_REQUEST_LINK_FAILED, {
        reason: 'missing_address',
      });
      toast.show('No wallet address available', 'error');
      return;
    }

    if (!requestedAmount || parseFloat(requestedAmount) <= 0) {
      trackEvent(ANALYTICS_EVENTS.RECEIVE_REQUEST_LINK_FAILED, {
        reason: 'invalid_amount',
      });
      toast.show('Please enter a valid amount', 'error');
      return;
    }

    // Generate payment request link
    const requestLink = `veilpay://pay?to=${address}&amount=${requestedAmount}&token=${activeChain?.symbol || 'ETH'}`;
    const copied = await setClipboardString(requestLink);
    if (!copied) {
      trackEvent(ANALYTICS_EVENTS.RECEIVE_REQUEST_LINK_FAILED, {
        reason: 'clipboard_unavailable',
      });
      toast.show('Clipboard unavailable in this runtime', 'error');
      return;
    }

    trackEvent(ANALYTICS_EVENTS.RECEIVE_REQUEST_LINK_COPIED, {
      chain_key: activeChain?.key || 'unknown',
      has_amount: Boolean(requestedAmount),
    });

    toast.show('Payment request link copied', 'success');
  };

  const formatAddress = (addr: string) => {
    if (!addr) return 'Not available';
    return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
  };
  
  const handleNavPress = (screen: keyof RootStackParamList) => {
    if (screen === SCREENS.RECEIVE_QR) {
      // Already on receive
    } else {
      navigation.navigate(screen as never);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

      {/* Header */}
      <View style={styles.header}>
        <ScreenBackButton onPress={handleBack} />
        <Text style={styles.headerTitle}>RECEIVE</Text>
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(260)} style={styles.animatedContent}>
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Chain Info */}
          <View style={styles.chainInfo}>
            <Logo variant="icon" size="small" />
            <Text style={styles.chainName}>{activeChain?.name?.toUpperCase() || 'ETHEREUM'}</Text>
          </View>

          {/* QR Code Card */}
            <SovereignCard backgroundColor={colors.textPrimary} padding={0} style={{ marginBottom: 24 }}>
            <View style={styles.qrContainer}>
              {address ? (
                <QRCode
                  value={qrValue}
                  size={200}
                  color={colors.bgPrimary}
                  backgroundColor={colors.textPrimary}
                />
              ) : (
                <Text style={styles.noAddressText}>No wallet connected</Text>
              )}
            </View>
          </SovereignCard>

          {/* Network Selection Warning */}
          <View style={styles.warningBanner}>
            <Icon name="info" size={16} color={colors.warning} />
            <Text style={styles.warningText}>
              Ensure you only send {activeChain?.symbol || 'funds'} to this address via the {activeChain?.name?.toUpperCase() || 'ETHEREUM'} network.
            </Text>
          </View>

          {/* Address Display */}
          <Text style={styles.sectionLabel}>YOUR ADDRESS</Text>
            <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
              <View style={styles.addressContent}>
              <Text style={styles.addressText}>{address || 'Not connected'}</Text>
              <View style={styles.addressActions}>
                <TouchableOpacity
                  onPress={handleCopyAddress}
                  style={styles.addressActionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Copy wallet address"
                  accessibilityHint="Copies your wallet address to the clipboard"
                >
                  <Icon name="copy" size={18} color={colors.accent} />
                  <Text style={styles.addressActionText}>COPY</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleShareAddress}
                  style={styles.addressActionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Share wallet address"
                  accessibilityHint="Opens the share sheet for your wallet address"
                >
                  <Icon name="export" size={18} color={colors.accent} />
                  <Text style={styles.addressActionText}>SHARE</Text>
                </TouchableOpacity>
              </View>
            </View>
          </SovereignCard>

          {/* Request Specific Amount */}
          <Text style={styles.sectionLabel}>REQUEST SPECIFIC AMOUNT</Text>
          <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 16 }}>
            <View style={styles.requestRow}>
              <Text style={styles.requestInputPrefix}>{activeChain?.symbol || 'ETH'}</Text>
              <View style={styles.requestInputBox}>
                <TextInput
                  style={styles.requestInputValue}
                  value={requestedAmount}
                  onChangeText={(value) => {
                    const normalized = value.replace(/[^0-9.]/g, '');
                    const dotIndex = normalized.indexOf('.');
                    if (dotIndex >= 0) {
                      const integerPart = normalized.slice(0, dotIndex + 1);
                      const decimalPart = normalized.slice(dotIndex + 1).replace(/\./g, '');
                      setRequestedAmount(`${integerPart}${decimalPart}`);
                      return;
                    }

                    setRequestedAmount(normalized);
                  }}
                  placeholder="0.00"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </SovereignCard>

          <SovereignButton
            title="GENERATE PAYMENT REQUEST"
            variant="outline"
            onPress={handleRequestAmount}
            style={{ marginBottom: 24 }}
          />

          {/* Privacy Notice */}
          <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
              <View style={styles.privacyNotice}>
              <Icon name="private" size={24} color={colors.accent} />
              <View style={styles.privacyTextContainer}>
                <Text style={styles.privacyTitle}>STEALTH ADDRESS ACTIVE</Text>
                <Text style={styles.privacyDesc}>
                  Each incoming payment uses a unique stealth address. Your real address stays private.
                </Text>
              </View>
            </View>
          </SovereignCard>

          {/* Network Info */}
          <View style={styles.networkInfo}>
            <Text style={styles.networkLabel}>ACTIVE NETWORK:</Text>
            <Text style={styles.networkValue}>{activeChain?.name?.toUpperCase() || 'ETHEREUM'}</Text>
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>
      </Animated.View>

      <BottomNavBar currentScreen={SCREENS.RECEIVE_QR} onNavigate={handleNavPress} />

      {/* Toast Notification */}
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={toast.hide}
      />
    </SafeAreaView>
    </KeyboardAvoidingView>
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
    borderBottomWidth: 2,
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
  chainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 24,
  },
  chainName: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    color: colors.accent,
    fontWeight: 'bold',
  },
  qrContainer: {
    padding: 24,
    alignItems: 'center',
  },
  noAddressText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  sectionLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  addressContent: {
    padding: 16,
    gap: 16,
  },
  addressText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  addressActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  addressActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  addressActionIcon: {
    fontSize: 18,
  },
  addressActionText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.accent,
    fontWeight: 'bold',
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  requestInputPrefix: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    color: colors.accent,
    fontWeight: 'bold',
  },
  requestInputBox: {
    flex: 1,
    borderWidth: 0,
    borderColor: 'transparent',
    paddingVertical: 8,
    borderRadius: 0,
  },
  requestInputValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 24,
    color: colors.textPrimary,
    fontWeight: 'bold',
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
  networkInfo: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  networkLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textTertiary,
  },
  networkValue: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: 'bold',
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

export default ReceiveQRScreen;
