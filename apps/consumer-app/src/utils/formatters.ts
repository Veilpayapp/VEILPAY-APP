/**
 * Shared formatting helpers for Transak on-ramp/off-ramp screens.
 * Extracted from DepositCryptoScreen and WithdrawFiatScreen (ST-L1 fix).
 */

import { formatFiat, type FiatCurrency } from './transak';

/** Format a 24h percentage change with sign prefix */
export function formatChangePercent(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** Extract the currency symbol from a formatted zero value */
export function getCurrencySymbol(currency: FiatCurrency): string {
  const formatted = formatFiat(0, currency);
  const symbol = formatted.replace(/[0-9.,\s-]/g, '');
  return symbol.length > 0 ? symbol : currency;
}

/** Parse a balance string into a number, returning 0 for invalid/null values */
export function getBalanceAmount(balance: string | null): number {
  if (!balance) {
    return 0;
  }

  const parsed = Number.parseFloat(balance);
  return Number.isFinite(parsed) ? parsed : 0;
}
