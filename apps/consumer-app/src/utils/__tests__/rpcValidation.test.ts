import {
  validateProductionRpcConfig,
  validateChainIdMatch,
  withChainIdValidation,
  RpcValidationError,
} from '../rpcValidation';

// Mock environment for tests
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('SEC-005: Production RPC Configuration Validation', () => {
  describe('validateProductionRpcConfig', () => {
    it('should throw in production when EXPO_PUBLIC_BACKEND_BASE_URL is not set', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

      expect(() => validateProductionRpcConfig()).toThrow(RpcValidationError);
      try {
        validateProductionRpcConfig();
      } catch (err) {
        expect(err).toBeInstanceOf(RpcValidationError);
        if (err instanceof RpcValidationError) {
          expect(err.code).toBe('RPC_CONFIG_MISSING');
          expect(err.message).toContain('production');
        }
      }
    });

    it('should not throw in production when backend is configured', () => {
      process.env.NODE_ENV = 'production';
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.example.com';

      // Should not throw
      expect(() => validateProductionRpcConfig()).not.toThrow();
    });

    it('should not throw in development even without backend config', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

      // Should not throw in dev
      expect(() => validateProductionRpcConfig()).not.toThrow();
    });
  });
});

describe('SEC-008: Chain ID Validation on RPC Responses', () => {
  describe('validateChainIdMatch', () => {
    it('should pass when response chainId matches expected', () => {
      // Should not throw
      validateChainIdMatch('ethereum', 1);
    });

    it('should reject when response chainId does not match', () => {
      expect(() => {
        validateChainIdMatch('ethereum', 137);
      }).toThrow(RpcValidationError);

      try {
        validateChainIdMatch('ethereum', 137);
      } catch (err) {
        expect(err).toBeInstanceOf(RpcValidationError);
        if (err instanceof RpcValidationError) {
          expect(err.code).toBe('RPC_CHAIN_ID_MISMATCH');
        }
      }
    });

    it('should detect response from completely different network', () => {
      expect(() => {
        validateChainIdMatch('ethereum', 56);
      }).toThrow(RpcValidationError);
    });

    it('should provide chain names in error message for clarity', () => {
      try {
        validateChainIdMatch('ethereum', 137);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RpcValidationError);
        if (err instanceof RpcValidationError) {
          // Error should indicate which chains were involved
          expect(err.message).toContain('ethereum');
        }
      }
    });

    it('should handle all major EVM chains', () => {
      const chainIds = { ethereum: 1, polygon: 137, arbitrum: 42161, base: 8453, sepolia: 11155111 };

      for (const [chain, chainId] of Object.entries(chainIds)) {
        // Should not throw
        validateChainIdMatch(chain, chainId);
      }
    });
  });

  describe('withChainIdValidation', () => {
    it('should pass when response chainId matches expected', async () => {
      const result = await withChainIdValidation('ethereum', async () => 1);
      expect(result).toBe(1);
    });

    it('should reject when response chainId does not match', async () => {
      await expect(
        withChainIdValidation('ethereum', async () => 137)
      ).rejects.toThrow(RpcValidationError);
    });

    it('should pass object responses with matching chainId', async () => {
      const result = await withChainIdValidation('ethereum', async () => ({
        chainId: 1,
        result: 'test',
      }));
      expect(result).toEqual({ chainId: 1, result: 'test' });
    });

    it('should reject object responses with mismatched chainId', async () => {
      await expect(
        withChainIdValidation('ethereum', async () => ({
          chainId: 137,
          result: 'test',
        }))
      ).rejects.toThrow(RpcValidationError);
    });

    it('should prevent MITM returning Polygon data for Ethereum request', async () => {
      await expect(
        withChainIdValidation('ethereum', async () => ({
          chainId: 137,
          blockNumber: '0x999999',
          balance: '100000000000000000',
        }))
      ).rejects.toThrow(RpcValidationError);
    });

    it('should prevent MITM returning Testnet response for Mainnet request', async () => {
      await expect(
        withChainIdValidation('ethereum', async () => ({
          chainId: 11155111,
          blockNumber: '0x123456',
        }))
      ).rejects.toThrow(RpcValidationError);
    });

    it('should prevent balance check on wrong chain from being accepted', async () => {
      await expect(
        withChainIdValidation('ethereum', async () => ({
          chainId: 56,
          balance: '0x0',
        }))
      ).rejects.toThrow(RpcValidationError);
    });
  });

  describe('integration scenarios', () => {
    it('should require production RPC config AND validate chain ID', () => {
      process.env.NODE_ENV = 'production';
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.example.com';

      // Config check should pass
      expect(() => validateProductionRpcConfig()).not.toThrow();

      // But response must still be validated
      expect(() => {
        validateChainIdMatch('ethereum', 56);
      }).toThrow(RpcValidationError);
    });
  });
});
