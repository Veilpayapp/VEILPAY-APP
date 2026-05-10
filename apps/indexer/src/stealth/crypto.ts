import { ethers } from "ethers";
import { Buffer } from "buffer";

// secp256k1 curve parameters
// P = field prime (modulus for coordinates)
// N = group order (modulus for scalars / private keys)
// These are DIFFERENT values — using N where P is required produces incorrect point arithmetic.
const P = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F");
const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

function mod(a: bigint, m: bigint = P): bigint {
  const result = a % m;
  return result >= 0n ? result : result + m;
}

function pointAdd(
  point1: [bigint, bigint] | null,
  point2: [bigint, bigint] | null
): [bigint, bigint] | null {
  if (point1 === null) return point2;
  if (point2 === null) return point1;

  const [x1, y1] = point1;
  const [x2, y2] = point2;

  if (x1 === x2 && y1 === y2) {
    return pointDouble(point1);
  }

  const lambda = mod((y2 - y1) * modInverse(x2 - x1, P), P);
  const x3 = mod(lambda * lambda - x1 - x2, P);
  const y3 = mod(lambda * (x1 - x3) - y1, P);

  return [x3, y3];
}

function pointDouble(point: [bigint, bigint]): [bigint, bigint] {
  const [x, y] = point;
  const lambda = mod(3n * x * x * modInverse(2n * y, P), P);
  const x3 = mod(lambda * lambda - 2n * x, P);
  const y3 = mod(lambda * (x - x3) - y, P);

  return [x3, y3];
}

function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a, m];
  let [oldS, s] = [1n, 0n];

  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }

  return mod(oldS, m);
}

function pointMultiply(point: [bigint, bigint] | null, scalar: bigint): [bigint, bigint] | null {
  if (point === null || scalar === 0n) return null;

  // Reduce scalar modulo N (group order) before multiplication
  const k = mod(scalar, N);
  if (k === 0n) return null;

  let result: [bigint, bigint] | null = null;
  let addend: [bigint, bigint] | null = point;
  let remaining = k;

  while (remaining > 0n) {
    if (remaining & 1n) {
      result = pointAdd(result, addend);
    }
    addend = pointDouble(addend!);
    remaining >>= 1n;
  }

  return result;
}

const SECP256K1_G: [bigint, bigint] = [
  BigInt("0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28C959F2815B16F81798"),
  BigInt("0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8"),
];

export class StealthAddressEngine {
  static generateStealthKeyPair(): { privateKey: string; publicKey: string } {
    const privateKeyBytes = new Uint8Array(32);
    crypto.getRandomValues(privateKeyBytes);
    const privateKey = ethers.hexlify(privateKeyBytes);

    const publicKeyPoint = pointMultiply(SECP256K1_G, BigInt(privateKey));
    if (!publicKeyPoint) {
      throw new Error("Failed to generate public key");
    }

    const publicKey = ethers.hexlify(
      new Uint8Array([
        ...ethers.getBytes(ethers.toBeHex(publicKeyPoint[0])),
        ...ethers.getBytes(ethers.toBeHex(publicKeyPoint[1])),
      ])
    );

    return { privateKey, publicKey };
  }

  static deriveStealthAddress(
    recipientViewingPublicKey: string,
    ephemeralPrivateKey: string
  ): { stealthAddress: string; ephemeralPublicKey: string } {
    const ephemeralPublicKeyPoint = pointMultiply(SECP256K1_G, BigInt(ephemeralPrivateKey));
    if (!ephemeralPublicKeyPoint) {
      throw new Error("Failed to generate ephemeral public key");
    }

    const ephemeralPublicKey = ethers.hexlify(
      new Uint8Array([
        ...ethers.getBytes(ethers.toBeHex(ephemeralPublicKeyPoint[0])),
        ...ethers.getBytes(ethers.toBeHex(ephemeralPublicKeyPoint[1])),
      ])
    );

    const sharedSecretPoint = pointMultiply(
      [
        BigInt("0x" + recipientViewingPublicKey.slice(2, 66)),
        BigInt("0x" + recipientViewingPublicKey.slice(66)),
      ],
      BigInt(ephemeralPrivateKey)
    );

    if (!sharedSecretPoint) {
      throw new Error("Failed to compute shared secret");
    }

    const sharedSecret = ethers.keccak256(
      new Uint8Array([
        ...ethers.getBytes(ethers.toBeHex(sharedSecretPoint[0])),
        ...ethers.getBytes(ethers.toBeHex(sharedSecretPoint[1])),
      ])
    );

    // Scalar addition must be modulo N (group order), not P (field prime)
    const stealthPrivateKeyBigInt = mod(BigInt(sharedSecret) + BigInt(ephemeralPrivateKey), N);

    const stealthPublicKeyPoint = pointMultiply(SECP256K1_G, stealthPrivateKeyBigInt);
    if (!stealthPublicKeyPoint) {
      throw new Error("Failed to derive stealth public key");
    }

    const stealthPublicKey = ethers.keccak256(
      new Uint8Array([
        ...ethers.getBytes(ethers.toBeHex(stealthPublicKeyPoint[0])),
        ...ethers.getBytes(ethers.toBeHex(stealthPublicKeyPoint[1])),
      ])
    );

    const stealthAddress = "0x" + stealthPublicKey.slice(24);

    return { stealthAddress, ephemeralPublicKey };
  }

  static recoverStealthPrivateKey(ephemeralPublicKey: string, viewingPrivateKey: string): string {
    const sharedSecretPoint = pointMultiply(
      [BigInt("0x" + ephemeralPublicKey.slice(2, 66)), BigInt("0x" + ephemeralPublicKey.slice(66))],
      BigInt(viewingPrivateKey)
    );

    if (!sharedSecretPoint) {
      throw new Error("Failed to compute shared secret");
    }

    const sharedSecret = ethers.keccak256(
      new Uint8Array([
        ...ethers.getBytes(ethers.toBeHex(sharedSecretPoint[0])),
        ...ethers.getBytes(ethers.toBeHex(sharedSecretPoint[1])),
      ])
    );

    // Scalar addition must be modulo N (group order)
    const stealthPrivateKey = mod(BigInt(sharedSecret) + BigInt(viewingPrivateKey), N);

    return "0x" + stealthPrivateKey.toString(16).padStart(64, "0");
  }

  static checkStealthAddressMatch(
    stealthAddress: string,
    ephemeralPublicKey: string,
    viewingPrivateKey: string
  ): boolean {
    try {
      const recoveredPrivateKey = this.recoverStealthPrivateKey(
        ephemeralPublicKey,
        viewingPrivateKey
      );

      const publicKeyPoint = pointMultiply(SECP256K1_G, BigInt(recoveredPrivateKey));
      if (!publicKeyPoint) return false;

      const derivedAddress =
        "0x" +
        ethers.keccak256(
          new Uint8Array([
            ...ethers.getBytes(ethers.toBeHex(publicKeyPoint[0])),
            ...ethers.getBytes(ethers.toBeHex(publicKeyPoint[1])),
          ])
        ).slice(24);

      return derivedAddress.toLowerCase() === stealthAddress.toLowerCase();
    } catch {
      return false;
    }
  }
}

export default StealthAddressEngine;
