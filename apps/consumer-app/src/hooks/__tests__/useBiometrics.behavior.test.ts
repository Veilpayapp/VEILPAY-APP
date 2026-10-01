/**
 * useBiometrics — behavior tests for availability + authenticate lanes.
 *
 * The hook is the security boundary for send/export/unlock authorization.
 * Drives expo-local-authentication through: hardware/enrolled matrix (both
 * platforms' label resolution), availability-check failure, authenticate
 * success / user-cancel / system-cancel / app-cancel / retryable failure /
 * thrown error, the early-return when biometrics are unavailable, and the
 * allowDeviceFallback (passcode) mode with its prompt options.
 */
import { renderHook, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

const mocks = {
  hasHardwareAsync: LocalAuthentication.hasHardwareAsync as jest.Mock,
  isEnrolledAsync: LocalAuthentication.isEnrolledAsync as jest.Mock,
  supportedAuthenticationTypesAsync: LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock,
  authenticateAsync: LocalAuthentication.authenticateAsync as jest.Mock,
};

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  authenticateAsync: jest.fn(),
  AuthenticationType: { FACIAL_RECOGNITION: 1, FINGERPRINT: 2, IRIS: 3 },
}));

import { useBiometrics } from '../useBiometrics';

const AT = (jest.requireMock('expo-local-authentication') as typeof LocalAuthentication)
  .AuthenticationType;

