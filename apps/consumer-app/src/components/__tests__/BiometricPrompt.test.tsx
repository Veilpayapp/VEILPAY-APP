/**
 * BiometricPrompt — decision-lane tests (device-free).
 *
 * The prompt is the app-unlock / send-payment authorization gate. These tests
 * drive every outcome lane of `triggerAuth` through a mocked `useBiometrics`:
 * success, user/system cancel, retryable failure, hard-unavailable failure
 * (auto-disable signal for callers), and non-biometric failure (onFail).
 * The not-available UI (with its CONTINUE → onCancel('unavailable') button)
 * and the subtitle variants per biometricType are covered as well.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockAuthState = {
  isAvailable: true,
  biometricLabel: 'Face ID',
  biometricType: 2,
  authenticate: jest.fn(),
};

jest.mock('../../hooks/useBiometrics', () => ({
  useBiometrics: () => mockAuthState,
}));

import { BiometricPrompt } from '../BiometricPrompt';

function resetAuth(overrides: Partial<typeof mockAuthState> = {}) {
  mockAuthState.isAvailable = true;
  mockAuthState.biometricLabel = 'Face ID';
  mockAuthState.biometricType = 2;
  mockAuthState.authenticate.mockReset();
  Object.assign(mockAuthState, overrides);
}

async function renderPrompt(props: Partial<React.ComponentProps<typeof BiometricPrompt>> = {}) {
  const onSuccess = jest.fn();
  const onCancel = jest.fn();
  const onFail = jest.fn();
  const utils = render(
    <BiometricPrompt onSuccess={onSuccess} onCancel={onCancel} onFail={onFail} {...props} />
  );
  // Flush the async authenticate() resolution + triggerAuth continuation.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { ...utils, onSuccess, onCancel, onFail };
}

describe('BiometricPrompt', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('auto-triggers auth once available and reports success', async () => {
    resetAuth({ authenticate: jest.fn(async () => ({ success: true })) });
    const { onSuccess, onCancel, onFail } = await renderPrompt();
    expect(mockAuthState.authenticate).toHaveBeenCalledWith('app_unlock');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });

  it('forwards the context to authenticate', async () => {
    resetAuth({ authenticate: jest.fn(async () => ({ success: true })) });
    await renderPrompt({ context: 'send_payment' });
    expect(mockAuthState.authenticate).toHaveBeenCalledWith('send_payment');
  });

  it('user cancel → cancelled UI; AUTHENTICATE retries and succeeds', async () => {
    resetAuth({
      authenticate: jest.fn(async () => ({
        success: false,
        cancelled: true,
        retryable: false,
        error: 'user_cancel',
      })),
    });
    const { getByText, onSuccess } = await renderPrompt();
    expect(getByText('AUTHENTICATION CANCELLED')).toBeTruthy();

    // Retry lane: second auth succeeds → onSuccess (gate re-arms).
    mockAuthState.authenticate.mockResolvedValueOnce({ success: true, cancelled: false, retryable: false, error: null });
    fireEvent.press(getByText('AUTHENTICATE'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('user cancel → CANCEL button emits user_cancel so callers stay locked', async () => {
    resetAuth({
      authenticate: jest.fn(async () => ({
        success: false,
        cancelled: true,
        retryable: false,
        error: 'user_cancel',
      })),
    });
    const { getByText, onCancel, onSuccess } = await renderPrompt();
    fireEvent.press(getByText('CANCEL'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onCancel).toHaveBeenCalledWith('user_cancel');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('retryable failure → failed UI with TRY AGAIN', async () => {
    resetAuth({
      authenticate: jest.fn(async () => ({
        success: false,
        cancelled: false,
        retryable: true,
        error: 'hardware error',
      })),
    });
    const { getByText, onFail, onCancel } = await renderPrompt();
    expect(getByText('AUTHENTICATION FAILED')).toBeTruthy();
    // Retryable failure must NOT auto-disable the gate nor call onFail.
    expect(onFail).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    mockAuthState.authenticate.mockResolvedValueOnce({ success: true, cancelled: false, retryable: false, error: null });
    fireEvent.press(getByText('TRY AGAIN'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onFail).not.toHaveBeenCalled();
  });

  it.each([
    ['not_enrolled', 'not_enrolled'],
    ['not available on this device', 'unavailable'],
    ['hardware UNAVAILABLE', 'unavailable'],
  ])('hard failure with %j error → onCancel("unavailable")', async (error) => {
    resetAuth({
      authenticate: jest.fn(async () => ({
        success: false,
        cancelled: false,
        retryable: false,
        error,
      })),
    });
    const { onCancel, onFail } = await renderPrompt();
    expect(onCancel).toHaveBeenCalledWith('unavailable');
    expect(onFail).not.toHaveBeenCalled();
  });

  it('hard failure with a non-availability error → onFail (not auto-disable)', async () => {
    resetAuth({
      authenticate: jest.fn(async () => ({
        success: false,
        cancelled: false,
        retryable: false,
        error: 'lockout',
      })),
    });
    const { onFail, onCancel } = await renderPrompt();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('not available → unavailable UI; CONTINUE emits unavailable; no CONTINUE without onCancel', async () => {
    resetAuth({ isAvailable: false });
    const { getByText, queryByText, onCancel } = await renderPrompt();
    expect(getByText('BIOMETRICS UNAVAILABLE')).toBeTruthy();
    fireEvent.press(getByText('CONTINUE'));
    expect(onCancel).toHaveBeenCalledWith('unavailable');

    const { queryByText: q2 } = await renderPrompt({ onCancel: undefined });
    expect(q2('CONTINUE')).toBeNull();
  });

  it('prompting subtitle varies by biometricLabel / biometricType', async () => {
    resetAuth({
      // Never resolves → stays in 'prompting' phase.
      authenticate: jest.fn(() => new Promise(() => {})),
      biometricLabel: 'Biometric Unlock',
    });
    const { getByText, rerender } = await renderPrompt();
    expect(getByText('BIOMETRIC UNLOCK REQUIRED')).toBeTruthy();
    expect(getByText('Verify your identity to continue')).toBeTruthy();

    resetAuth({
      authenticate: jest.fn(() => new Promise(() => {})),
      biometricLabel: 'Face ID',
      biometricType: 2,
    });
    rerender(
      <BiometricPrompt onSuccess={jest.fn()} onCancel={jest.fn()} onFail={jest.fn()} />
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getByText('Look at your device to authenticate')).toBeTruthy();

    resetAuth({
      authenticate: jest.fn(() => new Promise(() => {})),
      biometricLabel: 'Fingerprint',
      biometricType: 1,
    });
    rerender(
      <BiometricPrompt onSuccess={jest.fn()} onCancel={jest.fn()} onFail={jest.fn()} />
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getByText('Place your finger on the sensor')).toBeTruthy();

    resetAuth({
      authenticate: jest.fn(() => new Promise(() => {})),
      biometricLabel: 'Iris Scan',
      biometricType: 3,
    });
    rerender(
      <BiometricPrompt onSuccess={jest.fn()} onCancel={jest.fn()} onFail={jest.fn()} />
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getByText('Verify your identity to continue')).toBeTruthy();
  });
});
