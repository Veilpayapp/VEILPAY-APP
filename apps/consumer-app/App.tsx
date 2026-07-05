/**
 * Veilpay Consumer App
 * Privacy-first multi-chain payment application
 *
 * Target: Android (Expo Go + APK)
 * Design: Modern Minimalistic Dark Theme
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
import { BootSplash } from './src/components/BootSplash';
import { NetworkStatusBanner } from './src/components/NetworkStatusBanner';
import { CommitmentSaveBanner } from './src/components/CommitmentSaveBanner';
import { UpdatePromptModal } from './src/components/UpdatePromptModal';
import { useDepositPersistenceRecovery } from './src/hooks/useDepositPersistenceRecovery';
import { useWalletStore } from './src/stores/walletStore';
import { useSettingsStore } from './src/stores/settingsStore';
import { useTransactionStore } from './src/stores/transactionStore';
import { SCREENS } from './src/constants/screens';
import { captureError, captureMessage, initSentry, setUserContext, addBreadcrumb } from './src/utils/sentry';
import { useOTAUpdates } from './src/hooks/useOTAUpdates';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { registerPushDeviceToken } from './src/utils/pushNotifications';
import { identifyUser, initAnalytics, resetAnalyticsUser, setAnalyticsConsent } from './src/utils/analytics';
import { validateEnvironment, getEnvValidationSummary } from './src/utils/envValidation';
import { useShallow } from 'zustand/react/shallow';
import { useSessionBootstrap } from './src/hooks/useSessionBootstrap';
import { initializePinning } from './src/utils/security';

// Initialize Sentry and Security safely at module scope
try {
  initSentry();
  void initializePinning();
} catch (e) {
  console.warn('[init] Initialization failed:', e);
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
function MainApp() {
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

  const { hasHydrated, address, isConnected, chainType } = useWalletStore(
    useShallow((state) => ({
      hasHydrated: state.hasHydrated,
      address: state.address,
      isConnected: state.isConnected,
      chainType: state.chainType,
    }))
  );

  const {
    biometricsEnabled,
    notificationsEnabled,
    analyticsEnabled,
    setBiometricsEnabled,
    setPushToken,
  } = useSettingsStore(
    useShallow((state) => ({
      biometricsEnabled: state.biometricsEnabled,
      notificationsEnabled: state.notificationsEnabled,
      analyticsEnabled: state.analyticsEnabled,
      setBiometricsEnabled: state.setBiometricsEnabled,
      setPushToken: state.setPushToken,
    }))
  );

  const [isBiometricUnlocked, setIsBiometricUnlocked] = useState(
    !isConnected || !biometricsEnabled
  );
  
  const shownUpdatePromptRef = useRef(false);
  const pushRegistrationKeyRef = useRef<string | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);

  const {
    isProduction,
    isUpdateAvailable,
    isDownloading,
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

  const { isSessionReady, bootstrapRetryCount } = useSessionBootstrap();

  // Retry any deposits whose `CommitmentRecord` failed to persist on a
  // previous app session. Mounted once at the root so it runs on every
  // cold launch / fresh App mount before the privacy flow is reachable.
  // See requirements.md Requirement 7.7 and tasks.md task 7.4.
  useDepositPersistenceRecovery();

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

  // Surface the branded update prompt once per launch when an OTA is available.
  useEffect(() => {
    if (!isProduction || !isUpdateAvailable || shownUpdatePromptRef.current) {
      return;
    }

    shownUpdatePromptRef.current = true;
    setShowUpdatePrompt(true);
  }, [isProduction, isUpdateAvailable]);

  const handleApplyUpdate = async () => {
    const downloaded = await downloadUpdate();
    if (downloaded) {
      // reloadAsync() tears down the JS context, so the modal never needs to
      // be hidden explicitly on the success path.
      await applyUpdate();
      return;
    }
    // Download failed (updateError is set) — keep the modal open so the user
    // sees the error and can retry or dismiss.
  };

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
          useTransactionStore.getState().refreshTransactions();
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

  // Once the wallet store has hydrated we know whether a biometric lock is
  // required, so the native OS prompt can fire immediately — in parallel with
  // the (slower) session bootstrap — instead of waiting for the whole app to be
  // ready. `shouldShowBiometricPrompt` requires `isConnected`, which only
  // becomes true after hydration restores the persisted session, so the prompt
  // never flashes before hydration. The AppNavigator still mounts only once the
  // app is fully ready AND the lock is cleared, so this is a pure UX reordering
  // that does not weaken the biometric gate — no wallet decryption is gated by
  // biometrics today.
  const renderContent = () => {
    if (shouldShowBiometricPrompt) {
      return (
        <BiometricPrompt
          onSuccess={() => setIsBiometricUnlocked(true)}
          onCancel={() => {
            // If biometrics are unavailable, continue without logging the user out.
            setBiometricsEnabled(false);
            setIsBiometricUnlocked(true);
          }}
        />
      );
    }

    if (!isAppReady) {
      return (
        <BootSplash
          title="VEILPAY"
          subtitle={
            areFontsReady
              ? bootstrapRetryCount > 0
                ? `Retrying connection (${bootstrapRetryCount}/3)...`
                : 'Securing wallet session...'
              : 'Loading typography...'
          }
        />
      );
    }

    return (
      <>
        <NetworkStatusBanner />
        <CommitmentSaveBanner />
        <UpdatePromptModal
          visible={showUpdatePrompt}
          isDownloading={isDownloading}
          error={updateError}
          onLater={() => setShowUpdatePrompt(false)}
          onUpdate={handleApplyUpdate}
        />
        <View style={{ flex: 1, backgroundColor: '#0A0A0A' }}>
          <AppNavigator initialRouteName={initialRouteName} />
        </View>
      </>
    );
  };

  return (
    <ErrorBoundary onError={handleGlobalError}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0A0A0A' }}>
        <SafeAreaProvider style={{ backgroundColor: '#0A0A0A' }}>
          <StatusBar style="light" />
          {renderContent()}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const AppEntryPoint = MainApp;

export default AppEntryPoint;
