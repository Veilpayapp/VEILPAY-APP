import {
  isProviderSupported,
  filterSupportedQuotes,
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

    it('returns false for any provider + aptos', () => {
      for (const [id] of PROVIDER_MATRIX) {
        expect(isProviderSupported(id, 'aptos', 'USD')).toBe(false);
      }
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

    it('filters out unsupported providers (stripe)', () => {
      const result = filterSupportedQuotes(quotes, 'ethereum', 'USD');
      expect(result.map((q) => q.provider)).toEqual([
        'onramp_money',
        'moonpay',
        'transak',
      ]);
    });

    it('filters all providers for unsupported chain (aptos)', () => {
      const result = filterSupportedQuotes(quotes, 'aptos', 'USD');
      expect(result).toEqual([]);
    });

    it('returns empty for unsupported currency', () => {
      // TRY is only supported by onramp_money
      const result = filterSupportedQuotes(quotes, 'ethereum', 'TRY');
      expect(result.map((q) => q.provider)).toEqual(['onramp_money']);
    });
  });
});
