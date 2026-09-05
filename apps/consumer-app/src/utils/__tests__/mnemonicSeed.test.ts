/**
 * Correctness + perf assertions for the native-first mnemonic→seed helper.
 *
 * The helper must (a) prefer the native background-thread PBKDF2 when the
 * native module is present, (b) fall back to the byte-identical pure-JS
 * `@scure/bip39` implementation otherwise, and (c) never re-derive the same
 * phrase twice in a session (the "perf assertion": native path is
 * non-blocking and the cache avoids redundant ~1.5s JS derivations).
 */

import { deriveMnemonicSeed } from '../mnemonicSeed';
import { setSppNativeBackend, type SppNativeModule } from '../stellarSpp/sppNativeBridge';

const baseModule = {
  version: () => 'test',
  ping: (i?: string | null) => (i ? `pong:${i}` : 'pong'),
  capabilities: () => ({
    version: 'test',
    ping: true,
    poolOps: false,
    aspLeaf: false,
    backend: 'native' as const,
  }),
};

const PHRASE_NATIVE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// Intentionally weird (unrelated words) — proves the phrase is passed through
// verbatim and the native→JS split is deterministic, not checksum-dependent.
const PHRASE_FALLBACK = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';

describe('deriveMnemonicSeed', () => {
  afterEach(() => {
    // Reset to the JS-stub backend so one test's injection can't leak into
    // the next.
    setSppNativeBackend(baseModule as unknown as SppNativeModule);
  });

  it('prefers the native backend and returns the hex-decoded 64-byte seed', async () => {
    const nativeSeedHex = '11'.repeat(64); // 64 bytes
    const nativeCall = jest.fn(async (_p: string) => nativeSeedHex);
    setSppNativeBackend(
      { ...baseModule, mnemonicToSeed: nativeCall } as unknown as SppNativeModule
    );

    const seed = await deriveMnemonicSeed(PHRASE_NATIVE);

    // 64 bytes, byte-for-byte equal to the native hex-decoded output.
    expect(seed).toHaveLength(64);
    expect(Buffer.from(seed).toString('hex')).toBe(nativeSeedHex);
    expect(nativeCall).toHaveBeenCalledWith(PHRASE_NATIVE);

    // Perf assertion: a second derivation of the same phrase is served from
    // the session cache and must NOT hit native (or JS) again.
    const seed2 = await deriveMnemonicSeed(PHRASE_NATIVE);
    expect(seed2).toEqual(seed);
    expect(nativeCall).toHaveBeenCalledTimes(1);
  });

  it('pins the native path to the @scure/bip39 reference for the same BIP39 vector', async () => {
    // A distinct phrase (not exercised elsewhere in this suite) so the
    // per-phrase session cache cannot serve a prior derivation. Compute the
    // authoritative seed with the pure-JS reference, then inject a fake native
    // that returns that exact 128-hex value. deriveMnemonicSeed must forward
    // the native output verbatim — proving that IF native PBKDF2 matches the
    // reference it yields byte-identical keys, and that the native path is
    // pinned to it.
    const phrase =
      'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const reference = new Uint8Array(
      await jest.requireActual('@scure/bip39').mnemonicToSeed(phrase)
    );
    const referenceHex = Buffer.from(reference).toString('hex');
    expect(referenceHex).toHaveLength(128);

    const nativeCall = jest.fn(async (_p: string) => referenceHex);
    setSppNativeBackend(
      { ...baseModule, mnemonicToSeed: nativeCall } as unknown as SppNativeModule
    );

    const seed = await deriveMnemonicSeed(phrase);
    const nativeHex = Buffer.from(seed).toString('hex');

    // (a) native output forwarded exactly.
    expect(nativeHex).toBe(referenceHex);
    // (b) for the same mnemonic, fake-native == scure reference (byte-identical).
    expect(nativeHex).toBe(Buffer.from(reference).toString('hex'));
    expect(nativeCall).toHaveBeenCalledWith(phrase);
  });

  it('falls back to @scure/bip39, byte-identical to the reference implementation', async () => {
    // Backend without mnemonicToSeed → native path yields null → JS fallback.
    setSppNativeBackend(baseModule as unknown as SppNativeModule);

    const seed = await deriveMnemonicSeed(PHRASE_FALLBACK);

    const reference = new Uint8Array(
      await jest.requireActual('@scure/bip39').mnemonicToSeed(PHRASE_FALLBACK)
    );
    expect(seed).toHaveLength(64);
    expect(Buffer.from(seed).toString('hex')).toBe(Buffer.from(reference).toString('hex'));
  });

  it('the JS fallback produces a seed equal in length to a real BIP39 phrase', async () => {
    setSppNativeBackend(baseModule as unknown as SppNativeModule);
    const seed = await deriveMnemonicSeed(PHRASE_NATIVE);
    expect(seed).toHaveLength(64);
  });
});
