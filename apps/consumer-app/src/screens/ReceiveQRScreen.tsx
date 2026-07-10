/* istanbul ignore file */
/**
 * Veilpay Receive QR Code Screen
 * Displays QR code for receiving payments
 * Uses the current hybrid structural design language for all interactive elements
 * 
 * UPDATED: Now generates real QR codes using react-native-qrcode-svg
 */

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar, Share, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { PressableOpacity } from '../components/PressableOpacity';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { useWalletStore } from '../stores/walletStore';
import { SCREENS } from '../constants/screens';
import { SovereignCard } from "../components/SovereignCard";
import { SovereignButton } from "../components/SovereignButton";
import { HybridInput } from "../components/HybridInput";
import Toast, { useToast } from '../components/Toast';
import { Logo } from '../components/Logo';
import { BottomNavBar } from '../components/BottomNavBar';
import { Icon } from '../components/Icon';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { setClipboardString } from '../utils/clipboard';
import { createSendLink } from '../utils/deepLinking';
import { triggerLightImpactHaptic } from '../utils/haptics';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type ReceiveQRScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ReceiveQR'>;

interface ReceiveQRScreenProps {
  navigation: ReceiveQRScreenNavigationProp;}const formatAddress = (addr: string) => {
  if (!addr) return 'Not available';
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
};

