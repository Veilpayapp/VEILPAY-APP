/**
 * Security Fixes Integration Test
 *
 * End-to-end test demonstrating how SEC-004, SEC-005, and SEC-008
 * work together to secure the withdrawal flow.
 *
 * Scenario: User initiates a max-privacy withdrawal. App must:
 *   1. Validate nullifier hash matches Poseidon(nullifier) — SEC-004
 *   2. Ensure RPC is properly configured for production — SEC-005
 *   3. Verify RPC response is from correct chain — SEC-008
 */

import {
  validateNullifierHash,
  computeNullifierHash,
  NullifierHashError,
  type Hex,
} from '../nullifierHashValidation';
import {
  validateProductionRpcConfig,
  validateChainIdMatch,
  RpcValidationError,
  withChainIdValidation,
} from '../rpcValidation';

describe('Security Fixes Integration: Secure Withdrawal Flow', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.example.com';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Withdrawal Pre-Flight Checks', () => {
    /**
     * Before generating a proof, the app must:
     *   1. Load commitment from secure storage
     *   2. Validate its nullifier hash
     *   3. Check RPC configuration
     */

    it('should reject withdrawal with corrupted nullifierHash', async () => {
      const nullifier = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex;
      const corruptedHash = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex;

      // SEC-004: Validation should fail with corrupted hash
      await expect(
        validateNullifierHash(nullifier, corruptedHash)
      ).rejects.toThrow(NullifierHashError);
    });

    it('should accept withdrawal with valid nullifierHash', async () => {
      const nullifier = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex;

      // Compute correct hash
      const correctHash = await computeNullifierHash(nullifier);

      // SEC-004: Validation should pass
      await expect(
        validateNullifierHash(nullifier, correctHash)
      ).resolves.toBeUndefined();
    });

    it('should require RPC configuration in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

      // SEC-005: Configuration check should fail in production
      expect(() => {
        validateProductionRpcConfig();
      }).toThrow(RpcValidationError);
    });

    it('should accept RPC configuration in production when set', () => {
      process.env.NODE_ENV = 'production';
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.example.com';

      // SEC-005: Configuration check should pass
      expect(() => {
        validateProductionRpcConfig();
      }).not.toThrow();
    });
  });

  describe('RPC Response Validation During Withdrawal', () => {
    /**
     * App validates RPC responses for correct chain ID to prevent MITM.
     */

    it('should validate balance check RPC response for correct chain', async () => {
      // SEC-005: Config is set
      validateProductionRpcConfig();

      // SEC-008: Should validate chain ID
      const result = await withChainIdValidation('ethereum', async () => ({
        chainId: 1,
        balance: '0x0de0b6b3a7640000',
      }));

      expect(result).toBeDefined();
    });

    it('should reject balance check RPC response from wrong chain (MITM)', async () => {
      // SEC-008: Should reject when chain ID doesn't match
      await expect(
        withChainIdValidation('ethereum', async () => ({
          chainId: 56, // Wrong chain (BSC)
          balance: '0x0de0b6b3a7640000',
        }))
      ).rejects.toThrow(RpcValidationError);
    });
  });

  describe('Attack Scenarios Prevented', () => {
    it('Scenario 1: Attacker corrupts commitment record nullifierHash', async () => {
      const nullifier = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex;
      const storedHash = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex;

      // SEC-004 prevents this from being used for withdrawal
      await expect(
        validateNullifierHash(nullifier, storedHash)
      ).rejects.toThrow(NullifierHashError);
    });

    it('Scenario 2: Attacker drops backend RPC config in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

      // SEC-005 prevents silent degradation to public RPC
      expect(() => {
        validateProductionRpcConfig();
      }).toThrow(RpcValidationError);
    });

    it('Scenario 3: MITM intercepts RPC call, returns data from wrong chain', async () => {
      // SEC-008 catches wrong chain responses
      await expect(
        withChainIdValidation('ethereum', async () => ({
          chainId: 137, // Wrong chain (Polygon)
          balance: '0xde0b6b3a7640000',
        }))
      ).rejects.toThrow(RpcValidationError);
    });

    it('Scenario 4: Complete withdrawal flow validates nullifier hash', async () => {
      process.env.NODE_ENV = 'production';
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.example.com';

      const nullifier = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex;

      // Step 1: Compute and validate nullifierHash (SEC-004)
      const nullifierHash = await computeNullifierHash(nullifier);
      await validateNullifierHash(nullifier, nullifierHash);

      // Step 2: Check RPC config (SEC-005)
      validateProductionRpcConfig();

      // Step 3: Validate RPC response (SEC-008)
      const rpcResult = await withChainIdValidation('ethereum', async () => ({
        chainId: 1,
        status: '0x1',
      }));

      expect(rpcResult).toBeDefined();
      expect(nullifierHash).toMatch(/^0x[0-9a-f]{64}$/i);
    });
  });

  describe('Error Recovery and Diagnostics', () => {
    it('should provide actionable error messages for each failure', async () => {
      const errors: Record<string, string> = {};

      // SEC-004: Corrupted hash
      try {
        await validateNullifierHash(
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex,
          '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex
        );
      } catch (err) {
        errors['SEC-004'] = (err as Error).message;
      }

      // SEC-005: Missing config
      process.env.NODE_ENV = 'production';
      delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
      try {
        validateProductionRpcConfig();
      } catch (err) {
        errors['SEC-005'] = (err as Error).message;
      }

      // SEC-008: Wrong chain
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.example.com';
      try {
        validateChainIdMatch('ethereum', 56); // Wrong chain ID
      } catch (err) {
        errors['SEC-008'] = (err as Error).message;
      }

      // All errors should be clear and actionable
      expect(errors['SEC-004']).toContain('nullifier');
      expect(errors['SEC-005']).toContain('production');
      expect(errors['SEC-008']).toBeDefined();
    });
  });
});
