/* istanbul ignore file */
/**
 * TransakWebViewScreen
 *
 * Embeds the Transak widget in a full-screen in-app WebView.
 * This gives a far better UX than opening an external browser.
 *
 * KYC / Order event handling:
 *  Transak communicates via postMessage (JavaScript ??? React Native).
 *  We listen for every event and surface relevant ones to the user.
 *
 *  Full event reference: https://docs.transak.com/docs/events
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Platform,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { Icon } from '../components/Icon';
import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore, type TransakOrderStatus } from '../stores/transactionStore';
import { FiatGatewayWebViewShell } from '../features/fiat-gateway';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Nav = NativeStackNavigationProp<RootStackParamList, 'TransakWebView'>;
type Route = RouteProp<RootStackParamList, 'TransakWebView'>;

interface Props {
    navigation: Nav;
    route: Route;
}

/** Transak event types we care about */
type TransakEvent =
    | 'TRANSAK_WIDGET_INITIALISED'
    | 'TRANSAK_ORDER_CREATED'
    | 'TRANSAK_ORDER_PAYMENT_PROCESSING'
    | 'TRANSAK_ORDER_SUCCESSFUL'
    | 'TRANSAK_ORDER_FAILED'
    | 'TRANSAK_WIDGET_CLOSE'
    | 'TRANSAK_USER_KYC_FLOW_STARTS'
    | 'TRANSAK_USER_KYC_REJECTED'
    | 'TRANSAK_USER_KYC_VERIFIED';

type KycStatus = 'unknown' | 'pending' | 'verified' | 'rejected';

const TRANSAK_EVENT_SET = new Set<TransakEvent>([
    'TRANSAK_WIDGET_INITIALISED',
    'TRANSAK_ORDER_CREATED',
    'TRANSAK_ORDER_PAYMENT_PROCESSING',
    'TRANSAK_ORDER_SUCCESSFUL',
    'TRANSAK_ORDER_FAILED',
    'TRANSAK_WIDGET_CLOSE',
    'TRANSAK_USER_KYC_FLOW_STARTS',
    'TRANSAK_USER_KYC_REJECTED',
    'TRANSAK_USER_KYC_VERIFIED',
]);

function isTransakEvent(value: unknown): value is TransakEvent {
    return typeof value === 'string' && TRANSAK_EVENT_SET.has(value as TransakEvent);
}

interface OrderStatus {
    id?: string;
    status?: string;
    fiatAmount?: number;
    cryptoAmount?: number;
    fiatCurrency?: string;
    cryptoCurrency?: string;
}

function readOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ---------------------------------------------------------------------------
// Injected JS: relay postMessage events from Transak iframe to React Native
// ---------------------------------------------------------------------------
const INJECTED_JS = `
(function() {
  window.addEventListener('message', function(e) {
    if (e.data && typeof e.data === 'object' && e.data.event_id) {
      window.ReactNativeWebView.postMessage(JSON.stringify(e.data));
    }
  });
  true;
})();
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function TransakWebViewScreen({ navigation, route }: Props) {
    const { colors } = useTheme();
    const styles = useStyles(themeStyles);
    const { url, title = 'Buy / Sell Crypto', flow } = route.params;

    const webviewRef = useRef<WebView>(null);
    const overlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [kycStatus, setKycStatus] = useState<KycStatus>('unknown');
    const [orderStatus, setOrderStatus] = useState<OrderStatus>({});
    const [overlayMessage, setOverlayMessage] = useState<string | null>(null);
    useEffect(() => {
        return () => {
            if (overlayTimeoutRef.current) {
                clearTimeout(overlayTimeoutRef.current);
            }
        };
    }, []);

    const persistOrder = useCallback((nextOrder: OrderStatus & { status: TransakOrderStatus }) => {
        const walletAddress = useWalletStore.getState().address;

        if (!walletAddress) {
            return;
        }

        useTransactionStore.getState().setLatestTransakOrder({
            provider: 'transak',
            walletAddress,
            flow,
            status: nextOrder.status,
            orderId: nextOrder.id,
            fiatAmount: typeof nextOrder.fiatAmount === 'number' ? nextOrder.fiatAmount.toString() : undefined,
            cryptoAmount: typeof nextOrder.cryptoAmount === 'number' ? nextOrder.cryptoAmount.toString() : undefined,
            fiatCurrency: nextOrder.fiatCurrency,
            cryptoCurrency: nextOrder.cryptoCurrency,
            updatedAt: Date.now(),
        });
    }, [flow]);

    const applyOrderUpdate = useCallback((patch: Partial<OrderStatus> & { status: TransakOrderStatus }) => {
        setOrderStatus((prev) => {
            const nextOrder = { ...prev, ...patch, status: patch.status };
            persistOrder(nextOrder);
            return nextOrder;
        });
    }, [persistOrder]);

    /** Show an overlay banner for a short duration */
    const showBanner = useCallback((msg: string) => {
        if (overlayTimeoutRef.current) {
            clearTimeout(overlayTimeoutRef.current);
        }

        setOverlayMessage(msg);
        overlayTimeoutRef.current = setTimeout(() => {
            overlayTimeoutRef.current = null;
            setOverlayMessage(null);
        }, 4000);
    }, []);

    const flowLabel = flow === 'buy' ? 'BUY FLOW' : 'SELL FLOW';

    const kycStatusLabel = useMemo(() => {
        switch (kycStatus) {
            case 'pending':
                return 'KYC IN PROGRESS';
            case 'verified':
                return 'KYC VERIFIED';
            case 'rejected':
                return 'KYC REVIEW NEEDED';
            default:
                return 'KYC PENDING';
        }
    }, [kycStatus]);

    const orderPillLabel = useMemo(() => {
        if (!orderStatus.status) {
            return 'ORDER NOT STARTED';
        }

        switch (orderStatus.status) {
            case 'initiated':
                return 'ORDER INITIATED';
            case 'processing':
                return 'PAYMENT PROCESSING';
            case 'success':
                if (typeof orderStatus.cryptoAmount === 'number' && orderStatus.cryptoCurrency) {
                    return `${orderStatus.cryptoAmount.toFixed(4)} ${orderStatus.cryptoCurrency}`;
                }
                return 'ORDER COMPLETE';
            case 'failed':
                return 'ORDER FAILED';
            default:
                return 'ORDER UPDATE';
        }
    }, [orderStatus.cryptoAmount, orderStatus.cryptoCurrency, orderStatus.status]);

    const statusSummary = useMemo(() => {
        if (loadError) {
            return 'Unable to load the Transak widget.';
        }

        if (loading) {
            return 'Loading secure checkout...';
        }

        if (orderStatus.status === 'success') {
            return 'Order completed successfully.';
        }

        if (orderStatus.status === 'processing') {
            return 'Waiting for payment confirmation.';
        }

        if (orderStatus.status === 'initiated') {
            return 'Order created. Continue in Transak.';
        }

        return 'Complete verification and payment inside the embedded flow.';
    }, [loadError, loading, orderStatus.status]);

    /** Handle Transak postMessage events */
    const handleMessage = useCallback(
        (event: WebViewMessageEvent) => {
            try {
                const parsed = JSON.parse(event.nativeEvent.data) as {
                    event_id?: unknown;
                    data?: unknown;
                };

                if (!isTransakEvent(parsed.event_id)) {
                    return;
                }

                const payload =
                    parsed.data && typeof parsed.data === 'object'
                        ? (parsed.data as Record<string, unknown>)
                        : {};

                const eventId = parsed.event_id;

                switch (eventId) {
                    case 'TRANSAK_WIDGET_INITIALISED':
                        setLoading(false);
                        setLoadError(null);
                        break;

                    case 'TRANSAK_USER_KYC_FLOW_STARTS':
                        setKycStatus('pending');
                        showBanner('Identity verification started.');
                        break;

                    case 'TRANSAK_USER_KYC_VERIFIED':
                        setKycStatus('verified');
                        showBanner('Identity verified. You can complete your order.');
                        break;

                    case 'TRANSAK_USER_KYC_REJECTED':
                        setKycStatus('rejected');
                        showBanner('Identity verification failed. Please try again or contact support.');
                        break;

                    case 'TRANSAK_ORDER_CREATED':
                        applyOrderUpdate({
                            id: readOptionalString(payload.id),
                            status: 'initiated',
                            fiatAmount: readOptionalNumber(payload.fiatAmount),
                            fiatCurrency: readOptionalString(payload.fiatCurrency),
                            cryptoAmount: readOptionalNumber(payload.cryptoAmount),
                            cryptoCurrency: readOptionalString(payload.cryptoCurrencyCode),
                        });
                        showBanner('Order created. Payment is now being processed.');
                        break;

                    case 'TRANSAK_ORDER_PAYMENT_PROCESSING':
                        applyOrderUpdate({ status: 'processing' });
                        showBanner('Payment is being processed.');
                        break;

                    case 'TRANSAK_ORDER_SUCCESSFUL':
                        const successAmount = readOptionalNumber(payload.cryptoAmount);
                        const successCurrency = readOptionalString(payload.cryptoCurrencyCode);

                        applyOrderUpdate({
                            status: 'success',
                            cryptoAmount: successAmount,
                            cryptoCurrency: successCurrency,
                        });
                        showBanner(
                            successAmount !== undefined && successCurrency
                                ? `Order successful. ${successAmount} ${successCurrency} is on the way.`
                                : 'Order successful.'
                        );
                        break;

                    case 'TRANSAK_ORDER_FAILED':
                        applyOrderUpdate({ status: 'failed' });
                        showBanner('Order failed. No funds were deducted.');
                        break;

                    case 'TRANSAK_WIDGET_CLOSE':
                        navigation.goBack();
                        break;
                }
            } catch {
                // Ignore unrelated postMessages
            }
        },
        [applyOrderUpdate, navigation, showBanner]
    );

    const handleClose = useCallback(() => {
        navigation.goBack();
    }, [navigation]);

    const handleRetry = useCallback(() => {
        setLoadError(null);
        setLoading(true);
        webviewRef.current?.reload();
    }, []);

  const kycBadgeColor: Record<KycStatus, string> = {
    unknown: colors.textTertiary,
    pending: colors.accent,
    verified: colors.success,
    rejected: colors.error,
  };

    return (
        <Animated.View entering={FadeInDown.duration(400).springify().damping(18).stiffness(150)} style={{ flex: 1 }}>
        <FiatGatewayWebViewShell
            ref={webviewRef}
            onClose={handleClose}
            loading={loading}
            loadingMessage="Loading Transak..."
            headerCenter={
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle}>{title}</Text>
                    <Text style={styles.headerSubtitle}>{flowLabel} • {statusSummary}</Text>
                    <View style={[styles.kycBadge, { backgroundColor: kycBadgeColor[kycStatus] + '22', borderColor: kycBadgeColor[kycStatus] }]}>
                        <Text style={[styles.kycBadgeText, { color: kycBadgeColor[kycStatus] }]}>
                            {kycStatusLabel}
                        </Text>
                    </View>
                </View>
            }
            headerRight={
                orderStatus.status && orderStatus.status !== 'failed' ? (
                    <View style={styles.orderPill}>
                        <Text style={styles.orderPillText}>{orderPillLabel}</Text>
                    </View>
                ) : undefined
            }
            banner={overlayMessage ? (
                <View style={styles.banner}>
                    <Text style={styles.bannerText}>{overlayMessage}</Text>
                </View>
            ) : null}
            errorState={loadError ? (
                <View style={styles.errorState}>
                    <Icon name="close" size={28} color={colors.error} />
                    <Text style={styles.errorTitle}>Transak failed to load</Text>
                    <Text style={styles.errorText}>{loadError}</Text>
                    <View style={styles.errorActions}>
                        <TouchableOpacity
                            onPress={handleRetry}
                            style={styles.retryButton}
                            accessibilityRole="button"
                            accessibilityLabel="Retry loading Transak"
                        >
                            <Text style={styles.retryButtonText}>RETRY</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={handleClose}
                            style={styles.closeErrorButton}
                            accessibilityRole="button"
                            accessibilityLabel="Close Transak"
                        >
                            <Text style={styles.closeErrorButtonText}>CLOSE</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}
            webViewProps={{
                source: { uri: url },
                style: styles.webview,
                onLoadStart: () => {
                    setLoading(true);
                    setLoadError(null);
                },
                onLoadEnd: () => setLoading(false),
                onError: (event) => {
                    setLoading(false);
                    setLoadError(event.nativeEvent.description || 'Transak could not be loaded.');
                },
                onHttpError: (event) => {
                    setLoading(false);
                    setLoadError(`Transak returned HTTP ${event.nativeEvent.statusCode}.`);
                },
                onMessage: handleMessage,
                injectedJavaScript: INJECTED_JS,
                mediaPlaybackRequiresUserAction: false,
                allowsInlineMediaPlayback: true,
                mixedContentMode: 'compatibility',
                setSupportMultipleWindows: false,
                originWhitelist: ['https://global.transak.com', 'https://global-stg.transak.com'],
                javaScriptEnabled: true,
                domStorageEnabled: true,
                thirdPartyCookiesEnabled: true,
                userAgent:
                    Platform.OS === 'android'
                        ? 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91 Mobile Safari/537.36'
                        : undefined,
            }}
        />
        </Animated.View>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const themeStyles = (colors: any) => StyleSheet.create({
        headerCenter: {
                flex: 1,
                marginLeft: 8,
                alignItems: 'center',
        },
    headerTitle: {
        fontFamily: typography.fontFamily.mono,
        fontSize: 14,
        fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  headerSubtitle: {
    marginTop: 4,
    fontFamily: typography.fontFamily.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
  },
  kycBadge: {
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: 'transparent',
  },
    kycBadgeText: {
        fontFamily: typography.fontFamily.mono,
        fontSize: 9,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
  orderPill: {
    backgroundColor: colors.accentContainer,
    borderWidth: 0,
    borderColor: 'transparent',
    borderRadius: 0,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  orderPillText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    fontWeight: 'bold',
    color: colors.accent,
    letterSpacing: 0.5,
  },
  banner: {
    backgroundColor: colors.accentContainer,
    borderBottomWidth: 1,
    borderBottomColor: colors.accentMuted,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  bannerText: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    color: colors.accent,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surfaceScreen,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    color: colors.textSecondary,
    letterSpacing: 1,
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
    backgroundColor: colors.surfaceScreen,
  },
  errorTitle: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  errorText: {
    fontFamily: typography.fontFamily.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: 'center',
  },
    errorActions: {
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
  closeErrorButton: {
    minWidth: 96,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: colors.bgSecondary,
  },
  closeErrorButtonText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
    letterSpacing: 0.8,
  },
});

export default TransakWebViewScreen;
