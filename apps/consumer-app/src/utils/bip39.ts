/**
* BIP-39 Mnemonic Generation Utility
*
* Provides cryptographically secure mnemonic phrase generation
* using the standard BIP-39 English wordlist (2048 words).
*
* @see https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
*
* PLATFORM SUPPORT:
* - Android/iOS: Uses expo-crypto for secure random generation
* - Web: Uses browser's native crypto.getRandomValues API
*/

/**
 * BIP-39 English wordlist (2048 words)
 * This is the standard wordlist defined in BIP-39 specification.
 * Each word can be uniquely identified by its first 4 characters.
 */
import { getRandomBytesAsync as expoGetRandomBytesAsync } from 'expo-crypto';
import { HDNodeWallet, Mnemonic, wordlists } from 'ethers';

export const BIP39_WORDLIST: readonly string[] = Array.from({ length: 2048 }, (_, index) =>
  wordlists.en.getWord(index)
);

const BIP39_WORD_INDEX = new Map<string, number>(
  BIP39_WORDLIST.map((word, index) => [word, index])
);

/**
* Generates cryptographically secure random bytes.
* Uses expo-crypto which works on Android, iOS, and Web.
*
* @param length - Number of bytes to generate
* @returns Promise resolving to Uint8Array of random bytes
*/
async function getSecureRandomBytesAsync(length: number): Promise<Uint8Array> {
  // Primary method: Use expo-crypto (works on all platforms)
  try {
    if (expoGetRandomBytesAsync) {
      const randomBytes = await expoGetRandomBytesAsync(length);
      return new Uint8Array(randomBytes);
    }
  } catch (error) {
    console.log('[bip39] expo-crypto not available:', error);
  }

// Fallback for web browsers (when expo-crypto is not available)
// We need to check if we're in a real browser environment
if (typeof window !== 'undefined') {
const win = window as any;
  
// Check for native browser crypto with subtle API
// This indicates a real browser, not a React Native polyfill
if (win.crypto && win.crypto.subtle && win.crypto.getRandomValues) {
const bytes = new Uint8Array(length);
win.crypto.getRandomValues(bytes);
return bytes;
}

// Last resort for web: Use crypto.subtle to generate random bytes
// This is async but works in browsers
if (win.crypto && win.crypto.subtle) {
try {
// Generate random bytes using subtle crypto
const array = new Uint8Array(length);
// Use getRandomValues if available (should be in browsers)
if (typeof win.crypto.getRandomValues === 'function') {
// Try to call it directly - might fail if polyfilled
win.crypto.getRandomValues(array);
return array;
}
} catch {
// subtle crypto failed
}
}
}

throw new Error(
'No secure random number generator available. ' +
'To test this app, run on an Android device/emulator: npx expo run:android'
);
}

/**
* Synchronous version for cases where async is not possible.
* Uses the global crypto object if available.
*
* @param length - Number of bytes to generate
* @returns Uint8Array of random bytes
*/
function getSecureRandomBytes(length: number): Uint8Array {
const bytes = new Uint8Array(length);
  
// Try window.crypto (browser)
if (typeof window !== 'undefined') {
const winCrypto = (window as any).crypto;
if (winCrypto && winCrypto.getRandomValues) {
winCrypto.getRandomValues(bytes);
return bytes;
}
}
  
// Try globalThis.crypto (modern environments)
if (typeof globalThis !== 'undefined') {
const gCrypto = (globalThis as any).crypto;
if (gCrypto && gCrypto.getRandomValues) {
gCrypto.getRandomValues(bytes);
return bytes;
}
}
  
// Try self.crypto (Web Workers)
if (typeof self !== 'undefined') {
const sCrypto = (self as any).crypto;
if (sCrypto && sCrypto.getRandomValues) {
sCrypto.getRandomValues(bytes);
return bytes;
}
}
  
// Last resort: throw error - we don't want to use Math.random for crypto
throw new Error('No secure random number generator available. Use getSecureRandomBytesAsync() instead.');
}

/**
 * Converts a byte array to a binary string representation
 * 
 * @param bytes - Uint8Array to convert
 * @returns Binary string representation
 */
function bytesToBinary(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(2).padStart(8, '0'))
    .join('');
}

function hexToBinary(hex: string): string {
  return hex
    .split('')
    .map((char) => parseInt(char, 16).toString(2).padStart(4, '0'))
    .join('');
}

function binaryToBytes(binary: string): Uint8Array {
  const byteCount = Math.floor(binary.length / 8);
  const bytes = new Uint8Array(byteCount);

  for (let i = 0; i < byteCount; i += 1) {
    bytes[i] = parseInt(binary.slice(i * 8, (i + 1) * 8), 2);
  }

  return bytes;
}

/**
* Pure JavaScript SHA-256 implementation for React Native compatibility
* React Native doesn't support crypto.subtle.digest, so we use a
* pure JavaScript implementation that works in all environments.
*
* @param data - Data to hash
* @returns Promise resolving to the hash as a hex string
*/
async function sha256(data: Uint8Array): Promise<string> {
 // Use pure JavaScript SHA-256 implementation
 return sha256PureJs(data);
}

