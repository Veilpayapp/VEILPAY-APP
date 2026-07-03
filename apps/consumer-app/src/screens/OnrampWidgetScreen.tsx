import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Text, View, Linking, StyleSheet, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme, useStyles, typography, type Colors } from "../styles/design-tokens";
import { Icon } from '../components/Icon';
import { useOnramp, FiatGatewayWebViewShell, isAllowedOnrampUrl, isPaymentIntentUrl } from '../features/fiat-gateway';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';

type OnrampWidgetScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'OnrampWidget'>;
type OnrampWidgetRouteProp = RouteProp<RootStackParamList, 'OnrampWidget'>;

interface OnrampWidgetScreenProps {
  navigation: OnrampWidgetScreenNavigationProp;
  route: OnrampWidgetRouteProp;
}

/** Maximum time to wait for the widget WebView to finish loading. */
const WIDGET_LOAD_TIMEOUT_MS = 30_000;

export function OnrampWidgetScreen({ navigation, route }: OnrampWidgetScreenProps) {
  const { url, title = 'PAYMENT GATEWAY', orderId } = route.params;
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const { checkOrderStatus } = useOnramp();
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Start/reset the load-timeout timer */
  const startLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    setLoadTimedOut(false);
    loadTimeoutRef.current = setTimeout(() => {
      setLoadTimedOut(true);
      setLoading(false);
    }, WIDGET_LOAD_TIMEOUT_MS);
  }, []);

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearLoadTimeout();
    };
  }, [clearLoadTimeout]);

  const handleRetry = useCallback(() => {
    setLoadTimedOut(false);
    setLoading(true);
    startLoadTimeout();
    webViewRef.current?.reload();
  }, [startLoadTimeout]);

  /**
   * Loopholes Addressed: 
   * - UPI Intent Handling: Detects upi:// and launches native apps (GPay, PhonePe).
   * - Sandbox Escapes: Prevents the WebView from navigating to untrusted domains.
   */
  const handleShouldStartLoadWithRequest = useCallback((request: { url: string }) => {
    const nextUrl = request.url;

    if (isPaymentIntentUrl(nextUrl)) {
      void Linking.openURL(nextUrl).catch(() => {
        // Ignore platform-specific failures; the gateway will show its own fallback.
      });
      return false;
    }

    return isAllowedOnrampUrl(nextUrl) || nextUrl === url || nextUrl === 'about:blank';
  }, [url]);

  useEffect(() => {
    if (!orderId) {
      return;
    }

    const syncOrderStatus = async () => {
      const order = await checkOrderStatus(orderId);

      if (!order) {
        return;
      }

      if (order.status === 'completed' || order.status === 'failed' || order.status === 'cancelled') {
        navigation.goBack();
      }
    };

    void syncOrderStatus();
    const intervalId = setInterval(syncOrderStatus, 10000);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkOrderStatus, navigation, orderId]);

  /**
   * Listen for events from the Onramp.money widget via postMessage.
   */
  const onMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (__DEV__) console.log('[OnrampEvent]', data);

      // If the order is created or widget closed, we can react here
      if (data.type === 'ONRAMP_WIDGET_CLOSED') {
        navigation.goBack();
      }
    } catch (e) {
      // Ignore non-JSON messages
    }
  };

  return (
    <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={{ flex: 1 }}>
    <FiatGatewayWebViewShell
      ref={webViewRef}
      onClose={() => navigation.goBack()}
      loading={loading}
      loadingMessage="Establishing Secure Connection..."
      headerCenter={
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>{title.toUpperCase()}</Text>
          <View style={styles.secureBadge}>
            <Icon name="private-lock" size={10} color={colors.success} />
            <Text style={styles.secureText}>SECURE GATEWAY</Text>
          </View>
        </View>
      }
      errorState={loadTimedOut ? (
        <View style={styles.timeoutContainer}>
          <Icon name="close" size={28} color={colors.error} />
          <Text style={styles.timeoutTitle}>Widget failed to load</Text>
          <Text style={styles.timeoutText}>
            The payment gateway did not respond within 30 seconds.
            Check your network connection and try again.
          </Text>
          <View style={styles.timeoutActions}>
            <TouchableOpacity onPress={handleRetry} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>RETRY</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      webViewProps={{
        source: { uri: url },
        onLoadStart: () => {
          setLoading(true);
          setLoadTimedOut(false);
          startLoadTimeout();
        },
        onLoadEnd: () => {
          setLoading(false);
          clearLoadTimeout();
        },
        onShouldStartLoadWithRequest: handleShouldStartLoadWithRequest,
        onMessage,
        javaScriptEnabled: true,
        domStorageEnabled: true,
        startInLoadingState: true,
        originWhitelist: ['https://*'],
        allowsBackForwardNavigationGestures: true,
      }}
    />
    </Animated.View>
  );
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 1,
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  secureText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 8,
    color: colors.success,
    fontWeight: '700',
  },
  timeoutContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
    backgroundColor: colors.surfaceScreen,
  },
  timeoutTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  timeoutText: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: 'center',
  },
  timeoutActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  retryButton: {
    minWidth: 96,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  retryButtonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.surfaceScreen,
    letterSpacing: 0.8,
  },
  closeButton: {
    minWidth: 96,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSecondary,
  },
  closeButtonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 0.8,
  },
});
