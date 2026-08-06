import { sanitizeContextForSentry, redactSensitiveValue } from '../sentrySanitizer';

describe('sentrySanitizer', () => {
  describe('sanitizeContextForSentry', () => {
    it('removes sensitive keys', () => {
      const context = {
        mnemonic: 'twelve word recovery phrase here now',
        privateKey: '0x1234567890abcdef',
        operation: 'send_payment',
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.mnemonic).toBeUndefined();
      expect(sanitized.privateKey).toBeUndefined();
      expect(sanitized.operation).toBe('send_payment');
    });

    it('removes keys like secret, key, token, seed', () => {
      const context = {
        secret: 'super secret value',
        key: 'some key',
        token: 'auth token',
        seed: 'seed phrase',
        nullifier: 'nullifier value',
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.secret).toBeUndefined();
      expect(sanitized.key).toBeUndefined();
      expect(sanitized.token).toBeUndefined();
      expect(sanitized.seed).toBeUndefined();
      expect(sanitized.nullifier).toBeUndefined();
    });

    it('redacts hex strings (0x prefix)', () => {
      const context = {
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef',
        data: 'some normal data',
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.txHash).toBe('[REDACTED]');
      expect(sanitized.data).toBe('some normal data');
    });

    it('redacts very long strings (>256 chars)', () => {
      const context = {
        longString: 'x'.repeat(300),
        normalString: 'short',
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.longString).toBe('[REDACTED]');
      expect(sanitized.normalString).toBe('short');
    });

    it('redacts mnemonic-like strings (12+ space-separated words)', () => {
      const context = {
        phrase: 'apple banana cherry date elder fig grape honey iris jazz kiwi lemon',
        words: 'just three words',
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.phrase).toBe('[REDACTED]');
      expect(sanitized.words).toBe('just three words');
    });

    it('allows safe keys like chain, chainKey, operation, txHash, scope', () => {
      const context = {
        chain: 'ethereum',
        chainKey: 'ethereum',
        operation: 'send',
        txHash: '0x' + 'a'.repeat(64),
        scope: 'wallet',
        screen: 'SendPaymentScreen',
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.chain).toBe('ethereum');
      expect(sanitized.chainKey).toBe('ethereum');
      expect(sanitized.operation).toBe('send');
      expect(sanitized.scope).toBe('wallet');
    });

    it('handles nested objects', () => {
      const context = {
        operation: 'send',
        error: {
          message: 'Failed to send',
          code: 'SEND_FAILED',
          mnemonic: 'secret phrase here',
        },
        amount: '100',
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.operation).toBe('send');
      expect(sanitized.amount).toBe('100');
      expect((sanitized.error as any).message).toBe('Failed to send');
      expect((sanitized.error as any).code).toBe('SEND_FAILED');
      expect((sanitized.error as any).mnemonic).toBeUndefined();
    });

    it('handles arrays', () => {
      const context = {
        addresses: ['0x1234567890abcdef', 'normal value'],
        items: [{ id: 1 }, { id: 2, secret: 'value' }],
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(Array.isArray(sanitized.addresses)).toBe(true);
      expect((sanitized.addresses as any)[0]).toBe('[REDACTED]');
      expect((sanitized.addresses as any)[1]).toBe('normal value');
      expect((sanitized.items as any)[0]).toEqual({ id: 1 });
      expect((sanitized.items as any)[1].secret).toBeUndefined();
    });

    it('handles null and undefined values', () => {
      const context = {
        nullValue: null,
        undefinedValue: undefined,
        operation: 'send',
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.nullValue).toBeNull();
      expect(sanitized.undefinedValue).toBeUndefined();
      expect(sanitized.operation).toBe('send');
    });

    it('returns empty object for undefined or non-object input', () => {
      expect(sanitizeContextForSentry(undefined)).toEqual({});
      expect(sanitizeContextForSentry(null as any)).toEqual({});
      expect(sanitizeContextForSentry('string' as any)).toEqual({});
    });

    it('case-insensitive key matching for sensitive keys', () => {
      const context = {
        MNEMONIC: 'value',
        PrivateKey: 'value',
        TOKEN: 'value',
        operation: 'send',
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.MNEMONIC).toBeUndefined();
      expect(sanitized.PrivateKey).toBeUndefined();
      expect(sanitized.TOKEN).toBeUndefined();
      expect(sanitized.operation).toBe('send');
    });

    it('handles complex real-world error context', () => {
      const context = {
        screen: 'SendPaymentScreen',
        operation: 'send_transaction',
        chainKey: 'ethereum',
        recipient: '0x' + 'a'.repeat(40),
        amount: '1.5',
        gasEstimate: '0x' + 'b'.repeat(64),
        errorMessage: 'Insufficient gas',
        privateKey: '0x' + 'c'.repeat(64),
        mnemonic: 'twelve word recovery phrase ...',
        metadata: {
          txHash: '0x' + 'd'.repeat(64),
          blockNumber: 12345,
          gasPrice: '50',
        },
      };

      const sanitized = sanitizeContextForSentry(context);
      expect(sanitized.screen).toBe('SendPaymentScreen');
      expect(sanitized.operation).toBe('send_transaction');
      expect(sanitized.chainKey).toBe('ethereum');
      expect(sanitized.amount).toBe('1.5');
      expect(sanitized.errorMessage).toBe('Insufficient gas');
      expect(sanitized.privateKey).toBeUndefined();
      expect(sanitized.mnemonic).toBeUndefined();
      expect(sanitized.recipient).toBe('[REDACTED]');
      expect(sanitized.gasEstimate).toBe('[REDACTED]');
      expect((sanitized.metadata as any).blockNumber).toBe(12345);
      expect((sanitized.metadata as any).gasPrice).toBe('50');
      expect((sanitized.metadata as any).txHash).toBe('[REDACTED]');
    });
  });

  describe('redactSensitiveValue', () => {
    it('redacts hex strings', () => {
      expect(redactSensitiveValue('0x1234567890abcdef')).toBe('[REDACTED]');
    });

    it('redacts long strings', () => {
      expect(redactSensitiveValue('x'.repeat(300))).toBe('[REDACTED]');
    });

    it('does not redact normal values', () => {
      expect(redactSensitiveValue('normal value')).toBe('normal value');
      expect(redactSensitiveValue('ethereum')).toBe('ethereum');
    });

    it('redacts mnemonic-like strings', () => {
      expect(
        redactSensitiveValue('apple banana cherry date elder fig grape honey iris jazz kiwi lemon')
      ).toBe('[REDACTED]');
    });

    it('does not redact short word lists', () => {
      expect(redactSensitiveValue('apple banana cherry')).toBe('apple banana cherry');
    });
  });
});
