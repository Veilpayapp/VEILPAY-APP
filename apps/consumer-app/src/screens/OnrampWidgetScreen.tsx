import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Text, View, Linking, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
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

export function OnrampWidgetScreen({ navigation, route }: OnrampWidgetScreenProps) {
  const { url, title = 'PAYMENT GATEWAY', orderId } = route.params;
  const { colors } = useTheme();
  const styles = useStyles(themeStyles);
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const { checkOrderStatus } = useOnramp();

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
      console.log('[OnrampEvent]', data);

      // If the order is created or widget closed, we can react here
      if (data.type === 'ONRAMP_WIDGET_CLOSED') {
        navigation.goBack();
      }
    } catch (e) {
      // Ignore non-JSON messages
    }
  };

  return (
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
      webViewProps={{
        source: { uri: url },
        onLoadStart: () => setLoading(true),
        onLoadEnd: () => setLoading(false),
        onShouldStartLoadWithRequest: handleShouldStartLoadWithRequest,
        onMessage,
        javaScriptEnabled: true,
        domStorageEnabled: true,
        startInLoadingState: true,
        originWhitelist: ['https://*'],
        allowsBackForwardNavigationGestures: true,
      }}
    />
  );
}

const themeStyles = (colors: any) => StyleSheet.create({
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
});
