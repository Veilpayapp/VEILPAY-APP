/**
 * Shared BIP39 mnemonic→seed derivation for the consumer app.
 *
 * The seed is PBKDF2-HMAC-SHA512(passphrase = normalized mnemonic phrase,
 * salt = "mnemonic", 2048 iterations, 64 bytes). This is the exact BIP39
 * definition, so the output here is byte-identical to `@scure/bip39`'s
 * `mnemonicToSeed` — wiring the native path cannot change derived keys.
 *
 * Why native-first: the pure-JS implementation runs PBKDF2 on the JS thread
 * and blocks the UI for ~1.5s per derivation. The native Expo module
 * (`SppNative.mnemonicToSeed`) runs the same PBKDF2 on a background thread
 * and completes in ~10-50ms, without freezing the JS thread.
 *
 * Fallback: when the native module is unavailable (Expo Go, web, Jest), the
 * caller transparently falls back to `@scure/bip39`, preserving behaviour in
 * every environment. A per-session cache avoids redundant derivations.
 */

import { mnemonicToSeed } from '@scure/bip39';
import { Buffer } from 'buffer';
import { sppNativeMnemonicToSeed } from './stellarSpp/sppNativeBridge';

let cachedPhrase: string | null = null;
let cachedSeed: Uint8Array | null = null;

/**
 * Derive the 64-byte BIP39 seed for a mnemonic phrase.
 *
 * Preference order: session cache → native background-thread PBKDF2 → JS.
 * Returns a 64-byte Uint8Array regardless of which path produced it.
 */
export async function deriveMnemonicSeed(mnemonicPhrase: string): Promise<Uint8Array> {
  if (cachedPhrase === mnemonicPhrase && cachedSeed) {
    return cachedSeed;
  }

  const nativeHex = await sppNativeMnemonicToSeed(mnemonicPhrase);
  let seed: Uint8Array;
  if (nativeHex) {
    seed = Buffer.from(nativeHex, 'hex');
  } else {
    seed = new Uint8Array(await mnemonicToSeed(mnemonicPhrase));
  }

  cachedPhrase = mnemonicPhrase;
  cachedSeed = seed;
  return seed;
}

/**
 * Returns the session-cached seed for the phrase, or null if not yet derived
 * this session. Read-only — does not trigger a derivation.
 */
export function getCachedSeed(mnemonicPhrase: string): Uint8Array | null {
  return cachedPhrase === mnemonicPhrase ? cachedSeed : null;
}

export default { deriveMnemonicSeed, getCachedSeed };
