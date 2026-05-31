/**
 * Unit tests for formatters.ts utility functions
 */

import {
  formatFiat,
  formatChangePercent,
  getCurrencySymbol,
  formatCrypto,
  formatFeePercent,
  formatBalanceForDisplay,
  getBalanceAmount,
} from '../formatters';

describe('formatters utility tests', () => {
  describe('formatFiat', () => {
    it('formats numbers into standardized currency representation', () => {
      // Avoid raw platform locale variations in standard node by matching general shape
      const formatted = formatFiat(1234.56, 'USD');
      expect(formatted).toContain('1,234.56');
      expect(formatted).toContain('$');
    });

    it('supports alternative currencies like EUR and INR', () => {
      const formattedEur = formatFiat(500, 'EUR');
      expect(formattedEur).toContain('500.00');

      const formattedInr = formatFiat(75.25, 'INR');
      expect(formattedInr).toContain('75.25');
    });
  });

  describe('formatChangePercent', () => {
    it('returns "N/A" for null value', () => {
      expect(formatChangePercent(null)).toBe('N/A');
    });

    it('adds leading "+" sign for positive percentages', () => {
      expect(formatChangePercent(3.1415)).toBe('+3.14%');
    });

    it('handles negative and zero percentages correctly', () => {
      expect(formatChangePercent(-2.5)).toBe('-2.50%');
      expect(formatChangePercent(0)).toBe('0.00%');
    });
  });

  describe('getCurrencySymbol', () => {
    it('extracts non-numeric symbol from the formatted fiat output', () => {
      expect(getCurrencySymbol('USD')).toBe('$');
      expect(getCurrencySymbol('EUR')).toBe('€');
    });

    it('falls back to currency code if no non-numeric symbol is found', () => {
      const spy = jest.spyOn(Intl, 'NumberFormat').mockImplementation(() => ({
        format: () => '0.00'
      } as any));
      const symbol = getCurrencySymbol('XYZ' as any);
      expect(symbol).toBe('XYZ');
      spy.mockRestore();
    });
  });


  describe('formatCrypto', () => {
    it('formats crypto amount with maximum 6 decimals and trims trailing zeros', () => {
      expect(formatCrypto(1.2345678, 'ETH')).toBe('1.234568 ETH');
      expect(formatCrypto(1.200000, 'BTC')).toBe('1.2 BTC');
      expect(formatCrypto(0.0000004, 'USDC')).toBe('0 USDC');
    });
  });

  describe('formatFeePercent', () => {
    it('formats a decimal percent to one decimal place representation', () => {
      expect(formatFeePercent(2.54)).toBe('2.5%');
      expect(formatFeePercent(0)).toBe('0.0%');
    });
  });

  describe('formatBalanceForDisplay', () => {
    it('correctly handles zero balances', () => {
      expect(formatBalanceForDisplay('0')).toBe('0.00');
    });

    it('formats small microscopic numbers as "< 0.000001"', () => {
      expect(formatBalanceForDisplay('1', 18)).toBe('< 0.000001'); // 1 wei
    });

    it('formats sub-0.01 balances with up to 6 decimal precision', () => {
      // 0.005 ETH (5 * 10^15 wei)
      expect(formatBalanceForDisplay('5000000000000000', 18)).toBe('0.005000');
    });

    it('formats medium sub-1000 balances with 4 decimal precision', () => {
      // 123.456789 ETH (123456789 * 10^12 wei)
      expect(formatBalanceForDisplay('123456789000000000000', 18)).toBe('123.4568');
    });

    it('formats large balances (> 1000) using local thousands separator and max 2 decimals', () => {
      // 12345.67 ETH
      expect(formatBalanceForDisplay('12345670000000000000000', 18)).toBe('12,345.67');
    });

    it('returns "0.00" fallback under parsing exceptions', () => {
      expect(formatBalanceForDisplay('invalid-numeric-string')).toBe('0.00');
    });
  });

  describe('getBalanceAmount', () => {
    it('returns 0 for falsy or invalid balance inputs', () => {
      expect(getBalanceAmount(null)).toBe(0);
      expect(getBalanceAmount(undefined as any)).toBe(0);
      expect(getBalanceAmount('not-a-number')).toBe(0);
    });

    it('parses valid numeric strings into floats correctly', () => {
      expect(getBalanceAmount('123.45')).toBe(123.45);
      expect(getBalanceAmount('0')).toBe(0);
    });
  });
});
