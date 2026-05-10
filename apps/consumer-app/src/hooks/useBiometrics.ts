import * as LocalAuthentication from 'expo-local-authentication';
import { useState, useEffect } from 'react';

export type BiometricStatus = {
  isAvailable: boolean;
  biometricType: LocalAuthentication.AuthenticationType | null;
  isAuthenticated: boolean;
  error: string | null;
};

export function useBiometrics() {
  const [status, setStatus] = useState<BiometricStatus>({
    isAvailable: false,
    biometricType: null,
    isAuthenticated: false,
    error: null,
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    checkAvailability().then((cleanupFn) => {
      cleanup = cleanupFn;
    });
    return () => {
      cleanup?.();
    };
  }, []);

  const checkAvailability = async () => {
    let isMounted = true;
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      
      if (isMounted) {
        setStatus(prev => ({
          ...prev,
          isAvailable: compatible && enrolled,
          biometricType: types[0] || null,
        }));
      }
    } catch (error) {
      if (isMounted) {
        setStatus(prev => ({
          ...prev,
          error: 'Failed to check biometric availability',
        }));
      }
    }
    return () => {
      isMounted = false;
    };
  };

  const authenticate = async (): Promise<boolean> => {
    if (!status.isAvailable) {
      return false;
    }

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to access your wallet',
        fallbackLabel: 'Use passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      setStatus(prev => ({
        ...prev,
        isAuthenticated: result.success,
      }));

      return result.success;
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        error: 'Authentication failed',
      }));
      return false;
    }
  };

  return {
    ...status,
    authenticate,
  };
}
