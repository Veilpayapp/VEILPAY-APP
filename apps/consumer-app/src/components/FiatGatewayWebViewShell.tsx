import React, { forwardRef } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useStyles, typography } from '../styles/design-tokens';
import { ScreenBackButton } from './ScreenBackButton';

interface FiatGatewayWebViewShellProps {
  onClose: () => void;
  headerCenter: React.ReactNode;
  headerRight?: React.ReactNode;
  banner?: React.ReactNode;
  errorState?: React.ReactNode;
  loading: boolean;
  loadingMessage: string;
  webViewProps: WebViewProps;
}

export const FiatGatewayWebViewShell = forwardRef<WebView, FiatGatewayWebViewShellProps>(
  function FiatGatewayWebViewShell(
    { onClose, headerCenter, headerRight, banner, errorState, loading, loadingMessage, webViewProps },
    ref
  ) {
    const { colors } = useTheme();
    const styles = useStyles(themeStyles);

    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={colors.surfaceScreen} />

        <View style={styles.header}>
          <ScreenBackButton onPress={onClose} />
          <View style={styles.headerCenter}>{headerCenter}</View>
          <View style={styles.headerRight}>{headerRight ?? <View style={styles.headerSpacer} />}</View>
        </View>

        {banner}

        <View style={styles.content}>
          {errorState ? (
            errorState
          ) : (
            <WebView
              ref={ref}
              {...webViewProps}
              style={[styles.webView, webViewProps.style]}
            />
          )}

          {loading && (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loaderText}>{loadingMessage}</Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }
);

const themeStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineSubtle,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: {
    alignItems: 'flex-end',
    minWidth: 44,
  },
  headerSpacer: {
    width: 44,
  },
  content: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loaderContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surfaceScreen,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loaderText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 12,
    color: colors.textSecondary,
  },
});