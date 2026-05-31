/**
 * Stealth address engine for the consumer app.
 *
 * Direct port of `apps/indexer/src/stealth/crypto.ts`, upgraded to the dual-key
 * (spending + viewing) EIP-5564 scheme on top of `@noble/secp256k1`. The function
 * names match the indexer module so call sites stay symmetric across the codebase.
 *
 * Wire format invariants (must remain byte-compatible with the indexer scanner):
 *   - Ephemeral public keys are 33-byte SEC1 compressed (`0x02` / `0x03` prefix).
 *     This matches the `ephemeralPubKey` field of the on-chain ERC-5564 `Announcement`
 *     event the indexer scanner consumes.
 *   - Stealth EVM address = last 20 bytes of `keccak256(uncompressed stealth pubkey
 *     X || Y)`, lowercase 0x-prefixed.
 *   - Shared secret tweak = `keccak256(compressedSharedPoint)` reduced mod N.
 *
 * The module is pure and stateless; randomness comes from `crypto.getRandomValues`
 * which `react-native-get-random-values` polyfills on RN at app entry.
 */

import * as secp from '@noble/secp256k1';
import type { Address, Hex } from 'viem';
import { keccak256 } from 'viem';

// secp256k1 group order (modulus for scalars / private keys). Distinct from the field
// prime used for point-coordinate arithmetic — using one where the other is required
// produces silently incorrect results.
const N = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);

// Some noble releases expose the projective point class as `ProjectivePoint`, others as
// `Point`. Resolve it once defensively so a minor noble bump doesn't break this module.
const Point: {
  BASE: { multiply: (scalar: bigint) => PointInstance };
  fromHex: (bytes: Uint8Array | string) => PointInstance;
} =
  (secp as unknown as { ProjectivePoint?: typeof Point }).ProjectivePoint ??
  (secp as unknown as { Point: typeof Point }).Point;

interface PointInstance {
  add(other: PointInstance): PointInstance;
  multiply(scalar: bigint): PointInstance;
  toRawBytes(isCompressed: boolean): Uint8Array;
}

// ---------- byte / hex helpers ----------

function bytesToHex(bytes: Uint8Array): Hex {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return `0x${s}` as Hex;
}

function hexToBytes(hex: Hex | string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) throw new Error('stealthEngine: hex string of odd length');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('stealthEngine: invalid hex character');
    out[i] = byte;
  }
  return out;
}

function bigIntTo32Bytes(n: bigint): Uint8Array {
  if (n < 0n) throw new Error('stealthEngine: negative scalar');
  const hex = n.toString(16).padStart(64, '0');
  if (hex.length !== 64) throw new Error('stealthEngine: scalar exceeds 32 bytes');
  return hexToBytes(hex);
}

function modN(a: bigint): bigint {
  const r = a % N;
  return r >= 0n ? r : r + N;
}

/**
 * Reduces a 32-byte hash to a non-zero secp256k1 scalar in [1, N-1]. Throws on the
 * vanishingly improbable case where the reduction lands on zero, since that would
 * collapse the ECDH-derived tweak.
 */
function hashToScalar(bytes: Uint8Array): bigint {
  const hashHex = keccak256(bytes);
  const scalar = modN(BigInt(hashHex));
  if (scalar === 0n) {
    throw new Error('stealthEngine: derived scalar is zero');
  }
  return scalar;
}

// ---------- public API ----------

/**
 * Generates a fresh dual-key stealth identity:
 *   - `spendingKey` controls funds sent to any stealth address derived from the pair.
 *   - `viewingKey` is shared with scanning infrastructure to detect incoming
 *     announcements without exposing spend authority.
 * Public keys are SEC1 compressed (33 bytes, `0x02`/`0x03` prefix).
 */
export function generateStealthKeyPair(): {
  spendingKey: Hex;
  viewingKey: Hex;
  spendingPub: Hex;
  viewingPub: Hex;
} {
  const spendingPriv = secp.utils.randomPrivateKey();
  const viewingPriv = secp.utils.randomPrivateKey();
  const spendingPubBytes = secp.getPublicKey(spendingPriv, true);
  const viewingPubBytes = secp.getPublicKey(viewingPriv, true);

  return {
    spendingKey: bytesToHex(spendingPriv),
    viewingKey: bytesToHex(viewingPriv),
    spendingPub: bytesToHex(spendingPubBytes),
    viewingPub: bytesToHex(viewingPubBytes),
  };
}

