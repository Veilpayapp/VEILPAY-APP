/**
 * Deep-Link Validator Tests
 * Tests for deep-link payment validation, rate limiting, and security checks.
 */

import {
  validateDeepLinkPayment,
  deepLinkRateLimiter,
  formatDeepLinkError,
  createDeepLinkSecurityWarning,
  DeepLinkPaymentSchema,
} from '../deepLinkValidator';

describe('deepLinkValidator', () => {
  beforeEach(() => {
    deepLinkRateLimiter.clear();
  });

  describe('validateDeepLinkPayment', () => {
    describe('recipient validation', () => {
      it('accepts valid EVM address (lowercase)', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634C0532925a3b844Bc9e7595f42bB',
          amount: 1.5,
        });
        expect(result.valid).toBe(true);
        expect(result.payment?.recipient).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f42bB'.toLowerCase());
      });

      it('rejects invalid EVM address (wrong length)', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35Cc6634C0532925a3b844Bc9e7595f42b',
          amount: 1.5,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid');
      });

      it('accepts all-lowercase EVM address without checksum validation', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 1.5,
        });
        expect(result.valid).toBe(true);
      });

      it('accepts all-uppercase EVM address', () => {
        const result = validateDeepLinkPayment({
          address: '0x742D35CC6634C0532925A3B844BC9E7595F42BB',
          amount: 1.5,
        });
        expect(result.valid).toBe(true);
      });

      it('accepts valid Solana address', () => {
        const result = validateDeepLinkPayment({
          address: '11111111111111111111111111111112',
          amount: 1.5,
        });
        expect(result.valid).toBe(true);
      });

      it('accepts valid Stellar address', () => {
        const result = validateDeepLinkPayment({
          address: 'GBJCHUKZMTFSLOMNC7P4TS4VJJBTCYL3G7G6P7TXVJ7LKS2THJBXYYZC',
          amount: 1.5,
        });
        expect(result.valid).toBe(true);
      });

      it('rejects empty recipient', () => {
        const result = validateDeepLinkPayment({
          address: '',
          amount: 1.5,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Recipient');
      });

      it('rejects non-address strings', () => {
        const result = validateDeepLinkPayment({
          address: 'not-an-address',
          amount: 1.5,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid');
      });
    });

    describe('amount validation', () => {
      it('accepts positive amount', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 1.5,
        });
        expect(result.valid).toBe(true);
        expect(result.payment?.amount).toBe(1.5);
      });

      it('accepts string amount', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: '42.5',
        });
        expect(result.valid).toBe(true);
        expect(result.payment?.amount).toBe(42.5);
      });

      it('rejects zero amount', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 0,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('greater than 0');
      });

      it('rejects negative amount', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: -1.5,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('greater than 0');
      });

      it('rejects non-finite amount', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: Infinity,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('finite');
      });

      it('rejects amount exceeding max', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 1e16,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('exceeds maximum');
      });

      it('accepts amount near max limit', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 1e15,
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('user balance check', () => {
      it('rejects amount exceeding user balance', () => {
        const result = validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 100,
          },
          { userBalance: 50 }
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Insufficient balance');
      });

      it('accepts amount within user balance', () => {
        const result = validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 50,
          },
          { userBalance: 100 }
        );
        expect(result.valid).toBe(true);
      });

      it('skips balance check if userBalance not provided', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 999999,
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('rate limiting', () => {
      it('allows first payment', () => {
        const result = validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 1,
          },
          { userId: 'user123' }
        );
        expect(result.valid).toBe(true);
      });

      it('rejects second payment within 5 seconds', () => {
        validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 1,
          },
          { userId: 'user123' }
        );

        const result = validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 2,
          },
          { userId: 'user123' }
        );
        expect(result.valid).toBe(false);
        expect(result.error).toContain('rate-limited');
      });

      it('provides remaining wait time in rate limit error', () => {
        validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 1,
          },
          { userId: 'user123' }
        );

        const result = validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 2,
          },
          { userId: 'user123' }
        );
        expect(result.error).toMatch(/wait \d+s/);
      });

      it('allows different users to pay simultaneously', () => {
        const result1 = validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 1,
          },
          { userId: 'user1' }
        );
        const result2 = validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 1,
          },
          { userId: 'user2' }
        );
        expect(result1.valid).toBe(true);
        expect(result2.valid).toBe(true);
      });

      it('skips rate limit if userId not provided', () => {
        validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 1,
        });

        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 2,
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('chain type warnings', () => {
      it('warns when EVM address used on non-EVM chain', () => {
        const result = validateDeepLinkPayment(
          {
            address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
            amount: 1,
          },
          { chainType: 'xlm' }
        );
        expect(result.valid).toBe(true);
        expect(result.warnings).toContain(expect.stringContaining('EVM address'));
      });

      it('warns when Stellar address used on non-Stellar chain', () => {
        const result = validateDeepLinkPayment(
          {
            address: 'GBJCHUKZMTFSLOMNC7P4TS4VJJBTCYL3G7G6P7TXVJ7LKS2THJBXYYZC',
            amount: 1,
          },
          { chainType: 'evm' }
        );
        expect(result.valid).toBe(true);
        expect(result.warnings).toContain(expect.stringContaining('Stellar address'));
      });
    });

    describe('token validation', () => {
      it('accepts valid token symbol', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 1,
          token: 'USDC',
        });
        expect(result.valid).toBe(true);
        expect(result.payment?.token).toBe('USDC');
      });

      it('accepts optional token', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 1,
        });
        expect(result.valid).toBe(true);
      });

      it('rejects invalid token symbols', () => {
        const result = validateDeepLinkPayment({
          address: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
          amount: 1,
          token: 'INVALID!@#',
        });
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('deepLinkRateLimiter', () => {
    it('allows first request', () => {
      const check = deepLinkRateLimiter.check('user1');
      expect(check.allowed).toBe(true);
      expect(check.remainingWaitMs).toBeUndefined();
    });

    it('denies second request within window', () => {
      deepLinkRateLimiter.check('user1');
      const check = deepLinkRateLimiter.check('user1');
      expect(check.allowed).toBe(false);
      expect(check.remainingWaitMs).toBeDefined();
      expect(check.remainingWaitMs).toBeGreaterThan(0);
      expect(check.remainingWaitMs).toBeLessThanOrEqual(5000);
    });

    it('resets user rate limit', () => {
      deepLinkRateLimiter.check('user1');
      deepLinkRateLimiter.reset('user1');
      const check = deepLinkRateLimiter.check('user1');
      expect(check.allowed).toBe(true);
    });

    it('clears all rate limits', () => {
      deepLinkRateLimiter.check('user1');
      deepLinkRateLimiter.check('user2');
      deepLinkRateLimiter.clear();
      expect(deepLinkRateLimiter.check('user1').allowed).toBe(true);
      expect(deepLinkRateLimiter.check('user2').allowed).toBe(true);
    });
  });

  describe('formatDeepLinkError', () => {
    it('redacts hex strings', () => {
      const error = 'Payment to 0xabcdef1234567890abcdef1234567890abcdef12 failed';
      const formatted = formatDeepLinkError(error);
      expect(formatted).toContain('[redacted]');
      expect(formatted).not.toContain('0xabcdef');
    });

    it('preserves non-hex error messages', () => {
      const error = 'Insufficient balance';
      const formatted = formatDeepLinkError(error);
      expect(formatted).toBe('Insufficient balance');
    });
  });

  describe('createDeepLinkSecurityWarning', () => {
    it('creates formatted warning with recipient shorthand', () => {
      const warning = createDeepLinkSecurityWarning(
        '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
        100,
        'USDC'
      );
      expect(warning).toContain('0x742d');
      expect(warning).toContain('f42b');
      expect(warning).toContain('100 USDC');
      expect(warning).toContain('deep link');
    });

    it('handles recipient without token', () => {
      const warning = createDeepLinkSecurityWarning(
        '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
        50
      );
      expect(warning).toContain('50');
      expect(warning).not.toContain('undefined');
    });
  });

  describe('DeepLinkPaymentSchema', () => {
    it('validates complete payment object', () => {
      const data = {
        recipient: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
        amount: 1.5,
        token: 'USDC',
        chainKey: 'ethereum',
      };
      expect(() => DeepLinkPaymentSchema.parse(data)).not.toThrow();
    });

    it('allows minimal payment object', () => {
      const data = {
        recipient: '0x742d35cc6634c0532925a3b844bc9e7595f42bb',
        amount: 1.5,
      };
      expect(() => DeepLinkPaymentSchema.parse(data)).not.toThrow();
    });
  });
});
