import { amountsMatch, normalizeAmountString } from '../chainIndexer';

describe('chainIndexer amount normalize (REL-001 / PERF-002)', () => {
  it('normalizes trailing zeros', () => {
    expect(normalizeAmountString('1.0')).toBe('1');
    expect(normalizeAmountString('1.00')).toBe('1');
    expect(normalizeAmountString('1.10')).toBe('1.1');
    expect(normalizeAmountString('01.50')).toBe('1.5');
  });

  it('matches equivalent amount forms', () => {
    expect(amountsMatch('1.0', '1')).toBe(true);
    expect(amountsMatch('10.00', '10')).toBe(true);
    expect(amountsMatch('1.01', '1.010')).toBe(true);
    expect(amountsMatch('2', '2.0')).toBe(true);
    expect(amountsMatch('1', '2')).toBe(false);
  });
});
