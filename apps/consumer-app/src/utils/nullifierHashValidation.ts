/**
 * Nullifier Hash Validation (SEC-004)
 *
 * Implements validation that stored nullifierHash matches Poseidon(nullifier).
 *
 * SEC-004: When withdrawing, validate that the nullifierHash retrieved from
 * the commitment record matches the hash of the nullifier using the Poseidon
 * hash function. This prevents semantic attacks where a corrupted or
 * substituted nullifier could be used to generate a valid-looking proof for
 * the wrong commitment.
 *
 * The Poseidon hash is the standard privacy pool commitment scheme:
 *   commitmentHash = Poseidon(nullifier, secret, amount, token)
 *   nullifierHash = Poseidon(nullifier)
 *
 * We use circomlibjs which provides the same Poseidon implementation as
 * the circuit, ensuring cryptographic consistency.
 */

import { buildPoseidon } from 'circomlibjs';
import { captureError } from './sentry';

export type Hex = `0x${string}`;

/**
 * Error thrown when nullifier hash validation fails.
 */
export class NullifierHashError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'POSEIDON_NOT_INITIALIZED'
      | 'NULLIFIER_HASH_MISMATCH'
      | 'INVALID_NULLIFIER_FORMAT'
  ) {
    super(message);
    this.name = 'NullifierHashError';
  }
}

/**
 * Lazy-initialized Poseidon instance.
 * Built once on first use, then cached.
 */
let poseidonInstance: any = null;
let poseidonInitPromise: Promise<any> | null = null;

/**
 * Get or initialize the Poseidon hasher.
 *
 * The Poseidon hasher is built asynchronously on first call and cached.
 * Subsequent calls return the cached instance.
 *
 * @throws NullifierHashError if initialization fails
 * @returns The Poseidon hasher instance
 */
async function getPoseidonHasher(): Promise<any> {
  if (poseidonInstance) {
    return poseidonInstance;
  }

  if (poseidonInitPromise) {
    return poseidonInitPromise;
  }

  poseidonInitPromise = (async () => {
    try {
      poseidonInstance = await buildPoseidon();
      return poseidonInstance;
    } catch (error) {
      const err = new NullifierHashError(
        'Failed to initialize Poseidon hasher: ' +
          (error instanceof Error ? error.message : String(error)),
        'POSEIDON_NOT_INITIALIZED'
      );
      captureError(err, { scope: 'nullifier-hash', operation: 'poseidon-init' });
      throw err;
    }
  })();

  return poseidonInitPromise;
}

/**
 * Convert a 0x-prefixed hex string to a BigInt.
 *
 * @param hex The hex string (e.g., "0xabcd1234...")
 * @returns The BigInt value
 * @throws Error if the hex string is malformed
 */
export function hexToBigInt(hex: Hex): bigint {
  if (!hex.startsWith('0x')) {
    throw new Error(`Invalid hex string: ${hex} (must start with 0x)`);
  }
  return BigInt(hex);
}

/**
 * Convert a BigInt to a 0x-prefixed hex string with 64 hex characters (32 bytes).
 *
 * @param value The BigInt value
 * @returns The 0x-prefixed hex string (padded to 64 chars)
 */
export function bigIntToHex(value: bigint): Hex {
  const hex = value.toString(16);
  const padded = hex.padStart(64, '0');
  return `0x${padded}` as Hex;
}

/**
 * Compute the Poseidon hash of a nullifier.
 *
 * The circuit's public input `nullifierHash` is defined as:
 *   nullifierHash = Poseidon(nullifier)
 *
 * This function computes that hash using the same Poseidon hasher as
 * the circuit, ensuring cryptographic consistency.
 *
 * @param nullifier The 32-byte nullifier as a 0x-prefixed hex string
 * @returns The Poseidon hash as a 0x-prefixed hex string
 * @throws NullifierHashError if hashing fails
 */
