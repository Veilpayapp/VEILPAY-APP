/**
 * Expo native module surface for Google Play Integrity.
 *
 * In a fully-linked release binary this loads the Kotlin implementation which
 * calls the Play Integrity API with a backend-issued nonce. Until the native
 * side is wired (see README — requires Play Console registration, the
 * com.google.android.play:integrity dependency, and app certificate setup),
 * requireNativeModule throws and this resolves to null. The attestation
 * service in the app treats a null module as "no attestation available" and
 * the backend then fail-closes the attested endpoints — which is the safe
 * direction during rollout.
 */

import { requireNativeModule } from 'expo-modules-core';

export type IntegrityNative = {
  /** Mint a Play Integrity token bound to `nonce`. */
  requestIntegrityToken(nonce: string): Promise<string>;
};

let _module: IntegrityNative | null = null;
try {
  _module = requireNativeModule<IntegrityNative>('IntegrityNative');
} catch {
  _module = null; // Expo Go / jest / native side not yet autolinked
}

export default _module;