export function ReceiveQRScreen({ navigation }: ReceiveQRScreenProps) {
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const [requestedAmount, setRequestedAmount] = useState('');
  const { address, activeChain } = useWalletStore();
  const toast = useToast();
  const viewShotRef = useRef<View>(null);

  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.RECEIVE_QR_VIEWED, {
      chain_key: activeChain?.key || 'unknown',
      chain_type: activeChain?.type || 'unknown',
      has_address: Boolean(address),
    });
  }, [activeChain?.key, activeChain?.type, address]);

  const deepLinkChainType =
    activeChain?.type === 'evm' || activeChain?.type === 'svm' || activeChain?.type === 'xlm'
      ? activeChain.type
      : undefined;

  // QR: in-app payment link (works for EVM / Solana / Stellar). Wallet apps that
  // only understand native URIs can still paste the address from the card below.
  const qrValue = useMemo(() => {
    if (!address) return '';
    const amount =
      requestedAmount && parseFloat(requestedAmount) > 0 ? requestedAmount : undefined;
    return createSendLink(address, {
      amount,
      token: activeChain?.symbol,
      chainType: deepLinkChainType,
    });
  }, [address, requestedAmount, activeChain?.symbol, deepLinkChainType]);

  const handleBack = () => {
    trackEvent(ANALYTICS_EVENTS.RECEIVE_QR_BACK_PRESSED, {
      chain_key: activeChain?.key || 'unknown',
    });
    navigation.goBack();
  };

  const handleCopyAddress = async () => {
    if (address) {
      void triggerLightImpactHaptic();
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

    void triggerLightImpactHaptic();
    try {
      const uri = await captureRef(viewShotRef, {
        format: 'png',
        quality: 1,
      });
      
      await Sharing.shareAsync(uri, {
        dialogTitle: 'Share Veilpay Wallet Address',
        mimeType: 'image/png',
      });
      
      trackEvent(ANALYTICS_EVENTS.RECEIVE_ADDRESS_SHARED, {
        chain_key: activeChain?.key || 'unknown',
      });
    } catch (error) {
      trackEvent(ANALYTICS_EVENTS.RECEIVE_ADDRESS_SHARE_FAILED, {
        reason: 'share_error',
      });
      toast.show('Failed to share address image', 'error');
    }
  };

  const handleRequestAmount = async () => {
    void triggerLightImpactHaptic();
    if (!address) {
      trackEvent(ANALYTICS_EVENTS.RECEIVE_REQUEST_LINK_FAILED, {
        reason: 'missing_address',
      });
      toast.show('No wallet address available', 'error');
      return;
    }

    const hasAmount = Boolean(requestedAmount && parseFloat(requestedAmount) > 0);
    // Amount optional: without it, link still opens Send with recipient filled.
    const requestLink = createSendLink(address, {
      amount: hasAmount ? requestedAmount : undefined,
      token: activeChain?.symbol,
      chainType: deepLinkChainType,
    });

    // Prefer system share (works when clipboard is restricted). Also copy.
    let shared = false;
    let copied = false;
    try {
      await Share.share({
        message: hasAmount
          ? `Pay me ${requestedAmount} ${activeChain?.symbol || ''} on VeilPay:\n${requestLink}`
          : `Send to me on VeilPay:\n${requestLink}`,
        title: 'VeilPay payment request',
      });
      shared = true;
    } catch {
      // User dismissed share sheet or Share unavailable — still try clipboard.
    }

    copied = await setClipboardString(requestLink);

    if (!shared && !copied) {
      trackEvent(ANALYTICS_EVENTS.RECEIVE_REQUEST_LINK_FAILED, {
        reason: 'share_and_clipboard_failed',
      });
      toast.show('Could not share or copy the payment link', 'error');
      return;
    }

    trackEvent(ANALYTICS_EVENTS.RECEIVE_REQUEST_LINK_COPIED, {
      chain_key: activeChain?.key || 'unknown',
      has_amount: hasAmount,
      shared,
      copied,
    });

    if (shared && copied) {
      toast.show('Payment link shared and copied', 'success');
    } else if (shared) {
      toast.show('Payment link ready to share', 'success');
    } else {
      toast.show('Payment link copied', 'success');
    }
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

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={styles.animatedContent}>
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
            <SovereignCard backgroundColor={colors.surfaceCard} padding={0} style={{ marginBottom: 24 }}>
            <View 
              style={styles.qrContainer}
              accessibilityRole="image"
              accessibilityLabel={`QR Code for wallet address ${address || 'not connected'}`}
            >
              {address ? (
                <QRCode
                  value={qrValue}
                  size={220}
                  color={colors.textPrimary}
                  backgroundColor={colors.surfaceCard}
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
                <PressableOpacity
                  onPress={handleCopyAddress}
                  style={styles.addressActionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Copy wallet address"
                  accessibilityHint="Copies your wallet address to the clipboard"
                >
                  <Icon name="copy" size={18} color={colors.accent} />
                  <Text style={styles.addressActionText}>COPY</Text>
                </PressableOpacity>
                <PressableOpacity
                  onPress={handleShareAddress}
                  style={styles.addressActionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Share wallet address"
                  accessibilityHint="Opens the share sheet for your wallet address"
                >
                  <Icon name="export" size={18} color={colors.accent} />
                  <Text style={styles.addressActionText}>SHARE</Text>
                </PressableOpacity>
              </View>
            </View>
          </SovereignCard>

          {/* Request Specific Amount */}
          <HybridInput
            label="REQUEST SPECIFIC AMOUNT"
            value={requestedAmount}
            onChangeText={(value: string) => {
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
            keyboardType="decimal-pad"
            wrapperStyle={{ marginBottom: 16 }}
            rightAdornment={
              <Text style={styles.requestInputPrefix}>{activeChain?.symbol || 'ETH'}</Text>
            }
          />

          <SovereignButton
            title={
              requestedAmount && parseFloat(requestedAmount) > 0
                ? 'SHARE PAYMENT LINK'
                : 'SHARE RECEIVE LINK'
            }
            variant="outline"
            onPress={handleRequestAmount}
            style={{ marginBottom: 24 }}
            disabled={!address}
          />

          {/* Privacy notice — EVM stealth vs Stellar private (SPP) */}
          <View style={styles.privacyNoticeContainer}>
            <View style={styles.privacyHazardTape} />
            <View style={styles.privacyContent}>
              <Icon name="private" size={24} color={colors.success} />
              <View style={styles.privacyTextGroup}>
                <Text style={styles.privacyTitle}>
                  {activeChain?.type === 'xlm'
                    ? 'PRIVATE RECEIVE'
                    : activeChain?.type === 'evm'
                      ? 'STEALTH-READY'
                      : 'YOUR ADDRESS'}
                </Text>
                <Text style={styles.privacyText}>
                  {activeChain?.type === 'xlm'
                    ? 'Share this G… address for public XLM. For private pay, contacts use Send privately after you have a private balance (pXLM).'
                    : activeChain?.type === 'evm'
                      ? 'Incoming private payments can use one-time stealth addresses where supported. Always verify network and token.'
                      : 'Only send assets on the network shown above. Double-check the address before sharing.'}
                </Text>
              </View>
            </View>
          </View>

          {/* Network Info */}
          <View style={styles.networkInfo}>
            <Text style={styles.networkLabel}>ACTIVE NETWORK:</Text>
            <Text style={styles.networkValue}>{activeChain?.name?.toUpperCase() || 'ETHEREUM'}</Text>
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>
      </Animated.View>

      <BottomNavBar currentScreen={SCREENS.RECEIVE_QR} onNavigate={handleNavPress} />

      {/* Off-screen view for generating the shareable image */}
      <View style={styles.shareImageWrapper} pointerEvents="none" collapsable={false}>
        <View ref={viewShotRef} style={styles.shareImageContainer} collapsable={false}>
          <View style={styles.shareImageHeader}>
            <Logo variant="full" />
            <Text style={styles.shareImageNetwork}>
              {activeChain?.name?.toUpperCase() || 'ETHEREUM'} NETWORK
            </Text>
          </View>

          <View style={styles.shareImageQrWrapper}>
            {address ? (
              <QRCode
                value={qrValue}
                size={260}
                color={colors.textPrimary}
                backgroundColor={colors.surfaceCard}
              />
            ) : null}
          </View>

          <View style={styles.shareImageAddressBox}>
            <Text style={styles.shareImageLabel}>WALLET ADDRESS</Text>
            <Text style={styles.shareImageAddress}>{address}</Text>
          </View>
        </View>
      </View>

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

const themeStyles = (colors: Colors) => StyleSheet.create({
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
    // No-Line Rule: Removed borderBottomWidth and borderBottomColor
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
    paddingRight: 16,
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
  privacyNoticeContainer: {
    borderWidth: 1,
    borderColor: colors.textPrimary,
    borderRadius: 0,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 24,
  },
  privacyHazardTape: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: 4,
    backgroundColor: colors.textPrimary,
  },
  privacyContent: {
    flexDirection: 'row',
    padding: 20,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  privacyTextGroup: {
    marginLeft: 16,
    flex: 1,
  },
  privacyTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.success,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 4,
  },
  privacyText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textPrimary,
    lineHeight: 16,
    opacity: 0.9,
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
    backgroundColor: 'transparent',
    padding: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    marginBottom: 24,
    gap: 10,
    alignItems: 'center',
  },
  warningText: {
    flex: 1,
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: 11,
    color: colors.warning,
    lineHeight: 15,
  },
  shareImageWrapper: {
    position: 'absolute',
    top: -10000,
    left: -10000,
  },
  shareImageContainer: {
    width: 400,
    backgroundColor: colors.surfaceScreen,
    padding: 40,
    alignItems: 'center',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.accent + '20',
  },
  shareImageHeader: {
    alignItems: 'center',
    marginBottom: 40,
    gap: 12,
  },
  shareImageNetwork: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,    color: colors.accent,
    fontWeight: '900',
    letterSpacing: 2,
  },  shareImageQrWrapper: {
    padding: 24,
    backgroundColor: colors.surfaceCard,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    marginBottom: 40,
  },
  shareImageAddressBox: {
    width: '100%',
    backgroundColor: colors.surfaceCard,
    padding: 24,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.accent + '20',
    alignItems: 'center',
    marginBottom: 32,
  },
  shareImageLabel: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  shareImageAddress: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 15,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 22,
  },
});