/**
* Pure JavaScript SHA-256 implementation
* Based on the FIPS 180-4 standard
*/
function sha256PureJs(data: Uint8Array): string {
 // Initial hash values (first 32 bits of the fractional parts of the square roots of the first 8 primes)
 const H = new Uint32Array([
   0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
   0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
 ]);

 // Round constants (first 32 bits of the fractional parts of the cube roots of the first 64 primes)
 const K = new Uint32Array([
   0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
   0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
   0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
   0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
   0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
   0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
   0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
   0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
 ]);

 // Helper functions
 const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
 const ch = (x: number, y: number, z: number) => (x & y) ^ (~x & z);
 const maj = (x: number, y: number, z: number) => (x & y) ^ (x & z) ^ (y & z);
 const ep0 = (x: number) => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
 const ep1 = (x: number) => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
 const sig0 = (x: number) => rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
 const sig1 = (x: number) => rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);

 // Pad the message
 const bitLen = data.length * 8;
 const padding = (64 - ((data.length + 9) % 64)) % 64;
 const paddedLen = data.length + 1 + padding + 8;
 const padded = new Uint8Array(paddedLen);
 padded.set(data);
 padded[data.length] = 0x80;
 // Append length in bits as 64-bit big-endian
 const view = new DataView(padded.buffer);
 view.setUint32(paddedLen - 4, bitLen, false);

 // Process each 64-byte chunk
 const W = new Uint32Array(64);
 for (let i = 0; i < paddedLen; i += 64) {
   // Prepare message schedule
   for (let t = 0; t < 16; t++) {
     W[t] = (padded[i + t * 4] << 24) | (padded[i + t * 4 + 1] << 16) |
            (padded[i + t * 4 + 2] << 8) | padded[i + t * 4 + 3];
   }
   for (let t = 16; t < 64; t++) {
     W[t] = (sig1(W[t - 2]) + W[t - 7] + sig0(W[t - 15]) + W[t - 16]) >>> 0;
   }

   // Initialize working variables
   let [a, b, c, d, e, f, g, h] = [H[0], H[1], H[2], H[3], H[4], H[5], H[6], H[7]];

   // Main loop
   for (let t = 0; t < 64; t++) {
     const T1 = (h + ep1(e) + ch(e, f, g) + K[t] + W[t]) >>> 0;
     const T2 = (ep0(a) + maj(a, b, c)) >>> 0;
     h = g;
     g = f;
     f = e;
     e = (d + T1) >>> 0;
     d = c;
     c = b;
     b = a;
     a = (T1 + T2) >>> 0;
   }

   // Add compressed chunk to current hash value
   H[0] = (H[0] + a) >>> 0;
   H[1] = (H[1] + b) >>> 0;
   H[2] = (H[2] + c) >>> 0;
   H[3] = (H[3] + d) >>> 0;
   H[4] = (H[4] + e) >>> 0;
   H[5] = (H[5] + f) >>> 0;
   H[6] = (H[6] + g) >>> 0;
   H[7] = (H[7] + h) >>> 0;
 }

 // Convert to hex string
 return Array.from(H)
   .map(h => h.toString(16).padStart(8, '0'))
   .join('');
}

/**
 * Generates a BIP-39 compliant mnemonic phrase
 * 
 * This function:
 * 1. Generates cryptographically secure random entropy
 * 2. Computes a SHA-256 checksum of the entropy
 * 3. Appends the appropriate checksum bits
 * 4. Maps the resulting bits to words from the BIP-39 wordlist
 * 
 * For 12 words: 128 bits entropy + 4 bits checksum = 132 bits total
 * Each word represents 11 bits (2^11 = 2048 words)
 * 132 bits / 11 bits per word = 12 words
 * 
 * @param wordCount - Number of words to generate (12 or 24). Defaults to 12.
 * @returns Promise resolving to array of mnemonic words
 * @throws Error if wordCount is not 12 or 24
 */
