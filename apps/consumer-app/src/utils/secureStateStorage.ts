import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';
import { captureError, captureMessage } from './sentry';

/**
 * Store names that contain sensitive data (wallet keys, mnemonics, etc.)
 * and must NEVER be persisted to AsyncStorage (plaintext) when SecureStore
 * is unavailable. If SecureStore fails for these stores, we refuse the
 * write rather than leak secrets to device-local plaintext storage.
 */
const SENSITIVE_STORE_NAMES = new Set([
  'veilpay-wallet-storage',
  // Add any future store names that hold secrets here
]);

type SecureStoreModule = typeof import('expo-secure-store');

let cachedSecureStoreModule: SecureStoreModule | null | undefined;
let warnedSecureStoreUnavailable = false;

function getSecureStoreModule(): SecureStoreModule | null {
  if (cachedSecureStoreModule !== undefined) {
    return cachedSecureStoreModule;
  }

  try {
    cachedSecureStoreModule = require('expo-secure-store') as SecureStoreModule;
  } catch {
    cachedSecureStoreModule = null;

    if (!warnedSecureStoreUnavailable) {
      warnedSecureStoreUnavailable = true;
      console.warn('[secureStateStorage] expo-secure-store unavailable, using AsyncStorage fallback.');
    }
  }

  return cachedSecureStoreModule;
}

function canUseSecureStore(
  secureStore: SecureStoreModule | null
): secureStore is SecureStoreModule {
  try {
    return Boolean(
      secureStore
      && typeof secureStore.setItemAsync === 'function'
      && typeof secureStore.getItemAsync === 'function'
      && typeof secureStore.deleteItemAsync === 'function'
    );
  } catch {
    return false;
  }
}

function getSecureStoreOptions(
  secureStore: SecureStoreModule
): Parameters<SecureStoreModule['setItemAsync']>[2] {
  return {
    keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, operationName: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`SecureStore operation '${operationName}' timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

function reportStorageError(operation: string, key: string, error: unknown) {
  const normalized = error instanceof Error ? error : new Error('Unknown secure storage error');
  captureError(normalized, {
    scope: 'secure-state-storage',
    operation,
    key,
  });
}

export const secureStateStorage: StateStorage = {
  getItem: async (name) => {
    const secureStore = getSecureStoreModule();

    if (canUseSecureStore(secureStore)) {
      try {
        const secureValue = await withTimeout(
          secureStore.getItemAsync(name, getSecureStoreOptions(secureStore)),
          3000,
          'getItem'
        );
        if (secureValue !== null) {
          return secureValue;
        }
      } catch (error) {
        reportStorageError('getItem', name, error);

        // If this is a sensitive store, refuse to fall back to plaintext
        if (SENSITIVE_STORE_NAMES.has(name)) {
          captureMessage(
            `[secureStateStorage] CRITICAL: SecureStore getItem failed for sensitive store "${name}". ` +
            'Refusing to read from AsyncStorage to prevent stale secret leakage.',
            'error',
          );
          return null;
        }

        // Non-sensitive state: fall back to AsyncStorage
        return AsyncStorage.getItem(name);
      }
    } else {
      // SecureStore entirely unavailable
      if (SENSITIVE_STORE_NAMES.has(name)) {
        captureMessage(
          `[secureStateStorage] CRITICAL: SecureStore unavailable for sensitive store "${name}". ` +
          'Refusing to read from AsyncStorage to prevent stale secret leakage.',
          'error',
        );
        return null;
      }

      console.warn('[secureStateStorage] SecureStore unavailable, using AsyncStorage for non-sensitive state.');
    }

    return AsyncStorage.getItem(name);
  },

  setItem: async (name, value) => {
    const secureStore = getSecureStoreModule();

    if (canUseSecureStore(secureStore)) {
      try {
        await withTimeout(
          secureStore.setItemAsync(name, value, getSecureStoreOptions(secureStore)),
          3000,
          'setItem'
        );
        return;
      } catch (error) {
        reportStorageError('setItem', name, error);

        // If this is a sensitive store, refuse to fall back to plaintext
        if (SENSITIVE_STORE_NAMES.has(name)) {
          captureMessage(
            `[secureStateStorage] CRITICAL: SecureStore setItem failed for sensitive store "${name}". ` +
            'Refusing to write to AsyncStorage to prevent secret leakage. State will be lost on app restart.',
            'error',
          );
          return;
        }

        // Non-sensitive state: fall back to AsyncStorage
        await AsyncStorage.setItem(name, value);
        return;
      }
    }

    // SecureStore entirely unavailable
    if (SENSITIVE_STORE_NAMES.has(name)) {
      captureMessage(
        `[secureStateStorage] CRITICAL: SecureStore unavailable for sensitive store "${name}". ` +
        'Refusing to write to AsyncStorage to prevent secret leakage. State will be lost on app restart.',
        'error',
      );
      return;
    }

    await AsyncStorage.setItem(name, value);
  },

  removeItem: async (name) => {
    const secureStore = getSecureStoreModule();

    if (canUseSecureStore(secureStore)) {
      try {
        await withTimeout(
          secureStore.deleteItemAsync(name, getSecureStoreOptions(secureStore)),
          3000,
          'deleteItem'
        );
        return;
      } catch (error) {
        reportStorageError('removeItem', name, error);
      }
    }

    await AsyncStorage.removeItem(name);
  },
};
