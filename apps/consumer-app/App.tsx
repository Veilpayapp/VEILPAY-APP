/**
 * Veilpay Consumer App
 * Privacy-first multi-chain payment application
 *
 * Target: Android (Expo Go + APK)
 * Design: Modern Minimalistic Dark Theme
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts as useInterFonts,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  useFonts as useJetBrainsMonoFonts,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  useFonts as useManropeFonts,
} from '@expo-google-fonts/manrope';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { BiometricPrompt } from './src/components/BiometricPrompt';
import { Logo } from './src/components/Logo';
import { NetworkStatusBanner } from './src/components/NetworkStatusBanner';
import { useWalletStore, validateAddress } from './src/stores/walletStore';
import { SCREENS } from './src/constants/screens';
import { deriveAddressFromMnemonic } from './src/utils/bip39';
import { getStoredMnemonic, isWalletInitialized } from './src/utils/transactions';
import { captureError, captureMessage, initSentry, setUserContext, addBreadcrumb } from './src/utils/sentry';
import { useOTAUpdates } from './src/hooks/useOTAUpdates';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { registerPushDeviceToken } from './src/utils/pushNotifications';
import { identifyUser, initAnalytics, resetAnalyticsUser, setAnalyticsConsent } from './src/utils/analytics';
import { validateEnvironment, getEnvValidationSummary } from './src/utils/envValidation';
import { useShallow } from 'zustand/react/shallow';
import { deriveAddressesForAllChains } from './src/utils/multiChainDerivation';

// Initialize Sentry safely at module scope
try {
  initSentry();
} catch (e) {
  console.warn('[sentry] Initialization failed:', e);
}

// Global error handler for logging
const handleGlobalError = (error: Error, errorInfo?: React.ErrorInfo) => {
  captureError(error, {
    componentStack: errorInfo?.componentStack,
  });

  console.error('Global error caught:', error.message);
  if (errorInfo?.componentStack) {
    console.error('Component stack:', errorInfo.componentStack);
  }
};

export default function App() {
  const [interFontsLoaded, interFontsError] = useInterFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const [manropeFontsLoaded, manropeFontsError] = useManropeFonts({
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const [jetBrainsMonoFontsLoaded, jetBrainsMonoFontsError] = useJetBrainsMonoFonts({
    JetBrainsMono_400Regular,
  });

  const fontLoadError = interFontsError ?? manropeFontsError ?? jetBrainsMonoFontsError;
  const areFontsReady = (
    interFontsLoaded
    && manropeFontsLoaded
    && jetBrainsMonoFontsLoaded
  ) || Boolean(fontLoadError);

  const {
    hasHydrated,
    address,
    isConnected,
    chainType,
    biometricsEnabled,
    notificationsEnabled,
    analyticsEnabled,
    connect,
    disconnect,
    setBiometricsEnabled,
    setPushToken,
  } = useWalletStore(
    useShallow((state) => ({
      hasHydrated: state.hasHydrated,
      address: state.address,
      isConnected: state.isConnected,
      chainType: state.chainType,
      biometricsEnabled: state.biometricsEnabled,
      notificationsEnabled: state.notificationsEnabled,
      analyticsEnabled: state.analyticsEnabled,
      connect: state.connect,
      disconnect: state.disconnect,
      setBiometricsEnabled: state.setBiometricsEnabled,
      setPushToken: state.setPushToken,
    }))
  );

  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [bootstrapRetryCount, setBootstrapRetryCount] = useState(0);
  const [isBiometricUnlocked, setIsBiometricUnlocked] = useState(
    !isConnected || !biometricsEnabled
  );
  const sessionBootstrapStartedRef = useRef(false);
  const hasBootstrappedRef = useRef(false);
  const shownUpdatePromptRef = useRef(false);
  const pushRegistrationKeyRef = useRef<string | null>(null);

  const {
    isProduction,
    isUpdateAvailable,
    downloadUpdate,
    applyUpdate,
    error: updateError,
  } = useOTAUpdates();

  const {
    token,
    isRegistered,
    error: pushError,
  } = usePushNotifications({
    autoRegister: notificationsEnabled && !__DEV__,
  });

  // ── P0: Environment validation (fail-fast on missing critical vars) ──
  useEffect(() => {
    const result = validateEnvironment();
    if (result.isValid) {
      return;
    }

    const summary = getEnvValidationSummary(result);
    captureMessage(`[env] Missing critical env vars: ${result.errors.map((e) => e.key).join(', ')}`, 'error');

    if (!__DEV__) {
      // In production, block startup with an alert
      Alert.alert(
        'Configuration Error',
        'This app is missing required configuration and cannot start safely. Please reinstall or contact support.\n\n' + summary,
        [{ text: 'Exit App', onPress: () => BackHandler.exitApp() }],
        { cancelable: false }
      );
    }
    // In dev, we log but allow the app to continue so the developer can fix
  }, []);

  useEffect(() => {
    if (!fontLoadError) {
      return;
    }

    captureMessage(`[fonts] ${fontLoadError.message}`, 'warning');

    if (!__DEV__) {
      captureError(fontLoadError, { scope: 'font-loading' });
    }
  }, [fontLoadError]);

  useEffect(() => {
    setAnalyticsConsent(analyticsEnabled);

    if (analyticsEnabled) {
      void initAnalytics();
      return;
    }

    resetAnalyticsUser();
  }, [analyticsEnabled]);

  // ── P0: Bootstrap with retry (exponential backoff, max 3 attempts) ──
  const MAX_BOOTSTRAP_RETRIES = 3;

  useEffect(() => {
    if (!hasHydrated || hasBootstrappedRef.current) {
      return;
    }

    hasBootstrappedRef.current = true;
    let cancelled = false;

    const bootstrapSession = async (attempt: number): Promise<void> => {
      if (!cancelled) {
        setIsBootstrapping(true);
      }

      try {
        const walletInitialized = await isWalletInitialized();

        if (!walletInitialized) {
          // Allow external wallet sessions that do not rely on local seed storage.
          const hasValidConnectedSession = Boolean(
            isConnected
            && address
            && chainType
            && validateAddress(address, chainType)
          );

          if (!hasValidConnectedSession && (isConnected || Boolean(address))) {
            disconnect();
          }
          if (!cancelled) {
            setIsSessionReady(true);
            setIsBootstrapping(false);
          }
          return;
        }

        const hasValidConnectedSession = Boolean(
          isConnected
          && address
          && chainType
          && validateAddress(address, chainType)
        );

        if (hasValidConnectedSession) {
          if (!cancelled) {
            setIsSessionReady(true);
            setIsBootstrapping(false);
          }
          return;
        }

        // Clear stale connection state before restoring
        if (isConnected || Boolean(address)) {
          disconnect();
        }

        const mnemonic = await getStoredMnemonic();
        if (!mnemonic) {
          disconnect();
          if (!cancelled) {
            setIsSessionReady(true);
            setIsBootstrapping(false);
          }
          return;
        }

        const addresses = await deriveAddressesForAllChains(mnemonic);
        const initialChainType = chainType ?? 'evm';
        const initialAddress = addresses[initialChainType] || addresses['evm'];
        
        await connect(initialAddress, initialChainType);

        if (!cancelled) {
          setIsSessionReady(true);
          setIsBootstrapping(false);
        }
      } catch (error: unknown) {
        captureError(error instanceof Error ? error : new Error('Failed to bootstrap wallet session'), {
          scope: 'wallet-session-bootstrap',
          attempt: String(attempt + 1),
        });

        if (attempt + 1 < MAX_BOOTSTRAP_RETRIES) {
          // Retry with exponential backoff: 2s, 4s
          const backoffMs = 2000 * Math.pow(2, attempt);
          captureMessage(`[bootstrap] Retry ${attempt + 2}/${MAX_BOOTSTRAP_RETRIES} in ${backoffMs / 1000}s`, 'warning');

          if (!cancelled) {
            setBootstrapRetryCount(attempt + 1);
          }

          await new Promise((resolve) => {
            const timer = setTimeout(resolve, backoffMs);
            // Allow cancellation during backoff wait
            const check = setInterval(() => {
              if (cancelled) {
                clearTimeout(timer);
                clearInterval(check);
                resolve(undefined);
              }
            }, 200);
          });

          if (!cancelled) {
            // Reset the ref so the next attempt can proceed
            hasBootstrappedRef.current = false;
            return bootstrapSession(attempt + 1);
          }
        } else {
          // Exhausted retries — allow app to continue in disconnected state
          captureMessage(`[bootstrap] All ${MAX_BOOTSTRAP_RETRIES} attempts failed. Continuing in disconnected state.`, 'error');
          disconnect();
          if (!cancelled) {
            setIsSessionReady(true);
            setIsBootstrapping(false);
          }
        }
      }
    };

    void bootstrapSession(0);

    return () => {
      cancelled = true;
    };
  }, [hasHydrated]);

  useEffect(() => {
    if (!isConnected || !biometricsEnabled) {
      setIsBiometricUnlocked(true);
      return;
    }

    setIsBiometricUnlocked(false);
  }, [biometricsEnabled, isConnected]);

  useEffect(() => {
    if (!isConnected || !address) {
      setUserContext();
      resetAnalyticsUser();
      return;
    }

    setUserContext(address);
    identifyUser(address, {
      wallet_connected: isConnected,
      chain_type: chainType || 'unknown',
    });
  }, [address, chainType, isConnected]);

  useEffect(() => {
    if (!isProduction || !isUpdateAvailable || shownUpdatePromptRef.current) {
      return;
    }

    shownUpdatePromptRef.current = true;

    Alert.alert(
      'Update Available',
      'A new Veilpay update is ready. Update now to get the latest fixes and improvements.',
      [
        {
          text: 'Later',
          style: 'cancel',
        },
        {
          text: 'Update now',
          onPress: async () => {
            const downloaded = await downloadUpdate();
            if (downloaded) {
              await applyUpdate();
            }
          },
        },
      ]
    );
  }, [applyUpdate, downloadUpdate, isProduction, isUpdateAvailable]);

  useEffect(() => {
    if (updateError) {
      captureError(new Error(updateError), { scope: 'ota-updates' });
    }
  }, [updateError]);

  useEffect(() => {
    if (pushError) {
      // In Expo Go, push notifications are not supported - don't report errors
      if (__DEV__) {
        console.log('[push-notifications] Push error (expected in Expo Go):', pushError);
      } else {
        captureMessage(`[push-notifications] ${pushError}`, 'warning');
        captureError(new Error(pushError), { scope: 'push-notifications' });
      }
    }
  }, [pushError]);

  useEffect(() => {
    if (!notificationsEnabled || !token || !isRegistered) {
      setPushToken(null);
      pushRegistrationKeyRef.current = null;
      return;
    }

    setPushToken(token);

    const registrationKey = `${token}:${address || 'anonymous'}`;
    if (registrationKey === pushRegistrationKeyRef.current) {
      return;
    }

    pushRegistrationKeyRef.current = registrationKey;

    registerPushDeviceToken({
      token,
      walletAddress: address,
    })
      .then((registered) => {
        if (registered) {
          return;
        }

        pushRegistrationKeyRef.current = null;
        captureMessage('[push-notifications] Push token registration failed', 'warning');

        if (!__DEV__) {
          captureError(new Error('Push token registration failed'), {
            walletAddress: address,
          });
        }
      })
      .catch((error: unknown) => {
        pushRegistrationKeyRef.current = null;
        const normalizedError = error instanceof Error
          ? error
          : new Error('Push token registration failed');

        captureMessage(`[push-notifications] ${normalizedError.message}`, 'warning');

        if (!__DEV__) {
          captureError(normalizedError, {
            walletAddress: address,
          });
        }
      });
  }, [address, isRegistered, notificationsEnabled, setPushToken, token]);

  // ── P0: Refresh balances and transactions on app foreground ──
  const appStateRef = useRef(AppState.currentState);
  const lastForegroundTimeRef = useRef(Date.now());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      const isNowActive = nextAppState === 'active';

      appStateRef.current = nextAppState;

      if (wasBackground && isNowActive && isConnected && address) {
        const elapsed = Date.now() - lastForegroundTimeRef.current;
        lastForegroundTimeRef.current = Date.now();

        if (elapsed > 10_000) {
          useWalletStore.getState().refreshTransactions();
          addBreadcrumb('App foregrounded — refreshing data', 'app-lifecycle', {
            elapsedMs: elapsed,
          });
        }
      }

      if (nextAppState === 'background' || nextAppState === 'inactive') {
        lastForegroundTimeRef.current = Date.now();
      }
    });

    return () => subscription.remove();
  }, [isConnected, address]);

  const isAppReady = hasHydrated && isSessionReady && areFontsReady;
  const initialRouteName = isConnected ? SCREENS.HOME : SCREENS.ONBOARDING;

  const shouldShowBiometricPrompt = isConnected && biometricsEnabled && !isBiometricUnlocked;

  if (!isAppReady) {
    return (
      <ErrorBoundary onError={handleGlobalError}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <View style={styles.bootContainer}>
            <Logo variant="icon" size="large" />
            <ActivityIndicator size="large" color="#F59E0B" />
            <Text style={styles.bootTitle}>Veilpay</Text>
            <Text style={styles.bootSubtitle}>
              {areFontsReady ? 'Securing wallet session...' : 'Loading typography...'}
            </Text>
          </View>
        </SafeAreaProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary onError={handleGlobalError}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NetworkStatusBanner />
        {shouldShowBiometricPrompt ? (
          <BiometricPrompt
            onSuccess={() => setIsBiometricUnlocked(true)}
            onCancel={() => {
              // If biometrics are unavailable, continue without logging the user out.
              setBiometricsEnabled(false);
              setIsBiometricUnlocked(true);
            }}
          />
        ) : (
          <AppNavigator initialRouteName={initialRouteName} />
        )}
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050505',
    gap: 12,
  },
  bootTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Manrope_700Bold',
  },
  bootSubtitle: {
    color: '#A3A3A3',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
});
