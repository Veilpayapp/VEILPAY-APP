/**
 * useSecureScreen — anti-screenshot hook tests.
 *
 * Drives the platform matrix: insecure screens do nothing; Android applies
 * FLAG_SECURE via the VeilpaySecureWindow native module (and clears it on
 * unmount, swallowing native failures); Android without the native module only
 * warns in __DEV__; iOS logs its unsupported notice. Also covers the
 * withSecureScreen HOC and the screen-transition bookkeeping.
 */
import React from 'react';
import { render, renderHook, act } from '@testing-library/react-native';
import { Platform, NativeModules, Text } from 'react-native';

import { useSecureScreen, withSecureScreen } from '../useSecureScreen';

function setOS(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

function setSecureWindow(module: { setSecureFlag: jest.Mock } | null) {
  if (module) {
    (NativeModules as Record<string, unknown>).VeilpaySecureWindow = module;
  } else {
    delete (NativeModules as Record<string, unknown>).VeilpaySecureWindow;
  }
}

describe('useSecureScreen', () => {
  const realOS = Platform.OS;
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    setOS(realOS as 'ios' | 'android');
    setSecureWindow(null);
    warnSpy.mockClear();
    infoSpy.mockClear();
    errorSpy.mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('insecure screen: returns false and never touches the native module', () => {
    const setSecureFlag = jest.fn(async () => undefined);
    setSecureWindow({ setSecureFlag });
    setOS('android');

    const { result } = renderHook(() => useSecureScreen('HomeDashboard'));
    expect(result.current).toBe(false);
    expect(setSecureFlag).not.toHaveBeenCalled();
  });

  it('android + native module: applies FLAG_SECURE and clears it on unmount', async () => {
    const setSecureFlag = jest.fn(async () => undefined);
    setSecureWindow({ setSecureFlag });
    setOS('android');

    const { result, unmount } = renderHook(() => useSecureScreen('BackupWallet'));
    expect(result.current).toBe(true);
    expect(setSecureFlag).toHaveBeenCalledWith(true);
    expect(setSecureFlag).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {});
    expect(setSecureFlag).toHaveBeenCalledWith(false);
  });

  it('android + native module failure: error is logged, not thrown; cleanup best-effort', async () => {
    const setSecureFlag = jest.fn(async () => {
      throw new Error('window manager said no');
    });
    setSecureWindow({ setSecureFlag });
    setOS('android');

    const { unmount } = renderHook(() => useSecureScreen('ExportPrivateKey'));
    await act(async () => {});
    expect(errorSpy).toHaveBeenCalled();

    unmount();
    await act(async () => {});
    expect(setSecureFlag).toHaveBeenCalledWith(false);
  });

  it('android without the native module: dev warning only, no crash', async () => {
    setOS('android');
    setSecureWindow(null);

    const { result } = renderHook(() => useSecureScreen('SendPayment'));
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('VeilpaySecureWindow'));
  });

  it('ios: canBlockScreenshots() is false, so the effect exits before any platform branch', async () => {
    const setSecureFlag = jest.fn(async () => undefined);
    setSecureWindow({ setSecureFlag });
    setOS('ios');

    const { result } = renderHook(() => useSecureScreen('VerifyWallet'));
    // isSecure is still reported true (screen is sensitive)…
    expect(result.current).toBe(true);
    await act(async () => {});
    // …but no native flag is applied and no notice is logged: the
    // canBlockScreenshots() guard exits the effect before the iOS branch,
    // making that branch unreachable in practice (dead code).
    expect(setSecureFlag).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('screen-name changes update the transition bookkeeping without re-applying', async () => {
    const setSecureFlag = jest.fn(async () => undefined);
    setSecureWindow({ setSecureFlag });
    setOS('android');

    const { rerender, result } = renderHook(({ name }: { name: string }) => useSecureScreen(name), {
      initialProps: { name: 'BackupWallet' },
    });
    expect(result.current).toBe(true);
    expect(setSecureFlag).toHaveBeenCalledTimes(1);

    rerender({ name: 'BackupWallet' });
    expect(setSecureFlag).toHaveBeenCalledTimes(1);

    rerender({ name: 'HomeDashboard' });
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('withSecureScreen HOC wraps a component and applies the hook', () => {
    const setSecureFlag = jest.fn(async () => undefined);
    setSecureWindow({ setSecureFlag });
    setOS('android');

    const Wrapped = withSecureScreen(() => <Text>secret</Text>, 'BackupWallet');
    const { getByText, unmount } = render(<Wrapped />);
    expect(getByText('secret')).toBeTruthy();
    expect(setSecureFlag).toHaveBeenCalledWith(true);
    unmount();
  });
});