/**
 * Sender-side: derives a one-time stealth EVM address for a recipient identified by
 * their viewing and spending public keys.
 *
 *   ephemeralPriv   = random scalar
 *   ephemeralPubKey = ephemeralPriv * G                (compressed, 33 bytes)
 *   sharedTweak     = keccak256(ephemeralPriv * V_view) mod N
 *   stealthPub      = S_spend + sharedTweak * G        (uncompressed for hashing)
 *   stealthAddress  = keccak256(stealthPub.X || stealthPub.Y)[12:]
 *
 * Returns the stealth address (used as the on-chain recipient) and the compressed
 * ephemeral public key the sender publishes via `StealthAnnouncer.announce()`.
 */
export function deriveStealthAddress(
  recipientViewingPub: Hex,
  recipientSpendingPub: Hex,
): { stealthAddress: Address; ephemeralPubKey: Hex } {
  const ephemeralPriv = secp.utils.randomPrivateKey();
  const ephemeralPubBytes = secp.getPublicKey(ephemeralPriv, true);

  // ECDH: ephemeralPriv * recipientViewingPub, returned as compressed 33-byte point.
  const sharedPointCompressed = secp.getSharedSecret(
    ephemeralPriv,
    hexToBytes(recipientViewingPub),
    true,
  );
  const sharedTweak = hashToScalar(sharedPointCompressed);

  // stealthPub = spendingPub + sharedTweak * G
  const spendingPoint = Point.fromHex(hexToBytes(recipientSpendingPub));
  const tweakPoint = Point.BASE.multiply(sharedTweak);
  const stealthPoint = spendingPoint.add(tweakPoint);

  // Drop the SEC1 0x04 prefix; keccak256 over X || Y, last 20 bytes is the EVM address.
  const stealthUncompressed = stealthPoint.toRawBytes(false).slice(1);
  const addrHashHex = keccak256(stealthUncompressed);
  const stealthAddress = `0x${addrHashHex.slice(2 + 24)}` as Address; // last 20 bytes

  return {
    stealthAddress,
    ephemeralPubKey: bytesToHex(ephemeralPubBytes),
  };
}

/**
 * Recipient-side: recovers the private key controlling a stealth address. Requires both
 * halves of the recipient identity — the viewing key for the ECDH step and the
 * spending key for the scalar sum.
 *
 *   sharedTweak = keccak256(viewingPriv * E) mod N
 *   stealthPriv = (spendingPriv + sharedTweak) mod N
 */
export function recoverStealthPrivateKey(
  ephemeralPubKey: Hex,
  viewingPriv: Hex,
  spendingPriv: Hex,
): Hex {
  const sharedPointCompressed = secp.getSharedSecret(
    hexToBytes(viewingPriv),
    hexToBytes(ephemeralPubKey),
    true,
  );
  const sharedTweak = hashToScalar(sharedPointCompressed);
  const stealthPriv = modN(BigInt(spendingPriv) + sharedTweak);
  if (stealthPriv === 0n) {
    throw new Error('stealthEngine: recovered stealth private key is zero');
  }
  return bytesToHex(bigIntTo32Bytes(stealthPriv));
}

/**
 * Recipient-side: returns true iff `stealthAddress` was derived from `ephemeralPubKey`,
 * the recipient's `viewingPriv`, and `spendingPub` (i.e. this announcement targets us).
 *
 * Re-derives the candidate stealth address using only the public spending key (no
 * spending private key is required to scan, which is the entire point of the
 * spending/viewing split).
 *
 * Returns false on any decoding or curve-arithmetic failure rather than throwing —
 * scanners process untrusted on-chain data and must never crash on a single bad
 * announcement.
 */
export function checkStealthAddressMatch(
  stealthAddress: Address,
  ephemeralPubKey: Hex,
  viewingPriv: Hex,
  spendingPub: Hex,
): boolean {
  try {
    const sharedPointCompressed = secp.getSharedSecret(
      hexToBytes(viewingPriv),
      hexToBytes(ephemeralPubKey),
      true,
    );
    const sharedTweak = hashToScalar(sharedPointCompressed);

    const spendingPoint = Point.fromHex(hexToBytes(spendingPub));
    const tweakPoint = Point.BASE.multiply(sharedTweak);
    const stealthPoint = spendingPoint.add(tweakPoint);

    const stealthUncompressed = stealthPoint.toRawBytes(false).slice(1);
    const derivedHex = keccak256(stealthUncompressed);
    const derivedAddr = `0x${derivedHex.slice(2 + 24)}`;

    return derivedAddr.toLowerCase() === stealthAddress.toLowerCase();
  } catch {
    return false;
  }
}
