/**
 * In-app browser for first-party pages (Privacy, Terms, Docs).
 * Reuses the same WebView shell as fiat gateways so content stays inside the app.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { FiatGatewayWebViewShell } from '../components/FiatGatewayWebViewShell';
import { PressableOpacity } from '../components/PressableOpacity';
import { Icon } from '../components/Icon';
import { useTheme, useStyles, typography, type Colors } from '../styles/design-tokens';
import { isVeilpayWebUrl } from '../constants/legalUrls';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SCREENS } from '../constants/screens';

type Nav = NativeStackNavigationProp<RootStackParamList, typeof SCREENS.IN_APP_BROWSER>;
type Rte = RouteProp<RootStackParamList, typeof SCREENS.IN_APP_BROWSER>;

interface Props {
  navigation: Nav;
  route: Rte;
}

const LOAD_TIMEOUT_MS = 30_000;

function HeaderCenter({ title, styles }: { title: string; styles: ReturnType<typeof themeStyles> }) {
  return (
    <View style={styles.headerTitleContainer}>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title.toUpperCase()}
      </Text>
    </View>
  );
}

export function InAppBrowserScreen({ navigation, route }: Props) {
  const { url, title } = route.params;
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [blocked, setBlocked] = useState(!isVeilpayWebUrl(url));
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    setLoadTimedOut(false);
    loadTimeoutRef.current = setTimeout(() => {
      setLoadTimedOut(true);
      setLoading(false);
    }, LOAD_TIMEOUT_MS);
  }, []);

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isVeilpayWebUrl(url)) {
      setBlocked(true);
      setLoading(false);
      return;
    }
    startLoadTimeout();
    return () => clearLoadTimeout();
  }, [url, startLoadTimeout, clearLoadTimeout]);

  const handleRetry = useCallback(() => {
    setLoadTimedOut(false);
    setLoading(true);
    startLoadTimeout();
    webViewRef.current?.reload();
  }, [startLoadTimeout]);

  const handleShouldStartLoadWithRequest = useCallback(
    (request: { url: string }) => {
      const next = request.url;
      if (next === 'about:blank') return true;
      // Allow same-site navigation (docs subpaths, anchors, CDN assets on veilpay hosts).
      if (isVeilpayWebUrl(next) || next === url) return true;
      // Block escapes to third-party browsers / phishing pages.
      return false;
    },
    [url]
  );

  const headerCenter = useMemo(
    () => <HeaderCenter title={title} styles={styles} />,
    [title, styles]
  );

  const errorState = blocked ? (
    <View style={styles.timeoutContainer}>
      <Icon name="close" size={28} color={colors.error} />
      <Text style={styles.timeoutTitle}>Link not allowed</Text>
      <Text style={styles.timeoutText}>This page cannot be opened inside VeilPay.</Text>
      <PressableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
        <Text style={styles.closeButtonText}>CLOSE</Text>
      </PressableOpacity>
    </View>
  ) : loadTimedOut ? (
    <View style={styles.timeoutContainer}>
      <Icon name="close" size={28} color={colors.error} />
      <Text style={styles.timeoutTitle}>Page failed to load</Text>
      <Text style={styles.timeoutText}>
        Check your network connection and try again.
      </Text>
      <View style={styles.timeoutActions}>
        <PressableOpacity onPress={handleRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>RETRY</Text>
        </PressableOpacity>
        <PressableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>CLOSE</Text>
        </PressableOpacity>
      </View>
    </View>
  ) : null;

  return (
    <Animated.View
      entering={FadeInDown.duration(320).springify().damping(18).stiffness(150)}
      style={{ flex: 1 }}
    >
      <FiatGatewayWebViewShell
        ref={webViewRef}
        onClose={() => navigation.goBack()}
        loading={loading && !blocked && !loadTimedOut}
        loadingMessage="Loading…"
        headerCenter={headerCenter}
        errorState={errorState}
        webViewProps={{
          source: blocked ? undefined : { uri: url },
          onLoadStart: () => {
            setLoading(true);
            startLoadTimeout();
          },
          onLoadEnd: () => {
            clearLoadTimeout();
            setLoading(false);
          },
          onError: () => {
            clearLoadTimeout();
            setLoadTimedOut(true);
            setLoading(false);
          },
          onShouldStartLoadWithRequest: handleShouldStartLoadWithRequest,
          // iOS
          sharedCookiesEnabled: true,
          // Android
          setSupportMultipleWindows: false,
          javaScriptEnabled: true,
          domStorageEnabled: true,
          startInLoadingState: true,
          allowsBackForwardNavigationGestures: true,
        }}
      />
    </Animated.View>
  );
}

const themeStyles = (colors: Colors) =>
  StyleSheet.create({
    headerTitleContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    headerTitle: {
      fontFamily: typography.fontFamily.headlineBold,
      fontSize: 13,
      letterSpacing: 1.2,
      color: colors.textPrimary,
    },
    timeoutContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 12,
      backgroundColor: colors.bgPrimary,
    },
    timeoutTitle: {
      fontFamily: typography.fontFamily.headlineBold,
      fontSize: 16,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    timeoutText: {
      fontFamily: typography.fontFamily.body,
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    timeoutActions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 8,
    },
    retryButton: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: colors.accent,
      borderRadius: 10,
    },
    retryButtonText: {
      fontFamily: typography.fontFamily.headlineBold,
      fontSize: 12,
      letterSpacing: 1,
      color: colors.bgPrimary,
    },
    closeButton: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.outlineSubtle,
    },
    closeButtonText: {
      fontFamily: typography.fontFamily.headlineBold,
      fontSize: 12,
      letterSpacing: 1,
      color: colors.textSecondary,
    },
  });
