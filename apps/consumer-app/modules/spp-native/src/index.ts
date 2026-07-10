/**
 * Expo native module surface for SPP.
 *
 * In a dev-client / release binary with the module autolinked, this loads
 * the Kotlin/Swift implementation. In Expo Go or Jest, requireNativeModule
 * throws and callers fall back to the JS stub in sppNativeBridge.
 */

import { requireNativeModule } from 'expo-modules-core';

export type SppNativeCapabilities = {
  version: string;
  ping: boolean;
  poolOps: boolean;
  aspLeaf: boolean;
  backend: 'js-stub' | 'native';
};

export type SppNativeOpResult = {
  ok: boolean;
  code?: string;
  op?: string;
  message?: string;
  txHash?: string;
  leafDecimal?: string | null;
  notePublicKeyHex?: string;
  encryptionPublicKeyHex?: string;
  membershipBlindingHex?: string;
  leafHex?: string;
};

export type SppNativeExpoModule = {
  version(): string;
  ping(input?: string | null): string;
  capabilities(): SppNativeCapabilities;
  deposit(amount: string): SppNativeOpResult;
  transfer(amount: string, recipient: string): SppNativeOpResult;
  withdraw(amount: string, to: string): SppNativeOpResult;
  ensureAsp(): SppNativeOpResult;
  deriveKeys?(sigHex: string, network: string): SppNativeOpResult;
  poolReadiness?(): SppNativeOpResult;
  poolOpen?(configJson: string): SppNativeOpResult;
  poolClose?(): SppNativeOpResult;
};

let cached: SppNativeExpoModule | null | undefined;

/**
 * Returns the native module, or `null` when unavailable (Expo Go / web / tests).
 */
export function getSppNativeExpoModule(): SppNativeExpoModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule<SppNativeExpoModule>('SppNative');
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function isSppNativeExpoAvailable(): boolean {
  return getSppNativeExpoModule() !== null;
}

export default {
  getSppNativeExpoModule,
  isSppNativeExpoAvailable,
};
