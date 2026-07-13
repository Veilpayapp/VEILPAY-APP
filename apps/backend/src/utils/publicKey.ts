import { SigningKey } from "ethers";

/**
 * Public-key validation for merchant-published viewing keys (SEC-001).
 *
 * The Directory endpoint (`GET /api/v1/directory/:id`) serves a merchant's
 * viewing key **unauthenticated** so that any sender can derive a stealth
 * address (secp256k1 ECDH, see `stealthEngine.deriveStealthAddress`) or
 * encrypt a memo for the recipient. That exposure is correct *only* if the
 * stored value is genuinely PUBLIC key material.
 *
 * Because the merchant-side publishing client is out of this repo's trust
 * boundary, we cannot assume it always sends a public key. This module is the
 * server-side guard: it rejects anything that is not a well-formed public key
 * — in particular a 32-byte secp256k1 / 64-byte ed25519 private key, or a
 * Stellar `S…` secret seed — so spend/scan authority can never be persisted
 * and broadcast to the world.
 *
 * The checks are per chain type because each family uses a different curve and
 * encoding:
 *   - `evm` → secp256k1 SEC1 point (validated on-curve).
 *   - `svm` → ed25519 public key, base58, exactly 32 bytes.
 *   - `xlm` → Stellar StrKey `G…` (ed25519 public key; `S…` secrets rejected).
 */

export type ChainType = "evm" | "svm" | "xlm";

export interface PubKeyCheck {
  ok: boolean;
  /** Human-readable rejection reason; only present when `ok === false`. */
  error?: string;
}

const HEX_RE = /^[0-9a-fA-F]+$/;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function validatePublishedViewingKey(
  chainType: ChainType,
  rawValue: string
): PubKeyCheck {
  const value = rawValue.trim();
  if (value.length === 0) {
    return { ok: false, error: "viewingKey must not be empty" };
  }
  switch (chainType) {
    case "evm":
      return validateSecp256k1PublicKey(value);
    case "svm":
      return validateEd25519Base58PublicKey(value);
    case "xlm":
      return validateStellarPublicKey(value);
    default:
      return { ok: false, error: `Unsupported chain type: ${String(chainType)}` };
  }
}

/**
 * secp256k1 (EVM). Accepts a 33-byte compressed (`0x02`/`0x03`) or 65-byte
 * uncompressed (`0x04`) SEC1 point and confirms it lies on the curve.
 *
 * The length/prefix gate is load-bearing: `SigningKey.computePublicKey` will
 * happily accept a 32-byte PRIVATE key (it derives the public key from it), so
 * we must exclude the private-key shape *before* the on-curve check.
 */
function validateSecp256k1PublicKey(value: string): PubKeyCheck {
  const hex =
    value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;

  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    return {
      ok: false,
      error: "EVM viewingKey must be a hex-encoded secp256k1 public key",
    };
  }

  const byteLength = hex.length / 2;
  const prefix = hex.slice(0, 2).toLowerCase();
  const isCompressed =
    byteLength === 33 && (prefix === "02" || prefix === "03");
  const isUncompressed = byteLength === 65 && prefix === "04";

  if (!isCompressed && !isUncompressed) {
    return {
      ok: false,
      error:
        "EVM viewingKey must be a 33-byte compressed (0x02/0x03) or 65-byte uncompressed (0x04) secp256k1 PUBLIC key; a 32-byte value is a PRIVATE key and is rejected",
    };
  }

  try {
    // Throws when the encoded point is not on the secp256k1 curve.
    SigningKey.computePublicKey("0x" + hex, false);
  } catch {
    return {
      ok: false,
      error: "EVM viewingKey is not a valid point on the secp256k1 curve",
    };
  }

  return { ok: true };
}

/**
 * ed25519 (Solana). A public key base58-decodes to exactly 32 bytes; a raw
 * secret key is 64 bytes, so the length check rejects an accidentally-published
 * secret.
 */
function validateEd25519Base58PublicKey(value: string): PubKeyCheck {
  const decoded = base58Decode(value);
  if (!decoded) {
    return {
      ok: false,
      error: "Solana viewingKey must be a base58-encoded public key",
    };
  }
  if (decoded.length !== 32) {
    return {
      ok: false,
      error:
        "Solana viewingKey must decode to a 32-byte ed25519 PUBLIC key; 64-byte values are secret keys and are rejected",
    };
  }
  return { ok: true };
}

/**
 * Stellar. StrKey `G…` encodes an ed25519 public key with CRC16-XModem checksum.
 * Secret seeds use the `S…` version byte and are rejected.
 *
 * Payload layout after base32 decode: version(1) + ed25519 pubkey(32) + checksum(2).
 * Version byte for ed25519 public key is `6 << 3` (48).
 */
function validateStellarPublicKey(value: string): PubKeyCheck {
  if (!/^G[A-Z2-7]{55}$/.test(value)) {
    return {
      ok: false,
      error:
        "Stellar viewingKey must be a StrKey public key (G…); secret keys (S…) are rejected",
    };
  }

  const decoded = base32Decode(value);
  if (!decoded || decoded.length !== 35) {
    return {
      ok: false,
      error: "Stellar viewingKey failed StrKey base32 decode",
    };
  }

  const STELLAR_ED25519_PUBLIC_VERSION = 6 << 3; // 48 → encodes as 'G'
  if (decoded[0] !== STELLAR_ED25519_PUBLIC_VERSION) {
    return {
      ok: false,
      error: "Stellar viewingKey has unexpected StrKey version byte",
    };
  }

  const payload = decoded.subarray(0, 33);
  const checksum = decoded[33]! | (decoded[34]! << 8);
  if (crc16xmodem(payload) !== checksum) {
    return {
      ok: false,
      error: "Stellar viewingKey failed StrKey checksum validation",
    };
  }

  return { ok: true };
}

/** RFC 4648 base32 (no padding), used by Stellar StrKey. */
function base32Decode(input: string): Uint8Array | null {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** CRC16-XModem as used by Stellar StrKey. */
function crc16xmodem(data: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]! << 8;
    for (let b = 0; b < 8; b++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Minimal, dependency-free base58 decoder. Returns the decoded bytes, or
 * `null` if the input contains a non-base58 character. Leading `1`s decode to
 * leading zero bytes (standard Bitcoin/Solana base58 semantics).
 */
function base58Decode(input: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const ch of input) {
    const value = BASE58_ALPHABET.indexOf(ch);
    if (value === -1) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < input.length && input[k] === "1"; k++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}
