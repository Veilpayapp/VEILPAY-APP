import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,  StyleSheet,  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { SCREENS } from '../constants/screens';
import { Logo } from '../components/Logo';
import { useWalletStore, ChainType } from '../stores/walletStore';
import { SovereignCard } from "../components/SovereignCard";
import { MetaMaskIcon, TrustWalletIcon, WalletConnectIcon, PhantomIcon, PetraIcon, LobstrIcon, LedgerIcon } from '../components/WalletIcons';
import Toast, { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { trackEvent } from '../utils/analytics';
import { ANALYTICS_EVENTS } from '../utils/analyticsEvents';
import { createDemoEvmAddress } from '../utils/demoWallet';
import { createWalletConnectSession, hasWalletConnectProjectId } from '../utils/walletConnectSession';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';

type WalletConnectScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'WalletConnect'>;
type WalletConnectScreenRoute = RouteProp<RootStackParamList, 'WalletConnect'>;

interface WalletConnectScreenProps {
  navigation: WalletConnectScreenNavigationProp;
  route: WalletConnectScreenRoute;
}

const MAX_EXTERNAL_CONNECT_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60_000;
const EXTERNAL_CONNECT_COOLDOWN_MS = 30_000;
const IS_DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_WALLET_CONNECT === 'true';

type ExternalWalletId = 'MetaMask' | 'Trust Wallet' | 'WalletConnect' | 'Phantom' | 'Petra' | 'Lobstr' | 'Ledger';

function buildExternalWalletLaunchUrl(walletId: ExternalWalletId, uri: string): string {
  const encodedUri = encodeURIComponent(uri);

  switch (walletId) {
    case 'MetaMask':
      return `https://metamask.app.link/wc?uri=${encodedUri}`;
    case 'Trust Wallet':
      return `https://link.trustwallet.com/wc?uri=${encodedUri}`;
    case 'Phantom':
      return `https://phantom.app/ul/wc?uri=${encodedUri}`;
    case 'Petra':
      return `petra://wc?uri=${encodedUri}`;
    case 'Lobstr':
      return `lobstr://wc?uri=${encodedUri}`;
    case 'Ledger':
      return `ledgerlive://wc?uri=${encodedUri}`;
    case 'WalletConnect':
      return uri;
    default:
      return uri;
  }
}

function resolveChainTypeFromWalletConnect(
  chainId: string | null,
  fallbackChainType: ChainType
): ChainType {
  if (!chainId) {
    return fallbackChainType;
  }

  if (chainId.startsWith('solana:')) {
    return 'svm';
  }

  if (chainId.startsWith('aptos:')) {
    return 'mvm';
  }

  return 'evm';}export function WalletConnectScreen({ navigation, route }: WalletConnectScreenProps) {  const { colors } = useTheme();  const styles = useStyles(themeStyles);
  const [connecting, setConnecting] = useState<string | null>(null);  const [attemptTimestamps, setAttemptTimestamps] = useState<number[]>([]);  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const { connect } = useWalletStore();
  const handledCallbackRef = useRef<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_VIEWED);
  }, []);

  useEffect(() => {
    const uri = route?.params?.uri;
    if (!uri) {
      return;
    }

    trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_URI_RECEIVED, {
      source: route?.params?.source || 'unknown',
    });
    toast.show('WalletConnect request received', 'info');
  }, [route?.params?.source, route?.params?.uri, toast]);

  useEffect(() => {
    const callbackError = route?.params?.error;
    if (!callbackError) {
      return;
    }    trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_CALLBACK_ERROR, {
      error: callbackError,
      source: route?.params?.source || 'unknown',
    });    setInlineError(callbackError);
    toast.show(callbackError, 'error');
  }, [route?.params?.error, route?.params?.source, toast]);

  useEffect(() => {
    const incomingAddress = route?.params?.address?.trim();
    if (!incomingAddress) {
      return;
    }

    const incomingChainType = route?.params?.chainType || 'evm';
    const callbackKey = `${incomingAddress}-${incomingChainType}`;
    if (handledCallbackRef.current === callbackKey) {
      return;
    }
    handledCallbackRef.current = callbackKey;

    let cancelled = false;

    const finalizeConnection = async () => {
      trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_CALLBACK_RECEIVED, {
        chainType: incomingChainType,
        source: route?.params?.source || 'unknown',
      });
      setConnecting(route?.params?.source || 'WalletConnect');
      setInlineError(null);

      try {
        await connect(incomingAddress, incomingChainType);
        if (cancelled) {
          return;
        }

        trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_CALLBACK_SUCCESS, {
          chainType: incomingChainType,
          source: route?.params?.source || 'unknown',
        });
        toast.show('Wallet connected successfully', 'success');
        navigation.reset({ index: 0, routes: [{ name: SCREENS.HOME }] });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error
          ? error.message
          : 'Wallet callback validation failed. Please retry connection.';
        trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_CALLBACK_FAILED, {
          chainType: incomingChainType,
          error: message,
          source: route?.params?.source || 'unknown',
        });
        setInlineError(message);
        toast.show(message, 'error');
      } finally {
        if (!cancelled) {
          setConnecting(null);
        }
      }
    };

    void finalizeConnection();

    return () => {
      cancelled = true;
    };
  }, [
    connect,
    navigation,
    route?.params?.address,
    route?.params?.chainType,
    route?.params?.source,
    toast,
  ]);

  const handleBack = () => {
    trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_BACK_PRESSED);
    navigation.goBack();
  };

  const handleInternalWallet = (type: 'create' | 'import') => {
    trackEvent(
      type === 'create'
        ? ANALYTICS_EVENTS.WALLET_CONNECT_INTERNAL_CREATE_SELECTED
        : ANALYTICS_EVENTS.WALLET_CONNECT_INTERNAL_IMPORT_SELECTED
    );
    if (type === 'create') {
      navigation.navigate(SCREENS.CREATE_WALLET);
    } else {
      navigation.navigate(SCREENS.IMPORT_WALLET);
    }
  };

  const handleExternalWallet = async (walletId: ExternalWalletId, chainType: ChainType) => {
    const now = Date.now();

    if (cooldownUntil && now < cooldownUntil) {
      const remainingSeconds = Math.ceil((cooldownUntil - now) / 1000);
      trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_EXTERNAL_BLOCKED_COOLDOWN, {
        walletId,
        remainingSeconds,
      });
      const cooldownMessage = `Too many connection attempts. Try again in ${remainingSeconds}s.`;
      setInlineError(cooldownMessage);
      toast.show(cooldownMessage, 'error');
      return;
    }

    const recentAttempts = attemptTimestamps.filter(
      (timestamp) => now - timestamp < ATTEMPT_WINDOW_MS
    );

    if (recentAttempts.length >= MAX_EXTERNAL_CONNECT_ATTEMPTS) {
      const nextCooldown = now + EXTERNAL_CONNECT_COOLDOWN_MS;
      setCooldownUntil(nextCooldown);
      setAttemptTimestamps(recentAttempts);

      trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_EXTERNAL_THROTTLED, {
        walletId,
        attemptsInWindow: recentAttempts.length,
      });
      const throttleMessage = `Too many connection attempts. Please wait ${Math.ceil(EXTERNAL_CONNECT_COOLDOWN_MS / 1000)}s.`;
      setInlineError(throttleMessage);
      toast.show(throttleMessage, 'error');
      return;
    }

    setAttemptTimestamps([...recentAttempts, now]);
    setInlineError(null);
    setConnecting(walletId);
    trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_EXTERNAL_ATTEMPT_STARTED, {
      walletId,
      chainType,
      hasUri: Boolean(route?.params?.uri?.trim()),
    });

    try {
      // SECURITY: Demo mode is opt-in and disabled by default.
      if (IS_DEMO_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const mockAddress = createDemoEvmAddress();
        await connect(mockAddress, chainType);

        trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_EXTERNAL_DEMO_SUCCESS, {
          walletId,
          chainType,
        });
        toast.show(`${walletId} connected in demo mode`, 'success');
        navigation.reset({ index: 0, routes: [{ name: SCREENS.HOME }] });
        return;
      }

      let uri = route?.params?.uri?.trim() || '';
      let waitForApproval: null | (() => Promise<{ address: string | null; chainId: string | null }>) = null;

      if (!uri) {
        if (!hasWalletConnectProjectId()) {
          throw new Error(
            'No WalletConnect session URI found. Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID or start from a dApp or scan WalletConnect QR first.'
          );
        }

        const sessionRequest = await createWalletConnectSession();
        uri = sessionRequest.uri;
        waitForApproval = sessionRequest.waitForApproval;
        trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_SDK_URI_CREATED, {
          walletId,
          chainType,
        });
      }

      const launchUrl = buildExternalWalletLaunchUrl(walletId, uri);
      const canOpen = await Linking.canOpenURL(launchUrl);
      if (!canOpen) {
        throw new Error(`${walletId} is unavailable on this device.`);
      }

      await Linking.openURL(launchUrl);
      trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_EXTERNAL_APP_OPENED, {
        walletId,
        chainType,
      });

      if (!waitForApproval) {
        toast.show(`Opened ${walletId}. Approve the connection in your wallet app.`, 'info');
        return;
      }

      toast.show(`Opened ${walletId}. Waiting for wallet approval...`, 'info');
      const approval = await waitForApproval();

      if (!approval.address) {
        toast.show(`Opened ${walletId}. Approve the connection in your wallet app.`, 'info');
        return;
      }

      const resolvedChainType = resolveChainTypeFromWalletConnect(approval.chainId, chainType);
      await connect(approval.address, resolvedChainType);

      trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_SDK_APPROVED, {
        walletId,
        chainType: resolvedChainType,
        wcChainId: approval.chainId || 'unknown',
      });
      toast.show(`${walletId} connected successfully`, 'success');
      navigation.reset({ index: 0, routes: [{ name: SCREENS.HOME }] });
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : `Failed to connect ${walletId}. Please try again.`;
      trackEvent(ANALYTICS_EVENTS.WALLET_CONNECT_EXTERNAL_FAILED, {
        walletId,
        chainType,
        error: errorMessage,
      });
      setInlineError(errorMessage);
      toast.show(errorMessage, 'error');
    } finally {
      setConnecting(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />
      
      <View style={styles.header}>
        <ScreenBackButton onPress={handleBack} />
        <Logo variant="manual" size="small" />
        <View style={{ width: 80 }} />
      </View>

      <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={styles.animatedContent}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.headline}>CHOOSE CONNECTION METHOD</Text>

        <View style={styles.section}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => handleInternalWallet('create')}
            style={{ marginBottom: 20 }}
            accessibilityRole="button"
            accessibilityLabel="Create new wallet"
            accessibilityHint="Starts wallet creation with a new seed phrase"
          >
        <SovereignCard backgroundColor={colors.textPrimary}>
          <View style={styles.methodRow}>
            <View style={[styles.methodIconBox, { backgroundColor: colors.accent }]}>
              <Icon name="private-lock" size={24} color={colors.bgPrimary} />
            </View>
            <View style={styles.methodTextContainer}>
              <Text style={[styles.methodTitle, { color: colors.bgPrimary }]}>CREATE NEW WALLET</Text>
              <Text style={[styles.methodDescription, { color: colors.textTertiary }]}>Generate a new seed phrase. Secure, private, and yours.</Text>
                 </View>
              </View>
            </SovereignCard>
          </TouchableOpacity>
          
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => handleInternalWallet('import')}
            style={{ marginBottom: 32 }}
            accessibilityRole="button"
            accessibilityLabel="Import existing wallet"
            accessibilityHint="Restores a wallet using seed phrase or private key"
          >
        <SovereignCard backgroundColor={colors.surfaceCard}>
          <View style={styles.methodRow}>
            <View style={[styles.methodIconBox, { backgroundColor: colors.bgPrimary, borderColor: colors.bgContainerHighest }]}>
              <Icon name="receive" size={24} color={colors.accent} />
            </View>
            <View style={styles.methodTextContainer}>
              <Text style={[styles.methodTitle, { color: colors.textPrimary }]}>IMPORT EXISTING</Text>
              <Text style={[styles.methodDescription, { color: colors.textMuted }]}>Restore via seed phrase or private key securely.</Text>
                 </View>
              </View>
            </SovereignCard>
          </TouchableOpacity>
        </View>

        <View style={styles.dividerWrapper}>
          <View style={styles.dividerLine} />
          <View style={styles.dividerBadge}>
            <Text style={styles.dividerText}>EXTERNAL WALLETS</Text>
          </View>
          <View style={styles.dividerLine} />
        </View>

        {inlineError ? (
      <SovereignCard backgroundColor={colors.surfaceCard} style={{ marginBottom: 16 }}>
        <View style={styles.errorCardContent}>
          <Icon name="warning" size={18} color={colors.error} />
              <Text style={styles.errorCardText}>{inlineError}</Text>
            </View>
          </SovereignCard>
        ) : null}

      <View style={styles.section}>
        <TouchableOpacity 
          activeOpacity={0.9} 
          onPress={() => handleExternalWallet('MetaMask', 'evm')} 
          style={{ marginBottom: 16 }}
          disabled={connecting !== null}
          accessibilityRole="button"
          accessibilityLabel="Connect MetaMask"
          accessibilityHint="Opens MetaMask to approve connection"
          accessibilityState={{ disabled: connecting !== null }}
        >
        <SovereignCard backgroundColor={colors.surfaceCard}>
          <View style={styles.methodRow}>
            <View style={[styles.methodIconBox, { backgroundColor: colors.surfaceCard, borderColor: colors.bgPrimary }]}>
              {connecting === 'MetaMask' ? (
                <ActivityIndicator size="small" color={colors.success} />
                ) : (
                  <MetaMaskIcon width={24} height={24} />
                )}
              </View>
              <View style={styles.methodTextContainer}>
              <Text style={[styles.methodTitle, { color: colors.success }]}>METAMASK</Text>
              <Text style={[styles.methodDescription, { color: colors.textMuted }]}>Connect your existing MetaMask wallet.</Text>
              </View>
            </View>
          </SovereignCard>
        </TouchableOpacity>

        <TouchableOpacity 
          activeOpacity={0.9} 
          onPress={() => handleExternalWallet('Trust Wallet', 'evm')} 
          style={{ marginBottom: 16 }}
          disabled={connecting !== null}
          accessibilityRole="button"
          accessibilityLabel="Connect Trust Wallet"
          accessibilityHint="Opens Trust Wallet to approve connection"
          accessibilityState={{ disabled: connecting !== null }}
        >
        <SovereignCard backgroundColor={colors.surfaceCard}>
          <View style={styles.methodRow}>
            <View style={[styles.methodIconBox, { backgroundColor: colors.surfaceCard, borderColor: colors.bgPrimary }]}>
              {connecting === 'Trust Wallet' ? (
                <ActivityIndicator size="small" color="#3B82F6" />
                ) : (
                  <TrustWalletIcon width={24} height={24} />
                )}
              </View>
              <View style={styles.methodTextContainer}>
              <Text style={[styles.methodTitle, { color: "#3B82F6" }]}>TRUST WALLET</Text>
              <Text style={[styles.methodDescription, { color: colors.textMuted }]}>Connect your Trust Wallet securely.</Text>
              </View>
            </View>
          </SovereignCard>
        </TouchableOpacity>

        <TouchableOpacity 
          activeOpacity={0.9} 
          onPress={() => handleExternalWallet('Phantom', 'svm')} 
          style={{ marginBottom: 16 }}
          disabled={connecting !== null}
          accessibilityRole="button"
          accessibilityLabel="Connect Phantom"
          accessibilityHint="Opens Phantom to approve connection"
          accessibilityState={{ disabled: connecting !== null }}
        >
        <SovereignCard backgroundColor={colors.surfaceCard}>
          <View style={styles.methodRow}>
            <View style={[styles.methodIconBox, { backgroundColor: colors.surfaceCard, borderColor: colors.bgPrimary }]}>
              {connecting === 'Phantom' ? (
                <ActivityIndicator size="small" color="#AB9FF2" />
                ) : (
                  <PhantomIcon width={24} height={24} />
                )}
              </View>
              <View style={styles.methodTextContainer}>
              <Text style={[styles.methodTitle, { color: "#AB9FF2" }]}>PHANTOM</Text>
              <Text style={[styles.methodDescription, { color: colors.textMuted }]}>Connect your Solana Phantom wallet.</Text>
              </View>
            </View>
          </SovereignCard>
        </TouchableOpacity>

        <TouchableOpacity 
          activeOpacity={0.9} 
          onPress={() => handleExternalWallet('Petra', 'mvm')} 
          style={{ marginBottom: 16 }}
          disabled={connecting !== null}
          accessibilityRole="button"
          accessibilityLabel="Connect Petra"
          accessibilityHint="Opens Petra to approve connection"
          accessibilityState={{ disabled: connecting !== null }}
        >
        <SovereignCard backgroundColor={colors.surfaceCard}>
          <View style={styles.methodRow}>
            <View style={[styles.methodIconBox, { backgroundColor: colors.surfaceCard, borderColor: colors.bgPrimary }]}>
              {connecting === 'Petra' ? (
                <ActivityIndicator size="small" color="#E86C6A" />
                ) : (
                  <PetraIcon width={24} height={24} />
                )}
              </View>
              <View style={styles.methodTextContainer}>
              <Text style={[styles.methodTitle, { color: "#E86C6A" }]}>PETRA</Text>
              <Text style={[styles.methodDescription, { color: colors.textMuted }]}>Connect your Aptos Petra wallet.</Text>
              </View>
            </View>
          </SovereignCard>
        </TouchableOpacity>

        <TouchableOpacity 
          activeOpacity={0.9} 
          onPress={() => handleExternalWallet('Lobstr', 'xlm')} 
          style={{ marginBottom: 16 }}
          disabled={connecting !== null}
          accessibilityRole="button"
          accessibilityLabel="Connect Lobstr"
          accessibilityHint="Opens Lobstr to approve connection"
          accessibilityState={{ disabled: connecting !== null }}
        >
        <SovereignCard backgroundColor={colors.surfaceCard}>
          <View style={styles.methodRow}>
            <View style={[styles.methodIconBox, { backgroundColor: colors.surfaceCard, borderColor: colors.bgPrimary }]}>
              {connecting === 'Lobstr' ? (
                <ActivityIndicator size="small" color="#00C48C" />
                ) : (
                  <LobstrIcon width={24} height={24} />
                )}
              </View>
              <View style={styles.methodTextContainer}>
              <Text style={[styles.methodTitle, { color: "#00C48C" }]}>LOBSTR</Text>
              <Text style={[styles.methodDescription, { color: colors.textMuted }]}>Connect your Stellar Lobstr wallet.</Text>
              </View>
            </View>
          </SovereignCard>
        </TouchableOpacity>

        <TouchableOpacity 
          activeOpacity={0.9} 
          onPress={() => handleExternalWallet('Ledger', 'evm')} 
          style={{ marginBottom: 16 }}
          disabled={connecting !== null}
          accessibilityRole="button"
          accessibilityLabel="Connect Ledger Live"
          accessibilityHint="Opens Ledger Live to approve connection"
          accessibilityState={{ disabled: connecting !== null }}
        >
        <SovereignCard backgroundColor={colors.surfaceCard}>
          <View style={styles.methodRow}>
            <View style={[styles.methodIconBox, { backgroundColor: colors.surfaceCard, borderColor: colors.bgPrimary }]}>
              {connecting === 'Ledger' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <LedgerIcon width={24} height={24} />
                )}
              </View>
              <View style={styles.methodTextContainer}>
              <Text style={[styles.methodTitle, { color: colors.textPrimary }]}>LEDGER LIVE</Text>
              <Text style={[styles.methodDescription, { color: colors.textMuted }]}>Connect your Ledger Nano via Ledger Live.</Text>
              </View>
            </View>
          </SovereignCard>
        </TouchableOpacity>

        <TouchableOpacity 
          activeOpacity={0.9} 
          onPress={() => handleExternalWallet('WalletConnect', 'evm')} 
          style={{ marginBottom: 16 }}
          disabled={connecting !== null}
          accessibilityRole="button"
          accessibilityLabel="Connect with WalletConnect"
          accessibilityHint="Opens WalletConnect-compatible wallet approval"
          accessibilityState={{ disabled: connecting !== null }}
        >
        <SovereignCard backgroundColor={colors.surfaceCard}>
          <View style={styles.methodRow}>
            <View style={[styles.methodIconBox, { backgroundColor: colors.surfaceCard, borderColor: colors.bgPrimary }]}>
              {connecting === 'WalletConnect' ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <WalletConnectIcon width={24} height={24} />
                )}
              </View>
              <View style={styles.methodTextContainer}>
              <Text style={[styles.methodTitle, { color: colors.textPrimary }]}>WALLETCONNECT</Text>
              <Text style={[styles.methodDescription, { color: colors.textMuted }]}>Connect with any supported external wallet.</Text>
              </View>
            </View>
          </SovereignCard>
        </TouchableOpacity>
          </View>
        </ScrollView>
      </Animated.View>

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
    // No-Line Rule: Removed borderBottomWidth and borderBottomColor
  },
  backButton: { width: 80, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  backButtonText: { fontFamily: typography.fontFamily.mono, color: colors.textMuted, fontSize: 13, fontWeight: 'bold' },
  animatedContent: {
    flex: 1,
  },
  
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },
  headline: {
    fontFamily: typography.fontFamily.headlineBold,
    fontSize: 28,
    color: colors.textPrimary,
    marginBottom: 32,
    textAlign: 'left',
  },
  section: {
    marginBottom: 16,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 44,
  },
  methodIconBox: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodIcon: { fontSize: 24 },
  methodTextContainer: { flex: 1, gap: 4 },
  methodTitle: { fontFamily: typography.fontFamily.mono, fontSize: 16, fontWeight: 'bold' },
  methodDescription: { fontFamily: typography.fontFamily.bodyMedium, fontSize: 13, lineHeight: 18 },
  
  dividerWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 32,
    gap: 12
  },
  dividerLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.surfaceCard
  },
  dividerBadge: {
    backgroundColor: colors.surfaceScreen,
    borderWidth: 0,
    borderColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 6,
    transform: [{ rotate: '-2deg' }]
  },
  dividerText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: 'bold',
    letterSpacing: 1
  },
  errorCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  errorCardText: {
    flex: 1,
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.errorMuted,
    lineHeight: 16,
  },
});

export default WalletConnectScreen;