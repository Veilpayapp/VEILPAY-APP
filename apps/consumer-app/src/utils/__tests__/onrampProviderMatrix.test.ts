import {
  isProviderSupported,
  filterSupportedQuotes,
  getSupportedTokens,
  isTokenSupported,
  PROVIDER_MATRIX,
} from '../onrampProviderMatrix';

describe('onrampProviderMatrix', () => {
  describe('isProviderSupported', () => {
    it('returns true for onramp_money + ethereum + INR', () => {
      expect(isProviderSupported('onramp_money', 'ethereum', 'INR')).toBe(true);
    });

    it('returns true for moonpay + polygon + USD', () => {
      expect(isProviderSupported('moonpay', 'polygon', 'USD')).toBe(true);
    });

    it('returns true for transak + solana + EUR', () => {
      expect(isProviderSupported('transak', 'solana', 'EUR')).toBe(true);
    });

    it('returns false for any provider + stellar', () => {
      for (const [id] of PROVIDER_MATRIX) {
        expect(isProviderSupported(id, 'stellar', 'USD')).toBe(false);
      }
    });

    it('returns false for any provider + sepolia (testnet)', () => {
      for (const [id] of PROVIDER_MATRIX) {
        expect(isProviderSupported(id, 'sepolia', 'USD')).toBe(false);
      }
    });

    it('returns false for unknown provider', () => {
      expect(isProviderSupported('stripe', 'ethereum', 'USD')).toBe(false);
    });

    it('is case-insensitive for chainKey', () => {
      expect(isProviderSupported('moonpay', 'Ethereum', 'USD')).toBe(true);
    });

    it('is case-insensitive for fiatCurrency', () => {
      expect(isProviderSupported('moonpay', 'ethereum', 'usd')).toBe(true);
    });
  });

  describe('filterSupportedQuotes', () => {
    const quotes = [
      { provider: 'onramp_money', amount: '1.0' },
      { provider: 'moonpay', amount: '0.98' },
      { provider: 'transak', amount: '0.97' },
      { provider: 'stripe', amount: '0.99' },
    ];

    it('filters out unsupported providers (stripe + onramp_money on USD)', () => {
      // onramp_money is INR-only by design, so it is excluded for USD alongside
      // the unknown 'stripe' provider.
      const result = filterSupportedQuotes(quotes, 'ethereum', 'USD');
      expect(result.map((q) => q.provider)).toEqual([
        'moonpay',
        'transak',
      ]);
    });

    it('keeps all known providers for INR (the only currency onramp_money supports)', () => {
      const result = filterSupportedQuotes(quotes, 'ethereum', 'INR');
      expect(result.map((q) => q.provider)).toEqual([
        'onramp_money',
        'moonpay',
        'transak',
      ]);
    });

    it('filters all providers for unsupported chain (stellar)', () => {
      const result = filterSupportedQuotes(quotes, 'stellar', 'USD');
      expect(result).toEqual([]);
    });

    it('returns empty for a currency no provider supports (TRY)', () => {
      const result = filterSupportedQuotes(quotes, 'ethereum', 'TRY');
      expect(result.map((q) => q.provider)).toEqual([]);
    });
  });

  describe('getSupportedTokens', () => {
    it('always lists the native symbol first', () => {
      expect(getSupportedTokens('moonpay', 'ethereum', 'ETH')[0]).toBe('ETH');
      expect(getSupportedTokens('transak', 'polygon', 'MATIC')[0]).toBe('MATIC');
    });

    it('appends the provider stablecoins for the chain', () => {
      expect(getSupportedTokens('onramp_money', 'ethereum', 'ETH')).toEqual([
        'ETH',
        'USDC',
        'USDT',
      ]);
    });

    it('reflects a provider that omits USDT on a chain (moonpay + base)', () => {
      expect(getSupportedTokens('moonpay', 'base', 'ETH')).toEqual(['ETH', 'USDC']);
    });

    it('returns native-only for an unknown provider', () => {
      expect(getSupportedTokens('stripe', 'ethereum', 'ETH')).toEqual(['ETH']);
    });

    it('uppercases and de-duplicates the native symbol', () => {
      // Native passed lowercase, and a stablecoin list that would collide stays unique.
      expect(getSupportedTokens('onramp_money', 'ethereum', 'eth')).toEqual([
        'ETH',
        'USDC',
        'USDT',
      ]);
    });
  });

  describe('isTokenSupported', () => {
    it('is always true for the native token', () => {
      expect(isTokenSupported('moonpay', 'base', 'ETH', 'ETH')).toBe(true);
      expect(isTokenSupported('transak', 'polygon', 'MATIC', 'MATIC')).toBe(true);
    });

    it('is true for a stablecoin the provider sells on the chain', () => {
      expect(isTokenSupported('onramp_money', 'base', 'USDT', 'ETH')).toBe(true);
      expect(isTokenSupported('moonpay', 'ethereum', 'USDT', 'ETH')).toBe(true);
    });

    it('is false for a stablecoin the provider omits on the chain', () => {
      // MoonPay & Transak do not list USDT on Base.
      expect(isTokenSupported('moonpay', 'base', 'USDT', 'ETH')).toBe(false);
      expect(isTokenSupported('transak', 'base', 'USDT', 'ETH')).toBe(false);
    });

    it('is case-insensitive for the token symbol and chain', () => {
      expect(isTokenSupported('moonpay', 'Ethereum', 'usdt', 'ETH')).toBe(true);
    });

    it('is false for an unknown provider stablecoin', () => {
      expect(isTokenSupported('stripe', 'ethereum', 'USDC', 'ETH')).toBe(false);
    });
  });
});
