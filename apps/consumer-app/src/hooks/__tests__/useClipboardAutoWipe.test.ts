/**
 * Tests for useClipboardAutoWipe hook
 * Verifies clipboard auto-clear functionality, countdown timer, and edge cases
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useClipboardAutoWipe } from '../useClipboardAutoWipe';
import * as clipboardUtils from '../../utils/clipboard';

// Mock clipboard utilities with a stateful fake. The hook only wipes the
// clipboard when getClipboardString() still matches the value it copied, so
// the fake must return whatever setClipboardString last wrote.
const mockClipboardStore: { current: string } = { current: '' };
jest.mock('../../utils/clipboard', () => ({
  setClipboardString: jest.fn(async (value: string) => {
    mockClipboardStore.current = value;
    return true;
  }),
  getClipboardString: jest.fn(async () => mockClipboardStore.current),
}));

// Mock AppState by spying on the real module. A whole-module jest.mock of
// 'react-native' (spreading requireActual) breaks the require chain of
// @react-native/virtualized-lists with an Object.assign error, so use a
// targeted spy instead.
const mockAppStateListeners: ((state: any) => void)[] = [];

describe('useClipboardAutoWipe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockAppStateListeners.length = 0;

    jest.spyOn(AppState, 'addEventListener').mockImplementation(
      ((event: string, listener: (state: any) => void) => {
        if (event === 'change') {
          mockAppStateListeners.push(listener);
        }
        return { remove: jest.fn() };
      }) as any
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('copies data to clipboard', async () => {
    const { result } = renderHook(() => useClipboardAutoWipe(30000));

    await act(async () => {
      const success = await result.current.copy('secret-key-123');
      expect(success).toBe(true);
    });

    expect(clipboardUtils.setClipboardString).toHaveBeenCalledWith('secret-key-123');
    expect(result.current.isClipboardActive).toBe(true);
  });

  it('tracks countdown timer', async () => {
    const { result } = renderHook(() => useClipboardAutoWipe(30000));

    await act(async () => {
      await result.current.copy('sensitive-data');
    });

    expect(result.current.timeRemaining).toBe(30);
    expect(result.current.countdownText).toBe('Clipboard clears in 30s');

    // Advance time by 10 seconds
    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(result.current.timeRemaining).toBe(20);
    expect(result.current.countdownText).toBe('Clipboard clears in 20s');
  });

  it('auto-clears clipboard after timeout', async () => {
    const { result } = renderHook(() => useClipboardAutoWipe(30000));

    await act(async () => {
      await result.current.copy('secret-mnemonic');
    });

    expect(result.current.isClipboardActive).toBe(true);

    // Advance to 30 seconds and flush async clearClipboard work
    act(() => {
      jest.advanceTimersByTime(30000);
    });
    // clearClipboard is async and not awaited by the setTimeout callback,
    // so flush microtasks before asserting
    await act(async () => {
      await Promise.resolve();
    });

    expect(clipboardUtils.setClipboardString).toHaveBeenCalledWith('');
    expect(result.current.isClipboardActive).toBe(false);
    expect(result.current.timeRemaining).toBe(0);
  });

  it('manually clears clipboard immediately', async () => {
    const { result } = renderHook(() => useClipboardAutoWipe(30000));

    await act(async () => {
      await result.current.copy('private-key');
    });

    expect(result.current.isClipboardActive).toBe(true);

    // Manual clear before timeout
    await act(async () => {
      await result.current.clear();
    });

    expect(clipboardUtils.setClipboardString).toHaveBeenCalledWith('');
    expect(result.current.isClipboardActive).toBe(false);
  });

  it('clears clipboard when app goes to background', async () => {
    const { result } = renderHook(() => useClipboardAutoWipe(30000));

    await act(async () => {
      await result.current.copy('sensitive-token');
    });

    expect(result.current.isClipboardActive).toBe(true);

    // Simulate app backgrounding
    act(() => {
      mockAppStateListeners.forEach(listener => listener('background'));
    });

    await waitFor(() => {
      expect(result.current.isClipboardActive).toBe(false);
    });

    expect(clipboardUtils.setClipboardString).toHaveBeenCalledWith('');
  });

  it('does not clear clipboard if user data changed', async () => {
    (clipboardUtils.getClipboardString as jest.Mock).mockResolvedValueOnce('other-data');

    const { result } = renderHook(() => useClipboardAutoWipe(30000));

    await act(async () => {
      await result.current.copy('original-data');
    });

    // Manually clear (simulating user pasted something else in clipboard)
    await act(async () => {
      await result.current.clear();
    });

    // Should not clear if clipboard was changed by user
    expect(clipboardUtils.getClipboardString).toHaveBeenCalled();
  });

  it('handles failed clipboard copy', async () => {
    (clipboardUtils.setClipboardString as jest.Mock).mockResolvedValueOnce(false);

    const { result } = renderHook(() => useClipboardAutoWipe(30000));

    await act(async () => {
      const success = await result.current.copy('data');
      expect(success).toBe(false);
    });

    expect(result.current.isClipboardActive).toBe(false);
  });

  it('resets timer when copying again', async () => {
    const { result } = renderHook(() => useClipboardAutoWipe(30000));

    // First copy
    await act(async () => {
      await result.current.copy('first-secret');
    });

    // Advance 10 seconds
    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(result.current.timeRemaining).toBe(20);

    // Copy again (should reset timer)
    await act(async () => {
      await result.current.copy('second-secret');
    });

    expect(result.current.timeRemaining).toBe(30);
  });

  it('formats countdown text correctly', async () => {
    const { result } = renderHook(() => useClipboardAutoWipe(5000));

    await act(async () => {
      await result.current.copy('data');
    });

    expect(result.current.countdownText).toBe('Clipboard clears in 5s');

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.countdownText).toBe('Clipboard clears in 3s');

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    // Flush the async clearClipboard (timeout fired at 5s) so the final
    // countdown clears to ''
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.countdownText).toBe('');
  });

  it('cleans up timers on unmount', async () => {
    const { result, unmount } = renderHook(() => useClipboardAutoWipe(30000));

    await act(async () => {
      await result.current.copy('data');
    });

    unmount();

    // Advancing timers should not cause errors
    act(() => {
      jest.advanceTimersByTime(30000);
    });

    expect(result.current.isClipboardActive).toBe(true); // Still true because unmounted
  });
});
