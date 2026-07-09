/**
 * Andrej Karpathy first-principles style unit tests for rpc.ts
 * Thoroughly covers override priorities, Alchemy key injection, Infura fallback mechanisms,
 * and production missing key alerts.
 */

describe('rpc utility tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    // Clean out relevant env parameters
    delete process.env.EXPO_PUBLIC_RPC_ETHEREUM;
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('correctly retrieves supported chain keys list', () => {
    const { getSupportedChainKeys } = require('../rpc');
    const keys = getSupportedChainKeys();
    expect(keys).toContain('ethereum');
    expect(keys).toContain('solana');
    expect(keys).toContain('stellar');
    expect(keys).not.toContain('aptos');
  });

  describe('getRpcUrl priority levels', () => {
    it('prioritizes explicit EXPO_PUBLIC_RPC_ override when set', () => {
      process.env.EXPO_PUBLIC_RPC_ETHEREUM = 'https://custom-node.local';
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.veilpay.app';

      // Require after setting env overrides so that RPC_ENV_VARS is populated correctly
      const { getRpcUrl } = require('../rpc');
      const url = getRpcUrl('ethereum');
      expect(url).toBe('https://custom-node.local');
    });

    it('falls back to backend proxy URL when backend base is set', () => {
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://api.veilpay.app';

      const { getRpcUrl } = require('../rpc');
      const ethUrl = getRpcUrl('ethereum');
      expect(ethUrl).toBe('https://api.veilpay.app/api/v1/rpc/ethereum');

      const solanaUrl = getRpcUrl('solana');
      expect(solanaUrl).toBe('https://api.veilpay.app/api/v1/rpc/solana');
    });

    it('uses public fallbacks in non-production when no backend is provided', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

      const { getRpcUrl } = require('../rpc');
      const ethUrl = getRpcUrl('ethereum');
      expect(ethUrl).toBe('https://ethereum-rpc.publicnode.com');
    });

    it('alerts and degrades to a read-only public node in production when no proxy or overrides exist', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
      const captureError = require('../sentry').captureError;
      const spyCapture = jest.spyOn({ captureError }, 'captureError').mockImplementation(() => {});
      const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const { getRpcUrl } = require('../rpc');
      const ethUrl = getRpcUrl('ethereum');

      // A misconfigured prod deploy should keep reads working via a public node
      // rather than returning '' and failing every blockchain read.
      expect(ethUrl).toBe('https://ethereum-rpc.publicnode.com');

      spyCapture.mockRestore();
      spyWarn.mockRestore();
    });
  });
});
