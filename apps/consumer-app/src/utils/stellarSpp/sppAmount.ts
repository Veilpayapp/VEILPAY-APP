import { SppClientError } from './types';

const DECIMALS = 7;
const SCALE = 10_000_000n;

export function parsePositiveStroops(amount: string): bigint {
  const stroops = parseStroops(amount);
  if (stroops <= 0n) {
    throw new SppClientError('Amount must be positive', 'SPP_INVALID_AMOUNT');
  }
  return stroops;
}

export function parseStroops(amount: string): bigint {
  const s = amount.trim();
  if (!/^\d+(\.\d{0,7})?$/.test(s)) {
    throw new SppClientError(
      'Amount must be a decimal with up to 7 places',
      'SPP_INVALID_AMOUNT'
    );
  }

  const [whole, frac = ''] = s.split('.');
  return (
    BigInt(whole) * SCALE +
    BigInt((frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS))
  );
}

export function formatStroops(stroops: bigint): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / SCALE;
  const frac = (abs % SCALE)
    .toString()
    .padStart(DECIMALS, '0')
    .replace(/0+$/, '');
  const body = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${body}` : body;
}

export function tryParseStroops(amount: string): bigint | null {
  try {
    return parseStroops(amount);
  } catch {
    return null;
  }
}