async function renderBiometrics() {
  const utils = renderHook(() => useBiometrics());
  // Flush the availability-check promise chain.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

describe('useBiometrics', () => {
  const realOS = Platform.OS;

  beforeEach(() => {
    setPlatform(realOS as 'ios' | 'android');
    mocks.hasHardwareAsync.mockReset().mockResolvedValue(true);
    mocks.isEnrolledAsync.mockReset().mockResolvedValue(true);
    mocks.supportedAuthenticationTypesAsync.mockReset().mockResolvedValue([AT.FINGERPRINT]);
    mocks.authenticateAsync.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    setPlatform(realOS as 'ios' | 'android');
  });

  describe('availability', () => {
    it('available when hardware present and enrolled; exposes primary type + label', async () => {
      mocks.supportedAuthenticationTypesAsync.mockResolvedValue([AT.FACIAL_RECOGNITION]);
      const { result } = await renderBiometrics();
      expect(result.current.isAvailable).toBe(true);
      expect(result.current.biometricType).toBe(AT.FACIAL_RECOGNITION);
      expect(result.current.biometricLabel).toBe(
        realOS === 'ios' ? 'Face ID' : 'Face Unlock'
      );
      expect(result.current.error).toBeNull();
    });

    it('unavailable when hardware reports no secure enclave', async () => {
      mocks.hasHardwareAsync.mockResolvedValue(false);
      const { result } = await renderBiometrics();
      expect(result.current.isAvailable).toBe(false);
    });

    it('unavailable when nothing is enrolled', async () => {
      mocks.isEnrolledAsync.mockResolvedValue(false);
      const { result } = await renderBiometrics();
      expect(result.current.isAvailable).toBe(false);
    });

    it('availability check throwing surfaces the failure error, stays unavailable', async () => {
      mocks.hasHardwareAsync.mockRejectedValue(new Error('boom'));
      const { result } = await renderBiometrics();
      expect(result.current.isAvailable).toBe(false);
      expect(result.current.error).toBe('Failed to check biometric availability');
    });

    it('empty supported types: biometricType null, generic label', async () => {
      mocks.supportedAuthenticationTypesAsync.mockResolvedValue([]);
      const { result } = await renderBiometrics();
      expect(result.current.biometricType).toBeNull();
      expect(result.current.biometricLabel).toBe('Biometrics');
    });

    it.each([
      ['ios', [AT.FINGERPRINT], 'Touch ID'],
      ['android', [AT.FINGERPRINT, AT.FACIAL_RECOGNITION], 'Biometric Unlock'],
      ['android', [AT.IRIS], 'Iris Scan'],
    ])('%s with %p → %s', async (os, types, label) => {
      setPlatform(os as 'ios' | 'android');
      mocks.supportedAuthenticationTypesAsync.mockResolvedValue(types as number[]);
      const { result } = await renderBiometrics();
      expect(result.current.biometricLabel).toBe(label);
    });
  });

  describe('authenticate', () => {
    it('fails closed (non-retryable) when biometrics are unavailable', async () => {
      mocks.hasHardwareAsync.mockResolvedValue(false);
      const { result } = await renderBiometrics();

      let outcome: Awaited<ReturnType<typeof result.current.authenticate>> | null = null;
      await act(async () => {
        outcome = await result.current.authenticate('send_payment');
      });
      expect(outcome).toEqual({
        success: false,
        cancelled: false,
        retryable: false,
        error: 'Biometric authentication is not available on this device',
      });
      expect(mocks.authenticateAsync).not.toHaveBeenCalled();
    });

    it('success: prompt uses the context message and secure options', async () => {
      const { result } = await renderBiometrics();
      await act(async () => {
        const outcome = await result.current.authenticate('export_key');
        expect(outcome).toEqual({ success: true, cancelled: false, retryable: false, error: null });
        expect(outcome!.success).toBe(true);
      });
      expect(mocks.authenticateAsync).toHaveBeenCalledWith({
        promptMessage: 'Authenticate to view your private key',
        fallbackLabel: '',
        cancelLabel: 'Cancel',
        disableDeviceFallback: true,
        requireConfirmation: true,
      });
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('defaults to app_unlock context', async () => {
      const { result } = await renderBiometrics();
      await act(async () => {
        await result.current.authenticate();
      });
      expect(mocks.authenticateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ promptMessage: 'Authenticate to access Veilpay' })
      );
    });

    it.each(['user_cancel', 'system_cancel', 'app_cancel'])(
      '%s is classified as cancelled (not retryable, gate stays lockable)',
      async (errorCode) => {
        mocks.authenticateAsync.mockResolvedValue({ success: false, error: errorCode });
        const { result } = await renderBiometrics();
        let outcome: Awaited<ReturnType<typeof result.current.authenticate>> | null = null;
        await act(async () => {
          outcome = await result.current.authenticate('send_payment');
        });
        expect(outcome!.cancelled).toBe(true);
        expect(outcome!.retryable).toBe(false);
        expect(outcome!.error).toBe(errorCode);
        expect(result.current.isAuthenticated).toBe(false);
      }
    );

    it('hardware failure is retryable and surfaces the raw error', async () => {
      mocks.authenticateAsync.mockResolvedValue({ success: false, error: 'lockout' });
      const { result } = await renderBiometrics();
      let outcome: Awaited<ReturnType<typeof result.current.authenticate>> | null = null;
      await act(async () => {
        outcome = await result.current.authenticate();
      });
      expect(outcome).toEqual({
        success: false,
        cancelled: false,
        retryable: true,
        error: 'lockout',
      });
      expect(result.current.error).toBe('Authentication failed');
    });

    it('authenticateAsync throwing returns a retryable result with the message', async () => {
      mocks.authenticateAsync.mockRejectedValue(new Error('sensor offline'));
      const { result } = await renderBiometrics();
      let outcome: Awaited<ReturnType<typeof result.current.authenticate>> | null = null;
      await act(async () => {
        outcome = await result.current.authenticate();
      });
      expect(outcome).toEqual({
        success: false,
        cancelled: false,
        retryable: true,
        error: 'sensor offline',
      });
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.error).toBe('sensor offline');
    });

    it('allowDeviceFallback proceeds when unavailable and unlocks the passcode option', async () => {
      mocks.hasHardwareAsync.mockResolvedValue(false);
      mocks.authenticateAsync.mockResolvedValue({ success: true });
      const { result } = await renderBiometrics();
      let outcome: Awaited<ReturnType<typeof result.current.authenticate>> | null = null;
      await act(async () => {
        outcome = await result.current.authenticate('app_unlock', true);
      });
      expect(outcome!.success).toBe(true);
      expect(mocks.authenticateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackLabel: 'Use Passcode',
          disableDeviceFallback: false,
        })
      );
    });
  });
});
