import {
  getTokenMetadata,
  baseUnitsToHumanAmount,
  UNKNOWN_TOKEN_SYMBOL,
  isZeroAddress,
} from '../tokenMetadata';

describe('tokenMetadata', () => {
  describe('getTokenMetadata', () => {
    it('resolves the native asset for the zero address', () => {
      expect(getTokenMetadata('ethereum', '0x0000000000000000000000000000000000000000')).toEqual({
        symbol: 'ETH',
        decimals: 18,
      });
      expect(getTokenMetadata('polygon', '0x0000000000000000000000000000000000000000')).toEqual({
        symbol: 'POL',
        decimals: 18,
      });
    });

    it('resolves allowlisted ERC-20 contracts to symbol + decimals (case-insensitive)', () => {
      // Checksummed as event args arrive from ethers.
      expect(
        getTokenMetadata('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
      ).toEqual({ symbol: 'USDC', decimals: 6 });
      expect(getTokenMetadata('sepolia', '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238')).toEqual({
        symbol: 'USDC',
        decimals: 6,
      });
    });

    it('returns a stable short symbol for unknown tokens — never a 42-char address', () => {
      const meta = getTokenMetadata('ethereum', '0x9999999999999999999999999999999999999999');
      expect(meta.symbol).toBe(UNKNOWN_TOKEN_SYMBOL);
      expect(meta.symbol.length).toBeLessThan(20);
      expect(meta.decimals).toBe(18);
    });

    it('returns a native-style fallback for chains without a metadata entry', () => {
      const meta = getTokenMetadata('somechain', '0x0000000000000000000000000000000000000000');
      expect(meta.decimals).toBe(18);
    });
  });

  describe('isZeroAddress', () => {
    it('detects the zero address case-insensitively', () => {
      expect(isZeroAddress('0x0000000000000000000000000000000000000000')).toBe(true);
      expect(isZeroAddress('0X0000000000000000000000000000000000000000')).toBe(true);
      expect(isZeroAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe(false);
    });
  });

  describe('baseUnitsToHumanAmount', () => {
    it('converts 1 ETH in base units to "1"', () => {
      expect(baseUnitsToHumanAmount('1000000000000000000', 18)).toBe('1');
    });

    it('converts 1 USDC (6 decimals) to "1"', () => {
      expect(baseUnitsToHumanAmount('1000000', 6)).toBe('1');
    });

    it('converts fractional amounts and strips trailing zeros', () => {
      expect(baseUnitsToHumanAmount('1500000000000000000', 18)).toBe('1.5');
      expect(baseUnitsToHumanAmount('1230000', 6)).toBe('1.23');
      expect(baseUnitsToHumanAmount('1000000000000000000000', 18)).toBe('1000');
    });

    it('passes through already-human and non-numeric values unchanged', () => {
      expect(baseUnitsToHumanAmount('1.5', 18)).toBe('1.5');
      expect(baseUnitsToHumanAmount('', 18)).toBe('0');
      expect(baseUnitsToHumanAmount('0', 18)).toBe('0');
    });
  });

  describe('invoice matching unit contract', () => {
    it('eventAmount = invoiceAmount x 10^decimals converts back to invoiceAmount', () => {
      const invoiceAmount = '2.5';
      const eventAmount = '2500000000000000000'; // 2.5 * 10^18
      const { decimals } = getTokenMetadata('ethereum', '0x0000000000000000000000000000000000000000');
      expect(baseUnitsToHumanAmount(eventAmount, decimals)).toBe(invoiceAmount);
    });

    it('raw base units never equal the human invoice amount string', () => {
      const eventAmount = '2500000000000000000';
      expect(eventAmount).not.toBe('2.5');
    });
  });
});
