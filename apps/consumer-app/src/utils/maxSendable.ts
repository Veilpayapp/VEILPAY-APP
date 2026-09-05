/**
 * MAX-amount reserve math for the send screen.
 *
 * Extracted because `handleQuickAmount` is inside an `istanbul ignore file`
 * screen with no test that presses the button, and the old version reserved
 * literally 0 on every non-EVM chain — so MAX on Stellar proposed the entire
 * balance and the signer rejected it (`amount + fee + (2 + subentries) x 0.5
 * XLM`). Three rules this holds:
 *
 * 1. Native XLM must reserve BOTH the fee and the protocol minimum balance.
 *    The displayed balance is the gross Horizon figure; nothing in the balance
 *    path nets the reserve out.
 * 2. pXLM notes are pool commitments, not an account balance — the minimum
 *    balance does not apply and 100% is correct. Subtracting a reserve there
 *    would strand funds.
 * 3. The result must FLOOR, never round up. `toFixed` rounds half-up, so a
 *    1.2345678 XLM balance produced "1.234568" — above the balance, tripping
 *    the screen's own `exceedsBalance` check.
 */

import { computeStellarMinReserveXlm } from './stellarSigner';
import {
  STELLAR_CLASSIC_FEE_STROOPS,
  XLM_STROOPS,
  sppFeeCeilingStroops,
} from './stellarSpp/sppFees';

/** Per-chain EVM gas reserve, in native units. */
const EVM_GAS_RESERVE: Record<string, number> = {
  ethereum: 0.01,
  polygon: 0.005,
  arbitrum: 0.002,
  sepolia: 0.001,
};

const EVM_GAS_RESERVE_DEFAULT = 0.005;

/** Base fee plus headroom for a rent-exempt account creation. */
const SVM_RESERVE_SOL = 0.001;

export interface MaxSendableParams {
  /** Gross displayed balance for the selected asset. */
  balance: number;
  chainType?: 'evm' | 'svm' | 'xlm' | string;
  chainKey?: string;
  /** True when spending pXLM notes rather than an account balance. */
  isPrivacyAsset?: boolean;
  /** True when the send funds a privacy-pool op (shield) with a Soroban fee. */
  isPrivacyMode?: boolean;
  /** Horizon `subentry_count`; undefined falls back to the bare-account floor. */
  subentryCount?: number;
}

/** Decimal places to render for a chain's amounts. */
export function amountDecimalsForChain(chainType?: string): number {
  return chainType === 'xlm' ? 7 : 6;
}

/** Floors to `dp` places so the result can never exceed the balance. */
export function floorToDecimals(value: number, dp: number): string {
  if (!Number.isFinite(value) || value <= 0) return (0).toFixed(dp);
  const scale = 10 ** dp;
  return (Math.floor(value * scale) / scale).toFixed(dp);
}

/** Amount that must stay behind, in native units. */
export function reserveForMaxSend({
  chainType,
  chainKey,
  isPrivacyAsset,
  isPrivacyMode,
  subentryCount,
}: Omit<MaxSendableParams, 'balance'>): number {
  // Pool notes: no account reserve, and the Soroban fee is a separate
  // public-XLM debit.
  if (isPrivacyAsset) return 0;

  if (chainType === 'xlm') {
    const feeStroops = isPrivacyMode
      ? sppFeeCeilingStroops('shield', 0)
      : STELLAR_CLASSIC_FEE_STROOPS;
    const feeXlm = Number(feeStroops) / Number(XLM_STROOPS);
    return computeStellarMinReserveXlm(subentryCount) + feeXlm;
  }

  if (chainType === 'svm') return SVM_RESERVE_SOL;

  return EVM_GAS_RESERVE[chainKey ?? ''] ?? EVM_GAS_RESERVE_DEFAULT;
}

/** Max sendable amount as a display string, floored to the chain's precision. */
export function computeMaxSendableAmount(params: MaxSendableParams): string {
  const { balance, chainType } = params;
  const safeBalance = Number.isFinite(balance) ? balance : 0;
  const maxAmount = Math.max(0, safeBalance - reserveForMaxSend(params));
  return floorToDecimals(maxAmount, amountDecimalsForChain(chainType));
}
