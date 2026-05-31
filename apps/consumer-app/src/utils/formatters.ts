/**
 * Shared formatting helpers for Transak on-ramp/off-ramp screens.
 * Extracted from DepositCryptoScreen and WithdrawFiatScreen (ST-L1 fix).
 */

import { formatFiat as transakFormatFiat, type FiatCurrency } from './transak';

/** Format a 24h percentage change with sign prefix */
export function formatChangePercent(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** Extract the currency symbol from a formatted zero value */
export function getCurrencySymbol(currency: FiatCurrency): string {
  const formatted = transakFormatFiat(0, currency);
  const symbol = formatted.replace(/[0-9.,\s-]/g, '');
  return symbol.length > 0 ? symbol : currency;
}

export const formatFiat = (amount: number | string, currency: string = 'USD'): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return transakFormatFiat(num, currency as FiatCurrency);
};

export const formatCrypto = (amount: number | string, symbol: string): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `${num.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${symbol}`;
};

export const formatFeePercent = (percent: number): string => {
  return `${percent.toFixed(1)}%`;
};

export const formatBalanceForDisplay = (balance: string, decimals?: number): string => {
  let num = parseFloat(balance);
  if (isNaN(num)) return '0.00';
  if (decimals) {
    num = num / Math.pow(10, decimals);
  }
  if (num === 0) return '0.00';
  if (num > 0 && num < 0.000001) {
    return '< 0.000001';
  }
  const minDigits = num > 1000 ? 2 : (num < 0.01 ? 6 : 4);
  const maxDigits = num > 1000 ? 2 : (num < 0.01 ? 6 : 4);
  return num.toLocaleString('en-US', { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits });
};

/** Parse a balance string into a number, returning 0 for invalid/null values */
export function getBalanceAmount(balance: string | null): number {
  if (!balance) {
    return 0;
  }

  const parsed = Number.parseFloat(balance);
  return Number.isFinite(parsed) ? parsed : 0;
}
