/**
 * Fee presentation and pre-send gating math for the confirm screen.
 *
 * Extracted as a pure function because these are the numbers a user reads
 * immediately before authorizing a payment, and because the send gate that
 * consumes them has a fail-open failure mode worth locking down with tests.
 *
 * Two invariants this module exists to hold:
 *
 * 1. Fees are ALWAYS denominated in the network's native asset, never in the
 *    asset being sent. `GasEstimate.estimatedCostEth` is native gas. Labelling
 *    it with the send token rendered ETH gas as "0.0008 USDC"; summing it into
 *    the send amount produced a "10.000800 USDC" total.
 * 2. A missing estimate must never fabricate a number, and must never disarm
 *    the gate. `feeNative` is therefore always a finite number (0 when
 *    unknown), so `requiredNative` stays finite and the gate still blocks
 *    `amount > balance`.
 */

import type { GasEstimate } from './gasEstimator';
import type { PrivacyLevel } from '../stores/settingsStore';

/** Drops trailing zeros from a fixed-point string ('0.0200000' → '0.02'). */
export function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export interface PaymentFeeViewParams {
  gasEstimate: GasEstimate | null;
  privacyLevel: PrivacyLevel | 'private';
  /** Crypto amount being sent, as entered. */
  amount: string;
  /** Symbol of the asset being sent (may be a token, e.g. USDC / pXLM). */
  token: string;
  /** Native symbol of the active network, if known. */
  nativeSymbol?: string;
  /**
   * Native balance that must remain after submission (for example Stellar's
   * `(2 + subentry_count) * 0.5 XLM` protocol minimum).
   */
  minimumBalanceNative?: number;
}

export interface PaymentFeeView {
  /** Symbol the fee is denominated in — native, never the send token. */
  feeSymbol: string;
  /** True when the figure is an upper bound and must be labelled "up to". */
  isFeeCeiling: boolean;
  /** Native-denominated fee string, or null when no estimate exists. */
  networkFee: string | null;
  /** Whether a usable fee figure exists. */
  hasFee: boolean;
  /** Fee as a finite number; 0 when unknown. Never NaN. */
  feeNative: number;
  /** Display-ready total fee (network + privacy), trailing zeros trimmed. */
  totalFee: string;
  /** Hardcoded privacy-pool fee; only rendered for the (disabled) 'max' level. */
  privacyFee: string;
  /** True when the send asset is the network's native asset. */
  isNativeSend: boolean;
  /**
   * Native balance required to submit safely. Native sends require
   * amount + fee + reserve; token/private-note sends require fee + reserve.
   */
  requiredNative: number;
  /** Display-ready native total (amount + fee), or null when fee is unknown. */
  nativeTotal: string | null;
}

export function derivePaymentFeeView({
  gasEstimate,
  privacyLevel,
  amount,
  token,
  nativeSymbol,
  minimumBalanceNative = 0,
}: PaymentFeeViewParams): PaymentFeeView {
  const feeSymbol = nativeSymbol ?? '';
  const isNativeSend = Boolean(nativeSymbol) && token === nativeSymbol;
  const isFeeCeiling = gasEstimate?.isCeiling === true;

  // No fabricated fallback. The previous `?? '0.001'` printed a literal under
  // the label "Network Fee (estimated)" with nothing having measured it.
  const networkFee = gasEstimate?.estimatedCostEth ?? null;
  const parsedFee = networkFee != null ? parseFloat(networkFee) : Number.NaN;
  const hasFee = Number.isFinite(parsedFee);

  const privacyFee = privacyLevel === 'max' ? '0.005' : '0';
  const privacyFeeNum = parseFloat(privacyFee);

  // 7 dp, not 4: `toFixed(4)` rounded Stellar's 0.00001 XLM and sub-0.0001 L2
  // gas to '0.0000', dropping them from the total and from `requiredNative`,
  // which silently weakened the gate.
  const feeNative = (hasFee ? parsedFee : 0) + privacyFeeNum;

  // Prefer the estimator's own string verbatim. Re-formatting a float at fixed
  // precision is lossy in both directions: it rounded an 8-dp EVM fee
  // (0.00082755 → 0.0008276), and on a cheap L2 a genuine 1e-12 ETH fee would
  // round to '0' and read as free. Arithmetic is only needed for the (release-
  // disabled) 'max' privacy fee, so the common path stays exact.
  const totalFee =
    privacyFeeNum === 0
      ? (hasFee ? (networkFee as string) : '0')
      : trimTrailingZeros(feeNative.toFixed(7));

  const parsedAmount = parseFloat(amount || '0');
  const safeAmount = Number.isFinite(parsedAmount) ? parsedAmount : 0;
  const safeMinimumBalance =
    Number.isFinite(minimumBalanceNative) && minimumBalanceNative > 0
      ? minimumBalanceNative
      : 0;
  // A token or pXLM send does not debit its amount from the public native
  // balance, but it still needs native fee funds and (on Stellar) must leave
  // the protocol reserve intact after the Soroban/classic operation.
  const requiredNative =
    (isNativeSend ? safeAmount : 0) + feeNative + safeMinimumBalance;

  return {
    feeSymbol,
    isFeeCeiling,
    networkFee,
    hasFee,
    feeNative,
    totalFee,
    privacyFee,
    isNativeSend,
    requiredNative,
    nativeTotal: hasFee
      ? trimTrailingZeros((safeAmount + feeNative).toFixed(7))
      : null,
  };
}
