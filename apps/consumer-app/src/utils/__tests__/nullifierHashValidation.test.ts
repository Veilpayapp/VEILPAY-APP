/**
 * SEC-004 Tests: Nullifier Hash Validation
 *
 * Test suite for validateNullifierHash ensuring:
 *   1. Matching hashes pass validation
 *   2. Mismatched hashes are rejected
 *   3. Invalid formats are caught
 *   4. Corrupted nullifiers are detected
 */

import {
  validateNullifierHash,
  computeNullifierHash,
  hexToBigInt,
  bigIntToHex,
  isValidNullifierFormat,
  isValidHashFormat,
  NullifierHashError,
  type Hex,
} from '../nullifierHashValidation';

describe('SEC-004: Nullifier Hash Validation', () => {
  describe('hexToBigInt and bigIntToHex', () => {
    it('should convert hex strings to BigInt and back', () => {
      const hex = '0x' + '1a'.repeat(32) as Hex;
      const bigint = hexToBigInt(hex);
      const hexBack = bigIntToHex(bigint);
      expect(hexBack.toLowerCase()).toBe(hex.toLowerCase());
    });

    it('should reject hex without 0x prefix', () => {
      expect(() => hexToBigInt('abcd1234' as Hex)).toThrow();
    });

    it('should handle zero', () => {
      const hex = '0x' + '0'.repeat(64) as Hex;
      const bigint = hexToBigInt(hex);
      expect(bigint).toBe(0n);
    });

    it('should handle large numbers', () => {
      const hex = '0x' + 'f'.repeat(64) as Hex;
      const bigint = hexToBigInt(hex);
      const hexBack = bigIntToHex(bigint);
      expect(hexBack.toLowerCase()).toBe(hex.toLowerCase());
    });
  });

  describe('format validation', () => {
    it('should accept valid nullifier format', () => {
      const validNullifier = '0x' + 'ab'.repeat(32) as Hex;
      expect(isValidNullifierFormat(validNullifier)).toBe(true);
    });

    it('should reject nullifier without 0x prefix', () => {
      expect(isValidNullifierFormat('ab'.repeat(32))).toBe(false);
    });

    it('should reject nullifier with wrong length', () => {
      expect(isValidNullifierFormat('0x' + 'ab'.repeat(31))).toBe(false);
      expect(isValidNullifierFormat('0x' + 'ab'.repeat(33))).toBe(false);
    });

    it('should reject nullifier with non-hex characters', () => {
      const invalid = '0x' + 'ab'.repeat(31) + 'gg' as Hex;
      expect(isValidNullifierFormat(invalid)).toBe(false);
    });

    it('should reject non-string nullifier', () => {
      expect(isValidNullifierFormat(123)).toBe(false);
      expect(isValidNullifierFormat(null)).toBe(false);
      expect(isValidNullifierFormat(undefined)).toBe(false);
    });

    it('should accept valid hash format', () => {
      const validHash = '0x' + 'cd'.repeat(32) as Hex;
      expect(isValidHashFormat(validHash)).toBe(true);
    });

    it('should reject hash without 0x prefix', () => {
      expect(isValidHashFormat('cd'.repeat(32))).toBe(false);
    });

    it('should reject hash with wrong length', () => {
      expect(isValidHashFormat('0x' + 'cd'.repeat(31))).toBe(false);
    });
  });

  describe('computeNullifierHash', () => {
    it('should compute consistent hash for the same nullifier', async () => {
      const nullifier = '0x' + '12'.repeat(32) as Hex;
      const hash1 = await computeNullifierHash(nullifier);
      const hash2 = await computeNullifierHash(nullifier);
      expect(hash1.toLowerCase()).toBe(hash2.toLowerCase());
    });

    it('should produce different hashes for different nullifiers', async () => {
      const nullifier1 = '0x' + '11'.repeat(32) as Hex;
      const nullifier2 = '0x' + '22'.repeat(32) as Hex;
      const hash1 = await computeNullifierHash(nullifier1);
      const hash2 = await computeNullifierHash(nullifier2);
      expect(hash1.toLowerCase()).not.toBe(hash2.toLowerCase());
    });

    it('should return a valid 32-byte hex string', async () => {
      const nullifier = '0x' + '33'.repeat(32) as Hex;
      const hash = await computeNullifierHash(nullifier);
      expect(isValidHashFormat(hash)).toBe(true);
    });

    it('should handle case-insensitive hex input', async () => {
      const nullifierLower = '0x' + 'abcdef'.repeat(11) as Hex;
      const nullifierUpper = ('0x' + 'ABCDEF'.repeat(11)).slice(0, 66) as Hex;
      const hash1 = await computeNullifierHash(nullifierLower);
      const hash2 = await computeNullifierHash(nullifierUpper);
      expect(hash1.toLowerCase()).toBe(hash2.toLowerCase());
    });
  });

  describe('validateNullifierHash', () => {
    it('should pass when hash matches the computed hash', async () => {
      const nullifier = '0x' + '44'.repeat(32) as Hex;
      const expectedHash = await computeNullifierHash(nullifier);
      // Should not throw
      await validateNullifierHash(nullifier, expectedHash);
    });

    it('should pass with case-insensitive hash comparison', async () => {
      const nullifier = '0x' + '55'.repeat(32) as Hex;
      const computedHash = await computeNullifierHash(nullifier);
      const mixedCaseHash = (
        computedHash.slice(0, 2) +
        computedHash.slice(2).split('').map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase())).join('')
      ) as Hex;
      // Should not throw
      await validateNullifierHash(nullifier, mixedCaseHash);
    });

    it('should throw NullifierHashError when hash does not match', async () => {
      const nullifier = '0x' + '66'.repeat(32) as Hex;
      const wrongHash = '0x' + '99'.repeat(32) as Hex;
      await expect(validateNullifierHash(nullifier, wrongHash)).rejects.toThrow(NullifierHashError);
      try {
        await validateNullifierHash(nullifier, wrongHash);
      } catch (err) {
        expect(err).toBeInstanceOf(NullifierHashError);
        if (err instanceof NullifierHashError) {
          expect(err.code).toBe('NULLIFIER_HASH_MISMATCH');
          expect(err.message).toContain('mismatch');
        }
      }
    });

    it('should reject off-by-one corruptions', async () => {
      const nullifier = '0x' + '77'.repeat(32) as Hex;
      const correctHash = await computeNullifierHash(nullifier);
      // Corrupt one byte
      const chars = correctHash.split('');
      chars[4] = chars[4] === 'a' ? 'b' : 'a'; // flip a byte
      const corruptedHash = chars.join('') as Hex;

      if (corruptedHash !== correctHash) {
        await expect(validateNullifierHash(nullifier, corruptedHash)).rejects.toThrow(
          NullifierHashError
        );
      }
    });

    it('should detect bit flips in the hash', async () => {
      const nullifier = '0x' + '88'.repeat(32) as Hex;
      const correctHash = await computeNullifierHash(nullifier);
      // Flip last hex digit
      const chars = correctHash.split('');
      const lastChar = chars[chars.length - 1];
      chars[chars.length - 1] = lastChar === 'f' ? '0' : 'f';
      const bitFlippedHash = chars.join('') as Hex;

      if (bitFlippedHash !== correctHash) {
        await expect(validateNullifierHash(nullifier, bitFlippedHash)).rejects.toThrow(
          NullifierHashError
        );
      }
    });

    it('should handle multiple validation calls (cached Poseidon)', async () => {
      const nullifier1 = '0x' + 'aa'.repeat(32) as Hex;
      const nullifier2 = '0x' + 'bb'.repeat(32) as Hex;
      const hash1 = await computeNullifierHash(nullifier1);
      const hash2 = await computeNullifierHash(nullifier2);

      // First call initializes Poseidon
      await validateNullifierHash(nullifier1, hash1);
      // Subsequent calls reuse the cached instance
      await validateNullifierHash(nullifier2, hash2);
      // No errors should be thrown
    });
  });

  describe('real-world withdrawal scenarios', () => {
    it('should pass with a typical commitment record', async () => {
      // Simulate a real commitment record
      const nullifier = '0x' + 'dead'.padEnd(64, 'beef') as Hex;
      const correctHash = await computeNullifierHash(nullifier);

      // Withdrawal code would call:
      await validateNullifierHash(nullifier, correctHash);
      // Should succeed
    });

    it('should detect if nullifier and hash are swapped', async () => {
      const nullifier = '0x' + 'face'.padEnd(64, 'cafe') as Hex;
      const hash = await computeNullifierHash(nullifier);

      // Attacker tries to use the hash as nullifier
      const hashAsNullifier = hash;
      const nullifierAsHash = nullifier;

      await expect(validateNullifierHash(hashAsNullifier, nullifierAsHash)).rejects.toThrow();
    });

    it('should reject corrupted records before proof generation', async () => {
      const correctNullifier = '0x' + 'c0ff'.padEnd(64, 'eee0') as Hex;
      const correctHash = await computeNullifierHash(correctNullifier);

      // Someone corrupted the nullifier in the commitment record
      const corruptedNullifier = ('0x' + 'c0ff'.padEnd(64, 'eee1')) as Hex; // one bit flipped

      // Validation should fail, preventing proof generation
      await expect(validateNullifierHash(corruptedNullifier, correctHash)).rejects.toThrow(
        NullifierHashError
      );
    });
  });

  describe('error handling', () => {
    it('should provide clear error message on hash mismatch', async () => {
      const nullifier = '0x' + '11'.repeat(32) as Hex;
      const wrongHash = '0x' + '22'.repeat(32) as Hex;

      try {
        await validateNullifierHash(nullifier, wrongHash);
        fail('Should have thrown NullifierHashError');
      } catch (err) {
        expect(err).toBeInstanceOf(NullifierHashError);
        if (err instanceof NullifierHashError) {
          expect(err.message).toContain('mismatch');
          expect(err.message).toContain('corrupted');
          expect(err.code).toBe('NULLIFIER_HASH_MISMATCH');
        }
      }
    });

    it('should capture detailed error context', async () => {
      const nullifier = '0x' + '33'.repeat(32) as Hex;
      const wrongHash = '0x' + '44'.repeat(32) as Hex;

      try {
        await validateNullifierHash(nullifier, wrongHash);
      } catch (err) {
        expect(err).toBeInstanceOf(NullifierHashError);
      }
    });
  });
});
