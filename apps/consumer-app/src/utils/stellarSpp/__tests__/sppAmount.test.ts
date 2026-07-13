import { formatStroops, parsePositiveStroops, parseStroops } from '../sppAmount';

describe('sppAmount', () => {
  it('parses and formats 7-decimal Stellar amounts', () => {
    expect(parsePositiveStroops('1')).toBe(10_000_000n);
    expect(parsePositiveStroops('0.0000001')).toBe(1n);
    expect(formatStroops(12_345_670n)).toBe('1.234567');
  });

  it('rejects native-incompatible amount syntax', () => {
    expect(() => parsePositiveStroops('1e-7')).toThrow(/decimal/i);
    expect(() => parsePositiveStroops('0.00000001')).toThrow(/decimal/i);
    expect(() => parsePositiveStroops('Infinity')).toThrow(/decimal/i);
    expect(() => parsePositiveStroops('-1')).toThrow(/decimal/i);
    expect(() => parsePositiveStroops('0')).toThrow(/positive/i);
  });

  it('allows zero only for non-positive validation helpers', () => {
    expect(parseStroops('0')).toBe(0n);
  });
});
