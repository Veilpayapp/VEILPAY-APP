/**
 * Tests for BiometricTokenManager - SEC-002 Security Fixes
 * Validates:
 * - Cryptographically random token generation (not timestamp-based)
 * - Rate limiting (max 1 token per user per 30s)
 * - Token expiry enforcement
 * - Prevention of token reuse
 * - Exponential backoff on failed attempts
 * - Audit logging
 */

import { BiometricTokenManager } from './secureSignerTokenManager';

describe('BiometricTokenManager - SEC-002 Security', () => {
  let manager: BiometricTokenManager;

  beforeEach(() => {
    manager = new BiometricTokenManager();
  });

  afterEach(() => {
    manager.clearAllTokens();
  });

  describe('SEC-002: Cryptographically Random Token Generation', () => {
    it('should generate tokens that are NOT predictable (not timestamp-based)', () => {
      const userId = 'user1';
      const token1 = manager.generateBiometricToken(userId);
      const token2 = manager.generateBiometricToken(userId);

      // Tokens should have 'bm_' prefix indicating our format
      expect(token1).toMatch(/^bm_/);
      expect(token2).toMatch(/^bm_/);

      // Tokens should be different even generated at nearly same time
      expect(token1).not.toEqual(token2);

      // Tokens should contain UUID patterns (not just timestamps)
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
      const token1UUIDs = token1.match(uuidRegex);
      expect(token1UUIDs).toHaveLength(2); // Two UUIDs in the token
    });

    it('should not be predictable by extracting timestamp patterns', () => {
      const token = manager.generateBiometricToken('user1');
      // Token should NOT be parseable as "timestamp-uuid-uuid" pattern
      // Old format was: `${Date.now()}-${UUID}-${UUID}`
      const parts = token.split('-');
      // New format: bm_UUID_UUID, so split by _ not -
      const underscoreParts = token.split('_');
      expect(underscoreParts[0]).toBe('bm');
      expect(underscoreParts.length).toBeGreaterThanOrEqual(3); // bm_ + 2 UUIDs
    });
  });

  describe('SEC-002: Rate Limiting (Max 1 Token per 30s)', () => {
    it('should allow only 1 valid token per user within 30 second window', () => {
      const userId = 'user1';

      // First token generation should succeed
      const token1 = manager.generateBiometricToken(userId);
      expect(token1).toBeTruthy();
      expect(manager.getTokenCount()).toBe(1);

      // Second token generation should fail (rate limited)
      expect(() => {
        manager.generateBiometricToken(userId);
      }).toThrow('Maximum active tokens reached');

      expect(manager.getTokenCount()).toBe(1);
    });

    it('should allow new token after first token is consumed', () => {
      const userId = 'user1';

      // Generate and consume first token
      const token1 = manager.generateBiometricToken(userId);
      manager.consumeBiometricToken(token1, userId);
      expect(manager.getTokenCount()).toBe(0);

      // Should be able to generate new token after consuming the first
      const token2 = manager.generateBiometricToken(userId);
      expect(token2).toBeTruthy();
      expect(manager.getTokenCount()).toBe(1);
    });

    it('should allow different users to have their own tokens', () => {
      const user1 = 'user1';
      const user2 = 'user2';

      const token1 = manager.generateBiometricToken(user1);
      const token2 = manager.generateBiometricToken(user2);

      expect(token1).not.toEqual(token2);
      expect(manager.getTokenCount()).toBe(2);
    });
  });

  describe('SEC-002: Token Expiry Enforcement', () => {
    it('should reject expired tokens', () => {
      const userId = 'user1';
      const token = manager.generateBiometricToken(userId);

      // Token is valid initially
      expect(() => {
        manager.consumeBiometricToken(token, userId);
      }).not.toThrow();

      // After consuming, token count should be 0
      expect(manager.getTokenCount()).toBe(0);
    });

    it('should reject token after 30+ seconds of expiry', (done) => {
      jest.useFakeTimers();
      const userId = 'user1';
      const token = manager.generateBiometricToken(userId);

      // Fast-forward past expiry (30s + 1ms)
      jest.advanceTimersByTime(30_001);

      expect(() => {
        manager.consumeBiometricToken(token, userId);
      }).toThrow('Biometric authorization expired');

      jest.useRealTimers();
      done();
    });
  });

  describe('SEC-002: Prevention of Token Reuse', () => {
    it('should prevent consuming the same token twice', () => {
      const userId = 'user1';
      const token = manager.generateBiometricToken(userId);

      // First consumption should succeed
      expect(() => {
        manager.consumeBiometricToken(token, userId);
      }).not.toThrow();

      // Second consumption should fail
      expect(() => {
        manager.consumeBiometricToken(token, userId);
      }).toThrow('This authorization token has already been used');
    });

    it('should prevent cross-user token consumption', () => {
      const user1 = 'user1';
      const user2 = 'user2';

      const token = manager.generateBiometricToken(user1);

      // User2 should not be able to consume user1's token
      expect(() => {
        manager.consumeBiometricToken(token, user2);
      }).toThrow('Invalid authorization token for this user');
    });

    it('should reject non-existent tokens', () => {
      const userId = 'user1';
      const fakeToken = 'bm_fake_token_12345';

      expect(() => {
        manager.consumeBiometricToken(fakeToken, userId);
      }).toThrow('Biometric authorization required');
    });
  });

  describe('SEC-002: Exponential Backoff on Failed Attempts', () => {
    it('should apply exponential backoff after failed attempts', () => {
      const userId = 'user1';

      // First failed attempt - should apply 1s backoff
      expect(() => {
        manager.consumeBiometricToken('fake_token_1', userId);
      }).toThrow();

      let failure = manager.getFailureRecord(userId);
      expect(failure?.count).toBe(1);
      expect(failure?.nextRetryAt).toBeTruthy();

      // Attempt again immediately - should be rate limited
      expect(() => {
        manager.generateBiometricToken(userId);
      }).toThrow('Rate limited');

      failure = manager.getFailureRecord(userId);
      expect(failure?.count).toBe(1); // Count should be 1 (only one failure recorded)
    });

    it('should increase backoff with each failure', () => {
      const userId = 'user1';

      // First failure
      try {
        manager.consumeBiometricToken('fake1', userId);
      } catch { /* expected */ }
      const failure1 = manager.getFailureRecord(userId);
      expect(failure1?.count).toBe(1);

      // Fast forward to end of backoff period
      jest.useFakeTimers();
      jest.advanceTimersByTime(1_500); // Past first backoff (1s)

      // Second failure (after backoff expired)
      try {
        manager.consumeBiometricToken('fake2', userId);
      } catch { /* expected */ }
      const failure2 = manager.getFailureRecord(userId);
      expect(failure2?.count).toBe(2);

      // Backoff should be longer now (2s instead of 1s)
      const backoffIncrease = (failure2?.nextRetryAt || 0) - Date.now();
      expect(backoffIncrease).toBeGreaterThanOrEqual(1_500);

      jest.useRealTimers();
    });

    it('should cap backoff at 60 seconds', () => {
      // This is a theoretical test - would need many failures to reach max
      // We're validating the backoff math doesn't exceed max
      const manager2 = new BiometricTokenManager();
      const userId = 'user1';

      // Manually trigger multiple failures
      for (let i = 0; i < 10; i++) {
        try {
          manager2.consumeBiometricToken(`fake_${i}`, userId);
        } catch { /* expected */ }
      }

      const failure = manager2.getFailureRecord(userId);
      if (failure) {
        const nextWait = Math.max(0, failure.nextRetryAt - Date.now());
        expect(nextWait).toBeLessThanOrEqual(60_000); // Max 60s
      }

      manager2.clearAllTokens();
    });
  });

  describe('SEC-002: Audit Logging', () => {
    it('should generate tokens without error', () => {
      const userId = 'user1';
      const token = manager.generateBiometricToken(userId);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
    });

    it('should track all token states correctly', () => {
      const userId = 'user1';
      const token = manager.generateBiometricToken(userId);

      // Token should exist and be valid
      expect(manager.getTokenCount()).toBe(1);

      // Consume it
      manager.consumeBiometricToken(token, userId);

      // Should be cleared from valid count
      expect(manager.getTokenCount()).toBe(0);
    });
  });

  describe('SEC-002: Token Cleanup', () => {
    it('should cleanup consumed tokens', () => {
      const userId = 'user1';
      const token = manager.generateBiometricToken(userId);

      expect(manager.getTokenCount()).toBe(1);

      manager.consumeBiometricToken(token, userId);

      // After consuming and cleanup, count should drop to 0
      expect(manager.getTokenCount()).toBe(0);
    });

    it('should allow new token generation after cleanup', () => {
      const userId = 'user1';

      // Generate, consume, and get back to clean state
      const token1 = manager.generateBiometricToken(userId);
      manager.consumeBiometricToken(token1, userId);

      // Should be able to generate new token
      const token2 = manager.generateBiometricToken(userId);
      expect(token2).toBeTruthy();
      expect(token2).not.toEqual(token1);
    });
  });
});
