import {
  addressSchema,
  solanaAddressSchema,
  txHashSchema,
  solanaTxHashSchema,
  tokenAmountSchema,
  feeEstimateSchema,
  numericAmountSchema,
} from '../types';

// ─── addressSchema (Ethereum) ──────────────────────────────────────────────────

describe('addressSchema', () => {
  it('accepts valid lowercase EVM address', () => {
    expect(() => addressSchema.parse('0xabcdef1234567890abcdef1234567890abcdef12')).not.toThrow();
  });

  it('accepts valid mixed-case EVM address', () => {
    expect(() => addressSchema.parse('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')).not.toThrow();
  });

  it('rejects address without 0x prefix', () => {
    expect(() => addressSchema.parse('abcdef1234567890abcdef1234567890abcdef12')).toThrow();
  });

  it('rejects address too short', () => {
    expect(() => addressSchema.parse('0xabcdef')).toThrow();
  });

  it('rejects address too long', () => {
    expect(() => addressSchema.parse('0xabcdef1234567890abcdef1234567890abcdef123456')).toThrow();
  });

  it('rejects non-hex characters', () => {
    expect(() => addressSchema.parse('0xabcdefghijklmnopabcdefghijklmnopabcdefgh')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => addressSchema.parse('')).toThrow();
  });

  it('rejects non-string value', () => {
    expect(() => addressSchema.parse(null)).toThrow();
    expect(() => addressSchema.parse(123)).toThrow();
  });
});

// ─── solanaAddressSchema ───────────────────────────────────────────────────────

describe('solanaAddressSchema', () => {
  it('accepts valid Solana address (base58, 44 chars)', () => {
    expect(() => solanaAddressSchema.parse('So11111111111111111111111111111111111111112')).not.toThrow();
  });

  it('accepts valid shorter Solana address (32 chars)', () => {
    expect(() => solanaAddressSchema.parse('11111111111111111111111111111112')).not.toThrow();
  });

  it('rejects Solana address with invalid base58 chars (0, O, I, l)', () => {
    expect(() => solanaAddressSchema.parse('0111111111111111111111111111111111111111111')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => solanaAddressSchema.parse('')).toThrow();
  });
});

// ─── txHashSchema (EVM) ────────────────────────────────────────────────────────

describe('txHashSchema', () => {
  it('accepts valid EVM tx hash (0x + 64 hex chars)', () => {
    expect(() => txHashSchema.parse('0x' + 'a'.repeat(64))).not.toThrow();
    expect(() => txHashSchema.parse('0x' + 'f'.repeat(64))).not.toThrow();
  });

  it('rejects shorter hash', () => {
    expect(() => txHashSchema.parse('0x' + 'a'.repeat(32))).toThrow();
  });

  it('rejects longer hash', () => {
    expect(() => txHashSchema.parse('0x' + 'a'.repeat(65))).toThrow();
  });

  it('rejects without 0x prefix', () => {
    expect(() => txHashSchema.parse('a'.repeat(64))).toThrow();
  });
});

// ─── solanaTxHashSchema ────────────────────────────────────────────────────────

describe('solanaTxHashSchema', () => {
  it('accepts valid Solana tx signature (87 chars)', () => {
    // Base58, 87-88 chars
    const sig87 = '1'.repeat(87);
    expect(() => solanaTxHashSchema.parse(sig87)).not.toThrow();
  });

  it('accepts valid Solana tx signature (88 chars)', () => {
    const sig88 = '2'.repeat(88);
    expect(() => solanaTxHashSchema.parse(sig88)).not.toThrow();
  });

  it('rejects short signature', () => {
    expect(() => solanaTxHashSchema.parse('short')).toThrow();
  });

  it('rejects invalid base58 chars', () => {
    expect(() => solanaTxHashSchema.parse('0'.repeat(87))).toThrow(); // '0' not in base58
  });
});

// ─── tokenAmountSchema ─────────────────────────────────────────────────────────

describe('tokenAmountSchema', () => {
  it('accepts valid token amount object', () => {
    expect(() => tokenAmountSchema.parse({ amount: '1.5', decimals: 18, symbol: 'ETH' })).not.toThrow();
  });

  it('rejects missing amount', () => {
    expect(() => tokenAmountSchema.parse({ decimals: 18, symbol: 'ETH' })).toThrow();
  });

  it('rejects negative decimals', () => {
    expect(() => tokenAmountSchema.parse({ amount: '1.5', decimals: -1, symbol: 'ETH' })).toThrow();
  });

  it('rejects non-integer decimals', () => {
    expect(() => tokenAmountSchema.parse({ amount: '1.5', decimals: 18.5, symbol: 'ETH' })).toThrow();
  });

  it('rejects missing symbol', () => {
    expect(() => tokenAmountSchema.parse({ amount: '1.5', decimals: 18 })).toThrow();
  });
});

// ─── feeEstimateSchema ─────────────────────────────────────────────────────────

describe('feeEstimateSchema', () => {
  it('accepts valid fee estimate with string values', () => {
    expect(() => feeEstimateSchema.parse({
      gasLimit: '21000',
      maxFeePerGas: '1500000000',
      maxPriorityFeePerGas: '1000000000',
      totalFee: '31500000000000',
    })).not.toThrow();
  });

  it('rejects when any field is missing', () => {
    expect(() => feeEstimateSchema.parse({
      gasLimit: '21000',
      maxFeePerGas: '1500000000',
      // missing maxPriorityFeePerGas and totalFee
    })).toThrow();
  });

  it('rejects when values are numbers instead of strings', () => {
    expect(() => feeEstimateSchema.parse({
      gasLimit: 21000, // number, not string
      maxFeePerGas: '1500000000',
      maxPriorityFeePerGas: '1000000000',
      totalFee: '31500000000000',
    })).toThrow();
  });
});

// ─── numericAmountSchema ───────────────────────────────────────────────────────

describe('numericAmountSchema', () => {
  it('accepts positive integer string', () => {
    expect(() => numericAmountSchema.parse('100')).not.toThrow();
    expect(numericAmountSchema.parse('100')).toBe('100');
  });

  it('accepts positive decimal string', () => {
    expect(() => numericAmountSchema.parse('1.5')).not.toThrow();
    expect(numericAmountSchema.parse('1.5')).toBe('1.5');
  });

  it('trims surrounding whitespace', () => {
    expect(() => numericAmountSchema.parse('  1.5  ')).not.toThrow();
  });

  it('rejects zero', () => {
    expect(() => numericAmountSchema.parse('0')).toThrow();
  });

  it('rejects negative numbers', () => {
    expect(() => numericAmountSchema.parse('-1.5')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => numericAmountSchema.parse('')).toThrow();
  });

  it('rejects alphabetic strings', () => {
    expect(() => numericAmountSchema.parse('abc')).toThrow();
  });

  it('rejects strings with currency symbols', () => {
    expect(() => numericAmountSchema.parse('$1.50')).toThrow();
  });

  it('rejects Infinity as string', () => {
    expect(() => numericAmountSchema.parse('Infinity')).toThrow();
  });

  it('rejects NaN as string', () => {
    expect(() => numericAmountSchema.parse('NaN')).toThrow();
  });
});
