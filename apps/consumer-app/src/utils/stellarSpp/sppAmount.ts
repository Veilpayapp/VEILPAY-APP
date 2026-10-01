import { SppClientError } from './types';

const DECIMALS = 7;
const SCALE = 10_000_000n;

export type SppTransactOp = 'shield' | 'transfer' | 'unshield';

/**
 * App-side per-operation ceiling (whole XLM) on SPP transact ops.
 *
 * Defense-in-depth on top of the contract's own amount-range guard: limits
 * blast radius of a compromised/buggy client or a stolen unlocked device to a
 * single bounded operation instead of a full private-balance drain. This is an
 * *app-side* cap only — the relayer/contract remain authoritative.
 *
 * Overridable per build via EXPO_PUBLIC_SPP_MAX_TRANSACT_XLM (whole XLM,
 * positive). Default 1,000 XLM per operation.
 */
/** Default ceiling, whole XLM, per SPP transact op. */
const DEFAULT_MAX_TRANSACT_XLM = 100n;
const XLM_TO_STROOPS = 10_000_000n;

function envMaxTransactStroops(): bigint {
  const raw = process.env.EXPO_PUBLIC_SPP_MAX_TRANSACT_XLM?.trim();
  if (!raw) return DEFAULT_MAX_TRANSACT_XLM * XLM_TO_STROOPS;
  if (!/^\d+$/.test(raw)) {
    throw new SppClientError(
      'EXPO_PUBLIC_SPP_MAX_TRANSACT_XLM must be a positive whole number of XLM',
      'SPP_CONFIG_INVALID'
    );
  }
  const xlm = BigInt(raw);
  if (xlm <= 0n) {
    throw new SppClientError(
      'EXPO_PUBLIC_SPP_MAX_TRANSACT_XLM must be positive',
      'SPP_CONFIG_INVALID'
    );
  }
  return xlm * XLM_TO_STROOPS;
}

/** True when SPP transact ops are remotely disabled for this build. */
export function isSppTransactKillSwitched(): boolean {
  return process.env.EXPO_PUBLIC_SPP_OPS_DISABLED === 'true';
}

/** Stroop ceiling for one SPP transact operation (shield/transfer/unshield). */
export function sppTransactAmountCeilingStroops(): bigint {
  return envMaxTransactStroops();
}

/**
 * Validate that an SPP transact op may proceed: kill-switch closed, amount
 * positive, and amount at or below the per-op ceiling. Throws SppClientError.
 */
export function assertSppTransactAllowed(op: SppTransactOp, amount: string): bigint {
  if (isSppTransactKillSwitched()) {
    throw new SppClientError(
      'Private payments are temporarily disabled. Please retry later.',
      'SPP_OPS_DISABLED'
    );
  }
  const stroops = parsePositiveStroops(amount);
  const ceiling = sppTransactAmountCeilingStroops();
  if (stroops > ceiling) {
    const xlm = ceiling / SCALE;
    throw new SppClientError(
      `Amount exceeds the single-transaction private-payment limit (${xlm} XLM). ` +
        'Split the payment into smaller transactions.',
      'SPP_AMOUNT_OVER_CAP'
    );
  }
  return stroops;
}

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
