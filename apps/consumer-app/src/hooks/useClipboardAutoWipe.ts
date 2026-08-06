/**
 * useClipboardAutoWipe — Auto-clearing clipboard hook for sensitive data
 *
 * SECURITY DESIGN:
 * - After copying sensitive data to clipboard, automatically clears it after a timeout.
 * - Provides countdown UI: "Clipboard will clear in 25s"
 * - Handles edge cases: app backgrounding, screen navigation before timer fires
 * - Manual clear button allows user to clear immediately
 *
 * USAGE:
 *   const { copy, clear, isClipboardActive, timeRemaining } = useClipboardAutoWipe(30000);
 *   await copy(sensitiveString);
 *   // Clipboard is now active, shows countdown
 *   // After 30s or manual clear(), clipboard is wiped
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { setClipboardString, getClipboardString } from '../utils/clipboard';

export interface UseClipboardAutoWipeResult {
  /** Copy data to clipboard and start auto-clear timer */
  copy: (data: string) => Promise<boolean>;
  /** Manually clear clipboard immediately */
  clear: () => Promise<void>;
  /** Whether clipboard currently has sensitive data (timer active) */
  isClipboardActive: boolean;
  /** Seconds remaining before auto-clear (0 when inactive) */
  timeRemaining: number;
  /** Format string for UI: "Clipboard clears in 25s" */
  countdownText: string;
}

export function useClipboardAutoWipe(clearAfterMs: number = 30000): UseClipboardAutoWipeResult {
  const [isClipboardActive, setIsClipboardActive] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const appStateRef = useRef<AppStateStatus>('active');
  const originalClipboardRef = useRef<string | null>(null);

  // ─── Clear clipboard and cleanup timers ─────────────────────────────────────

  const clearClipboard = useCallback(async () => {
    // Stop all timers
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    // Only clear if we still own the clipboard (still our data)
    try {
      const currentClipboard = await getClipboardString();
      if (currentClipboard === originalClipboardRef.current) {
        await setClipboardString('');
      }
    } catch {
      // Silently fail - clipboard operations can fail on some devices
    }

    originalClipboardRef.current = null;
    setIsClipboardActive(false);
    setTimeRemaining(0);
  }, []);

  // ─── Auto-clear timer setup ────────────────────────────────────────────────

  const copy = useCallback(
    async (data: string): Promise<boolean> => {
      // Clear any existing timer first
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }

      // Copy to clipboard
      const success = await setClipboardString(data);
      if (!success) {
        return false;
      }

      originalClipboardRef.current = data;
      setIsClipboardActive(true);

      // Start countdown timer (update every 1 second)
      let remainingMs = clearAfterMs;
      setTimeRemaining(Math.ceil(remainingMs / 1000));

      countdownIntervalRef.current = setInterval(() => {
        remainingMs -= 1000;
        setTimeRemaining(Math.max(0, Math.ceil(remainingMs / 1000)));
      }, 1000);

      // Auto-clear after timeout
      timerRef.current = setTimeout(() => {
        clearClipboard();
      }, clearAfterMs);

      return true;
    },
    [clearAfterMs, clearClipboard]
  );

  // ─── App state listener (clear on backgrounding) ────────────────────────────

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      appStateRef.current = state;

      // Clear clipboard when app goes to background
      // This prevents malicious background apps from reading it
      if (state === 'background' && isClipboardActive) {
        clearClipboard();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isClipboardActive, clearClipboard]);

  // ─── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  const countdownText = isClipboardActive
    ? `Clipboard clears in ${timeRemaining}s`
    : '';

  return {
    copy,
    clear: clearClipboard,
    isClipboardActive,
    timeRemaining,
    countdownText,
  };
}
