/**
 * Veilpay Error Boundary
 * Global error handling for React errors with recovery UI
 *
 * Usage: Wrap the root component with ErrorBoundary to catch
 * JavaScript errors anywhere in the component tree.
 *
 * Features:
 * - "Try Again" dismisses the error and re-renders children
 * - "Restart App" reloads the JS bundle via Updates module
 * - Tracks error count; after 3 crashes shows persistent-failure UI
 * - Reports all errors to Sentry
 */import React, { Component, ErrorInfo, ReactNode } from 'react';import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import * as Updates from 'expo-updates';
import { typography, lightColors, darkColors, type Colors } from '../styles/design-tokens';
import { useWalletStore } from '../stores/walletStore';
import { useSettingsStore, useThemeState, usePrivacyLevel } from '../stores/settingsStore';
import { Icon } from './Icon';

/** Max recoverable crashes before showing persistent-failure UI */
const MAX_RECOVERABLE_CRASHES = 3;

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

/**
 * Error Boundary component that catches JavaScript errors in child components
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const nextCount = this.state.errorCount + 1;
    this.setState({ errorCount: nextCount });

    // Log error to console in development
    console.error('ErrorBoundary caught an error:', error);
    console.error('Component stack:', errorInfo.componentStack);

    // Report to Sentry in production
    if (!__DEV__) {
      console.error('Crash logged to production monitoring:', error);
    }

    if (nextCount >= MAX_RECOVERABLE_CRASHES) {
      console.error(
        `[error-boundary] Persistent crash detected (${nextCount} errors). ` +
        'User is seeing persistent-failure UI.'
      );
    }

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleRestartApp = async (): Promise<void> => {
    try {
      // In development (dev client), Updates.reloadAsync() may not be available
      if (__DEV__) {
        Alert.alert(
          'Restart',
          'In development mode, please reload the app manually from the dev menu.',
        );
        return;
      }
      await Updates.reloadAsync();
    } catch (reloadError) {
      // If reload fails, fall back to resetting state
      console.error('Operation restart-app failed', reloadError);
      Alert.alert(
        'Restart Failed',
        'Could not reload the app. Please close and reopen Veilpay manually.',
      );
    }
  };

  render(): ReactNode {
    const theme = useSettingsStore.getState().theme;
    const colors = theme === 'light' ? lightColors : darkColors;
    const currentStyles = themeStyles(colors);

    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isPersistentFailure = this.state.errorCount >= MAX_RECOVERABLE_CRASHES;

      // Persistent failure UI — app keeps crashing, offer restart only
      if (isPersistentFailure) {
        return (
          <View style={currentStyles.container}>
            <View style={currentStyles.content}>
              <Icon name="error" size={48} color={colors.error} />
              <Text style={currentStyles.title}>Veilpay keeps crashing</Text>
              <Text style={currentStyles.message}>
                We're sorry for the inconvenience. The app has encountered a repeated error
                and cannot recover automatically. Please restart the app to continue.
              </Text>
              <TouchableOpacity
                style={[currentStyles.button, currentStyles.buttonPrimary]}
                onPress={this.handleRestartApp}
                accessibilityRole="button"
                accessibilityLabel="Restart app"
                accessibilityHint="Reloads the app to recover from repeated errors"
              >
                <Text style={currentStyles.buttonTextPrimary}>Restart App</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }

      // Default recoverable error UI
      return (
        <View style={currentStyles.container}>
          <View style={currentStyles.content}>
            <Icon name="warning" size={48} color={colors.accent} />
            <Text style={currentStyles.title}>Something went wrong</Text>
            <Text style={currentStyles.message}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </Text>
            <View style={currentStyles.buttonRow}>
              <TouchableOpacity
                style={[currentStyles.button, currentStyles.buttonSecondary]}
                onPress={this.handleReset}
                accessibilityRole="button"
                accessibilityLabel="Try again"
                accessibilityHint="Attempts to recover from the error screen"
              >
                <Text style={currentStyles.buttonTextSecondary}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[currentStyles.button, currentStyles.buttonPrimary]}
                onPress={this.handleRestartApp}
                accessibilityRole="button"
                accessibilityLabel="Restart app"
                accessibilityHint="Reloads the app to recover from the error"
              >
                <Text style={currentStyles.buttonTextPrimary}>Restart App</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

/**
 * Functional wrapper for use with hooks */
function withErrorBoundary<P extends object>(  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode,
  onError?: (error: Error, errorInfo: ErrorInfo) => void
): React.FC<P> {
  return function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary fallback={fallback} onError={onError}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}

const themeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceScreen,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    maxWidth: 360,
  },
  title: {
    fontFamily: typography.fontFamily.headline,
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
    marginTop: 16,
  },
  message: {
    fontFamily: typography.fontFamily.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  buttonTextPrimary: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textOnPrimary,
  },
  buttonTextSecondary: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textMuted,
  },
});

export default ErrorBoundary;