export async function computeNullifierHash(nullifier: Hex): Promise<Hex> {
  try {
    const poseidon = await getPoseidonHasher();

    // Convert hex string to BigInt
    const nullifierBigInt = hexToBigInt(nullifier);

    // Compute Poseidon(nullifier)
    // circomlibjs returns a hash object; call .toString() to get the value
    const hash = poseidon([nullifierBigInt]);
    const hashBigInt = typeof hash === 'bigint' ? hash : BigInt(hash.toString());

    // Convert back to 0x-prefixed hex
    return bigIntToHex(hashBigInt);
  } catch (error) {
    if (error instanceof NullifierHashError) {
      throw error;
    }

    const err = new NullifierHashError(
      'Failed to compute nullifier hash: ' +
        (error instanceof Error ? error.message : String(error)),
      'POSEIDON_NOT_INITIALIZED'
    );
    captureError(err, {
      scope: 'nullifier-hash',
      operation: 'compute-hash',
      nullifier: nullifier.slice(0, 10) + '...', // Log only first few chars
    });
    throw err;
  }
}

/**
 * Validate that a stored nullifierHash matches Poseidon(nullifier).
 *
 * SEC-004: Before generating a withdrawal proof, validate that the
 * nullifierHash in the commitment record is correct. This prevents
 * attacks where a corrupted nullifier could be used to generate a
 * proof that is valid with the circuit but semantically incorrect.
 *
 * The check is done client-side before proof generation, so the proof
 * generation step can rely on the invariant that nullifierHash is correct.
 *
 * Usage:
 *   await validateNullifierHash(
 *     commitment.nullifier,
 *     commitment.nullifierHash
 *   );
 *   // If this returns without throwing, the hashes match
 *   // Proceed with proof generation
 *
 * @param nullifier The 32-byte nullifier as a 0x-prefixed hex string
 * @param storedHash The stored nullifier hash to validate
 * @throws NullifierHashError if:
 *   - The computed hash does not match the stored hash
 *   - Poseidon initialization fails
 */
export async function validateNullifierHash(
  nullifier: Hex,
  storedHash: Hex
): Promise<void> {
  try {
    const computedHash = await computeNullifierHash(nullifier);

    // Compare hashes (lowercase for case-insensitive comparison)
    const computedLower = computedHash.toLowerCase();
    const storedLower = storedHash.toLowerCase();

    if (computedLower !== storedLower) {
      const err = new NullifierHashError(
        `Nullifier hash mismatch. Computed: ${computedLower}, Stored: ${storedLower}. ` +
          `This may indicate a corrupted or tampered commitment record. ` +
          `Do not proceed with this withdrawal.`,
        'NULLIFIER_HASH_MISMATCH'
      );
      captureError(err, {
        scope: 'nullifier-hash',
        operation: 'validation',
        computed: computedHash.slice(0, 10) + '...',
        stored: storedHash.slice(0, 10) + '...',
      });
      throw err;
    }

    // Hashes match; validation passed
  } catch (error) {
    if (error instanceof NullifierHashError) {
      throw error;
    }

    const err = new NullifierHashError(
      'Nullifier hash validation failed: ' +
        (error instanceof Error ? error.message : String(error)),
      'POSEIDON_NOT_INITIALIZED'
    );
    captureError(err, {
      scope: 'nullifier-hash',
      operation: 'validation',
    });
    throw error;
  }
}

/**
 * Validate format of a nullifier (must be 32-byte 0x-prefixed hex).
 *
 * @param nullifier The value to validate
 * @returns true if the format is valid
 */
export function isValidNullifierFormat(nullifier: unknown): boolean {
  if (typeof nullifier !== 'string') return false;
  if (!nullifier.startsWith('0x')) return false;
  if (nullifier.length !== 66) return false; // 0x + 64 hex chars = 66 total
  return /^0x[0-9a-fA-F]{64}$/.test(nullifier);
}

/**
 * Validate format of a hash (must be 32-byte 0x-prefixed hex).
 *
 * Same format as nullifier: 0x + 64 hex characters.
 *
 * @param hash The value to validate
 * @returns true if the format is valid
 */
export function isValidHashFormat(hash: unknown): boolean {
  if (typeof hash !== 'string') return false;
  if (!hash.startsWith('0x')) return false;
  if (hash.length !== 66) return false; // 0x + 64 hex chars = 66 total
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}