export async function generateMnemonic(wordCount: 12 | 24 = 12): Promise<string[]> {
  try {
    if (wordCount !== 12 && wordCount !== 24) {
      throw new Error('Invalid word count: must be 12 or 24');
    }

    const entropyBytes = wordCount === 12 ? 16 : 32;

    let entropy: Uint8Array;
    try {
      entropy = await getSecureRandomBytesAsync(entropyBytes);
    } catch (error) {
      console.error('[bip39] Failed to generate random bytes:', error);
      throw new Error(
        `Failed to generate secure random bytes: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const phrase = Mnemonic.fromEntropy(entropy).phrase;
    const words = phrase.trim().split(/\s+/);

    if (words.length !== wordCount) {
      throw new Error(`Generated ${words.length} words, expected ${wordCount}`);
    }

    return words;
  } catch (error) {
    console.error('[bip39] generateMnemonic failed:', error);
    throw error;
  }
}

/**
 * Validates that a given mnemonic phrase is valid according to BIP-39
 * 
 * @param words - Array of mnemonic words to validate
 * @returns Promise resolving to true if valid, false otherwise
 */
export async function validateMnemonic(words: string[]): Promise<boolean> {
  const wordCount = words.length;

  // Valid word counts are 12 or 24
  if (wordCount !== 12 && wordCount !== 24) {
    return false;
  }

  const normalizedWords = words.map((word) => word.trim().toLowerCase());
  if (normalizedWords.some((word) => word.length === 0)) {
    return false;
  }

  try {
    const parsed = Mnemonic.fromPhrase(normalizedWords.join(' '));
    const parsedWords = parsed.phrase.trim().split(/\s+/);

    if (parsedWords.length !== wordCount) {
      return false;
    }

    return parsedWords.every((word, index) => word === normalizedWords[index]);
  } catch {
    return false;
  }
}

/**
 * @deprecated DO NOT USE - This function produces invalid BIP-39 mnemonics.
 * 
 * The checksum computation in this function is NOT SHA-256 compliant and
 * will generate mnemonics that fail BIP-39 validation. Use the async
 * `generateMnemonic()` function instead, which uses ethers.js proper
 * BIP-39 implementation.
 * 
 * @param wordCount - Number of words to generate (12 or 24). Defaults to 12.
 * @throws Error always - function is deprecated
 */
export function generateMnemonicSync(wordCount: 12 | 24 = 12): string[] {
  throw new Error(
    'generateMnemonicSync is deprecated and removed. ' +
    'Use async generateMnemonic() instead for proper BIP-39 compliance. ' +
    'The sync version produced invalid checksums that do not conform to BIP-39.'
  );
}

/**
 * @deprecated DO NOT USE - This function is not SHA-256 compliant.
 * 
 * This function was used by generateMnemonicSync but produces invalid
 * BIP-39 checksums. It has been removed to prevent generation of
 * invalid mnemonics.
 * 
 * @param entropy - Entropy bytes
 * @param bits - Number of checksum bits needed
 * @throws Error always - function is deprecated
 */
function computeChecksumSync(entropy: Uint8Array, bits: number): string {
  throw new Error(
    'computeChecksumSync is deprecated and removed. ' +
    'It did not implement proper SHA-256 and produced invalid BIP-39 checksums.'
  );
}

/**
 * Derives an Ethereum address from a BIP-39 mnemonic phrase
 * 
 * Uses BIP-32/BIP-44 derivation path: m/44'/60'/0'/0/0
 * - 44' = BIP-44 purpose (HD wallet)
 * - 60' = Ethereum coin type
 * - 0' = First account
 * - 0 = External chain (receiving addresses)
 * - 0 = First address index
 * 
 * @param mnemonic - Array of mnemonic words (12 or 24 words)
 * @returns Promise resolving to Ethereum address (0x-prefixed checksum address)
 * @throws Error if mnemonic is invalid
 */
export async function deriveAddressFromMnemonic(
  mnemonic: string[],
  options: { skipValidation?: boolean } = {}
): Promise<string> {
  try {
    if (!options.skipValidation) {
      const isValid = await validateMnemonic(mnemonic);
      if (!isValid) {
        throw new Error('Invalid mnemonic phrase');
      }
    }

    const mnemonicPhrase = mnemonic.join(' ');
    const wallet = HDNodeWallet.fromMnemonic(
      Mnemonic.fromPhrase(mnemonicPhrase),
      "m/44'/60'/0'/0/0"
    );

    return wallet.address;
  } catch (error) {
    console.error('[bip39] deriveAddressFromMnemonic failed:', error);
    throw error;
  }
}

/**
 * Derives multiple Ethereum addresses from a BIP-39 mnemonic phrase
 * Useful for generating multiple accounts from the same seed
 * 
 * @param mnemonic - Array of mnemonic words (12 or 24 words)
 * @param count - Number of addresses to derive (default: 5)
 * @returns Promise resolving to array of Ethereum addresses
 */
export async function deriveMultipleAddressesFromMnemonic(
  mnemonic: string[],
  count: number = 5
): Promise<string[]> {
  // Validate mnemonic first
  const isValid = await validateMnemonic(mnemonic);
  if (!isValid) {
    throw new Error('Invalid mnemonic phrase');
  }

  const mnemonicPhrase = mnemonic.join(' ');
  const mnemonicObj = Mnemonic.fromPhrase(mnemonicPhrase);
  const addresses: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const wallet = HDNodeWallet.fromMnemonic(
      mnemonicObj,
      `m/44'/60'/0'/0/${i}`
    );
    addresses.push(wallet.address);
  }
  
  return addresses;
}

export default {
  generateMnemonic,
  generateMnemonicSync,
  validateMnemonic,
  deriveAddressFromMnemonic,
  deriveMultipleAddressesFromMnemonic,
  BIP39_WORDLIST,
};
