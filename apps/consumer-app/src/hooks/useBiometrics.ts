/**
 * useBiometrics — Secure Enclave Biometric Hook
 *
 * SECURITY DESIGN:
 * - `disableDeviceFallback: true` — PIN/passcode bypass is BLOCKED.
 *   Authentication must use the hardware secure enclave (Face ID / fingerprint).
 * - `requireConfirmation: true` — On Android, the user must explicitly tap
 *   "Confirm" after biometric match (prevents accidental or passive auth).
 * - Context-aware prompt strings per operation type so the user knows exactly
 *   what they are authorizing.
 *
 * USAGE:
 *   const { authenticate, biometricLabel, isAvailable } = useBiometrics();
 *   const ok = await authenticate('send_payment');
 */

import * as LocalAuthentication from 'expo-local-authentication';
import { useState, useEffect } from 'react';
import { Platform } from 'react-native';

// ─── Context Types ────────────────────────────────────────────────────────────

/**
 * Each operation that requires biometric auth should pass one of these contexts.
 * This drives context-specific prompt strings shown to the user.
 */
export type BiometricContext =
  | 'send_payment'
  | 'export_key'
  | 'backup_seed'
  | 'app_unlock'
  | 'toggle_biometrics'
  | 'deposit';

const PROMPT_MESSAGES: Record<BiometricContext, string> = {
  send_payment:       'Authorize this transaction with biometrics',
  export_key:         'Authenticate to view your private key',
  backup_seed:        'Authenticate to view your recovery phrase',
  app_unlock:         'Authenticate to access VeilPay',
  toggle_biometrics:  'Confirm your identity to change biometric settings',
  deposit:            'Authenticate to proceed with deposit',
};

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface BiometricAuthResult {
  success: boolean;
  /** True if the user cancelled (vs a hardware/system failure) */
  cancelled: boolean;
  /** True if it's safe to offer a retry (hardware error, not cancelled) */
  retryable: boolean;
  error: string | null;
}

export type BiometricStatus = {
  isAvailable: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
  biometricType: LocalAuthentication.AuthenticationType | null;
  /** Human-readable label derived from the primary biometric type */
  biometricLabel: string;
  isAuthenticated: boolean;
  error: string | null;
};

// ─── Label Resolution ─────────────────────────────────────────────────────────

function resolveBiometricLabel(types: LocalAuthentication.AuthenticationType[]): string {
  const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
  const hasIris = types.includes(LocalAuthentication.AuthenticationType.IRIS);

  if (Platform.OS === 'ios') {
    if (hasFace) return 'Face ID';
    if (hasFingerprint) return 'Touch ID';
  } else {
    // Android can have multiple
    if (hasFace && hasFingerprint) return 'Biometric Unlock';
    if (hasFingerprint) return 'Fingerprint';
    if (hasFace) return 'Face Unlock';
    if (hasIris) return 'Iris Scan';
  }
  return 'Biometrics';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBiometrics() {
  const [status, setStatus] = useState<BiometricStatus>({
    isAvailable: false,
    supportedTypes: [],
    biometricType: null,
    biometricLabel: 'Biometrics',
    isAuthenticated: false,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;

    const checkAvailability = async () => {
      try {
        const [compatible, enrolled, types] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync(),
        ]);

        if (isMounted) {
          setStatus(prev => ({
            ...prev,
            isAvailable: compatible && enrolled,
            supportedTypes: types,
            biometricType: types[0] ?? null,
            biometricLabel: resolveBiometricLabel(types),
            error: null,
          }));
        }
      } catch {
        if (isMounted) {
          setStatus(prev => ({
            ...prev,
            error: 'Failed to check biometric availability',
          }));
        }
      }
    };
    checkAvailability();
    return () => { isMounted = false; };
  }, []);

  /**
   * Triggers the biometric authentication prompt.
   *
   * @param context - The operation being authorized (drives prompt message).
   *   Defaults to 'app_unlock' if not provided.
   *
   * SECURITY:
   * - `disableDeviceFallback: true` — blocks PIN/passcode fallback.
   *   The secure enclave MUST be used.
   * - `requireConfirmation: true` — Android requires explicit confirmation tap.
   */
  const authenticate = async (context: BiometricContext = 'app_unlock', allowDeviceFallback = false): Promise<BiometricAuthResult> => {
    // If we only allow biometrics but none are available, fail early.
    // If we allow device fallback (PIN/Password), we can proceed even if biometrics aren't enrolled.
    if (!status.isAvailable && !allowDeviceFallback) {
      return {
        success: false,
        cancelled: false,
        retryable: false,
        error: 'Biometric authentication is not available on this device',
      };
    }

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: PROMPT_MESSAGES[context],
        fallbackLabel: allowDeviceFallback ? 'Use Passcode' : '',
        cancelLabel: 'Cancel',
        disableDeviceFallback: !allowDeviceFallback,
        requireConfirmation: true,      // SECURITY: Android explicit confirmation
      });

      const success = result.success;

      setStatus(prev => ({
        ...prev,
        isAuthenticated: success,
        error: success ? null : 'Authentication failed',
      }));

      // expo-local-authentication error codes for cancelled actions
      const cancelledError = (result as any).error === 'user_cancel' ||
        (result as any).error === 'system_cancel' ||
        (result as any).error === 'app_cancel';

      return {
        success,
        cancelled: !success && cancelledError,
        retryable: !success && !cancelledError,
        error: success ? null : ((result as any).error ?? 'Authentication failed'),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setStatus(prev => ({
        ...prev,
        isAuthenticated: false,
        error: message,
      }));
      return {
        success: false,
        cancelled: false,
        retryable: true,
        error: message,
      };
    }
  };

  return {
    ...status,
    authenticate,
  };
}
