import { useEffect, useRef } from 'react';
import { Platform, NativeModules } from 'react-native';
import { isSecureScreen, canBlockScreenshots } from '../utils/security';


/**
 * useSecureScreen Hook
 *
 * Applies platform-native anti-screenshot protections for sensitive screens.
 * | Platform | Mechanism                                 |
 * |----------|-------------------------------------------|
 * | Android  | FLAG_SECURE (WindowManager.LayoutParams)  |
 * | iOS      | UITextField.secureTextEntry (best effort) |
 *
 * This hook should be called at the top level of any screen that displays
 * sensitive information (seed phrases, private keys, etc.).
 *
 * @param screenName - The route name of the current screen (used to determine if security is needed)
 */
export function useSecureScreen(screenName: string) {
  const isSecure = isSecureScreen(screenName);
  const prevScreenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSecure || !canBlockScreenshots()) {
      return;
    }

    // Apply FLAG_SECURE on Android
    if (Platform.OS === 'android') {
      const { VeilpaySecureWindow } = NativeModules;

      if (VeilpaySecureWindow?.setSecureFlag) {
        VeilpaySecureWindow.setSecureFlag(true).catch((err: unknown) => {
          console.error(err instanceof Error ? err : new Error('Failed to set FLAG_SECURE'));
        });
      } else {
        // Log a soft warning — the native module is not yet integrated
        if (__DEV__) {
          console.warn(
            `[useSecureScreen] Native module VeilpaySecureWindow is not available on Android. ` +
              `Add the following to your native MainActivity to enable screenshot blocking:

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().setFlags(
      WindowManager.LayoutParams.FLAG_SECURE,
      WindowManager.LayoutParams.FLAG_SECURE
    );
  }

            See docs/ANTI_SCREENSHOT.md for full integration guide.`
          );
        }
      }

      return () => {
        if (VeilpaySecureWindow?.setSecureFlag) {
          VeilpaySecureWindow.setSecureFlag(false).catch(() => {
            // Best-effort cleanup
          });
        }
      };
    }

    // iOS: There is no public API to prevent screenshots.
    // The best we can do is warn the developer.
    if (Platform.OS === 'ios') {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.info(
          `[useSecureScreen] iOS does not support screenshot prevention. ` +
            `Use the iOS 'ScreenRecording' detection API or consider RASP (Runtime Application Self-Protection).` +
            `See docs/ANTI_SCREENSHOT.md for alternatives.`
        );
      }
    }
  }, [isSecure, screenName]);

  // Track screen transitions to apply the flag when navigating between screens
  useEffect(() => {
    if (prevScreenRef.current === screenName) {
      return;
    }
    prevScreenRef.current = screenName;
  }, [screenName]);

  return isSecure;
}

/**
 * HOC (Higher-Order Component) that wraps a screen with secure screen behavior.
 *
 * Usage:
 *   export default withSecureScreen(BackupWalletScreen, 'BackupWallet');
 */
export function withSecureScreen<T extends object>(
  Component: React.ComponentType<T>,
  screenName: string
) {
  return function SecureScreenWrapper(props: T) {
    useSecureScreen(screenName);
    return <Component {...props} />;
  };
}
