/**
 * Locks the fee-display and send-gate invariants on the confirm screen.
 *
 * These tests exist because of four shipped defects:
 *   - a fabricated `?? '0.001'` network fee with no RPC basis,
 *   - a native-denominated fee labelled with the send token,
 *   - `toFixed(4)` erasing every fee below 0.0001 from the gate,
 *   - and a latent fail-open: removing the fallback naively yields
 *     `parseFloat(null)` → NaN → `Number.isFinite(requiredNative)` false →
 *     the insufficient-funds gate silently disables itself.
 */

import {
  derivePaymentFeeView,
  trimTrailingZeros,
} from '../paymentFees';
import type { GasEstimate } from '../gasEstimator';

function estimate(over: Partial<GasEstimate> = {}): GasEstimate {
  return {
    gasLimit: 21_000n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    gasPrice: 0n,
    estimatedCostWei: 0n,
    estimatedCostEth: '0.00082755',
    estimatedCostUsd: null,
    isStale: false,
    fetchedAt: Date.now(),
    ...over,
  } as GasEstimate;
}

describe('trimTrailingZeros', () => {
  it('trims padding without mangling significant digits', () => {
    expect(trimTrailingZeros('0.0200000')).toBe('0.02');
    expect(trimTrailingZeros('0.0000100')).toBe('0.00001');
    expect(trimTrailingZeros('1.0000000')).toBe('1');
    expect(trimTrailingZeros('10.0008000')).toBe('10.0008');
  });
});

describe('derivePaymentFeeView — no fabricated fee (D1)', () => {
  it('reports no fee rather than inventing 0.001 when the estimate is missing', () => {
    const view = derivePaymentFeeView({
      gasEstimate: null,
      privacyLevel: 'standard',
      amount: '10',
      token: 'ETH',
      nativeSymbol: 'ETH',
    });

    expect(view.networkFee).toBeNull();
    expect(view.hasFee).toBe(false);
    // The old fallback surfaced here as '0.001'. Nothing may reintroduce it.
    expect(view.totalFee).not.toBe('0.001');
    expect(view.feeNative).toBe(0);
    expect(view.nativeTotal).toBeNull();
  });

  it('keeps feeNative finite when the estimate is missing, so the gate stays armed', () => {
    const view = derivePaymentFeeView({
      gasEstimate: null,
      privacyLevel: 'standard',
      amount: '10',
      token: 'ETH',
      nativeSymbol: 'ETH',
    });

    // This is the fail-open regression: NaN here would make
    // `Number.isFinite(requiredNative)` false and disarm insufficientFunds.
    expect(Number.isFinite(view.feeNative)).toBe(true);
    expect(Number.isFinite(view.requiredNative)).toBe(true);
    expect(view.requiredNative).toBe(10);
  });

  it('survives a malformed estimate string without going NaN', () => {
    const view = derivePaymentFeeView({
      gasEstimate: estimate({ estimatedCostEth: 'not-a-number' }),
      privacyLevel: 'standard',
      amount: '10',
      token: 'ETH',
      nativeSymbol: 'ETH',
    });

    expect(view.hasFee).toBe(false);
    expect(Number.isFinite(view.requiredNative)).toBe(true);
    expect(view.requiredNative).toBe(10);
  });
});

describe('derivePaymentFeeView — gate arithmetic', () => {
  it('still blocks an over-balance send when the fee is unknown', () => {
    const view = derivePaymentFeeView({
      gasEstimate: null,
      privacyLevel: 'standard',
      amount: '5',
      token: 'ETH',
      nativeSymbol: 'ETH',
    });

    const balance = 4.5;
    expect(view.isNativeSend).toBe(true);
    expect(balance < view.requiredNative).toBe(true);
  });

  it('counts a sub-0.0001 fee toward the requirement (D6)', () => {
    // 0.00001 XLM previously rounded to '0.0000' under toFixed(4) and
    // vanished from the gate entirely.
    const view = derivePaymentFeeView({
      gasEstimate: estimate({ estimatedCostEth: '0.00001' }),
      privacyLevel: 'standard',
      amount: '10',
      token: 'XLM',
      nativeSymbol: 'XLM',
    });

    expect(view.feeNative).toBeCloseTo(0.00001, 10);
    expect(view.requiredNative).toBeGreaterThan(10);
    expect(view.totalFee).toBe('0.00001');
  });

  it('includes the Stellar minimum balance in a native shield gate', () => {
    const view = derivePaymentFeeView({
      gasEstimate: estimate({ estimatedCostEth: '0.12', isCeiling: true }),
      privacyLevel: 'private',
      amount: '1.1',
      token: 'XLM',
      nativeSymbol: 'XLM',
      minimumBalanceNative: 1,
    });

    expect(view.requiredNative).toBeCloseTo(2.22, 10);
    // Reserve is retained, not charged, so it is not part of the UI total.
    expect(view.nativeTotal).toBe('1.22');
  });

  it('requires public XLM fee plus reserve for a pXLM spend', () => {
    const view = derivePaymentFeeView({
      gasEstimate: estimate({ estimatedCostEth: '0.12', isCeiling: true }),
      privacyLevel: 'private',
      amount: '5',
      token: 'pXLM',
      nativeSymbol: 'XLM',
      minimumBalanceNative: 1.5,
    });

    expect(view.isNativeSend).toBe(false);
    expect(view.requiredNative).toBeCloseTo(1.62, 10);
  });

  it('does not block a send that fits within balance', () => {
    const view = derivePaymentFeeView({
      gasEstimate: estimate({ estimatedCostEth: '0.0002' }),
      privacyLevel: 'standard',
      amount: '1',
      token: 'ETH',
      nativeSymbol: 'ETH',
    });

    expect(2.0 < view.requiredNative).toBe(false);
  });
});

describe('derivePaymentFeeView — no unit mixing (D5)', () => {
  it('denominates the fee in the native asset for a token send', () => {
    const view = derivePaymentFeeView({
      gasEstimate: estimate({ estimatedCostEth: '0.00082755' }),
      privacyLevel: 'standard',
      amount: '10',
      token: 'USDC',
      nativeSymbol: 'ETH',
    });

    // The fee is ETH gas: it must never be labelled USDC, and must never be
    // added to a USDC amount.
    expect(view.feeSymbol).toBe('ETH');
    expect(view.isNativeSend).toBe(false);
    expect(view.totalFee).toBe('0.00082755');
    expect(view.requiredNative).toBeCloseTo(0.00082755, 12);
  });

  it('treats a private pXLM transfer as a non-native send', () => {
    // The Soroban fee is public XLM debited from the G… account — it is not
    // paid out of the shielded balance, so it must not be labelled pXLM.
    const view = derivePaymentFeeView({
      gasEstimate: estimate({ estimatedCostEth: '0.02', isCeiling: true }),
      privacyLevel: 'private',
      amount: '5',
      token: 'pXLM',
      nativeSymbol: 'XLM',
    });

    expect(view.isNativeSend).toBe(false);
    expect(view.feeSymbol).toBe('XLM');
    expect(view.isFeeCeiling).toBe(true);
  });

  it('collapses to a single figure for a native send', () => {
    const view = derivePaymentFeeView({
      gasEstimate: estimate({ estimatedCostEth: '0.0008' }),
      privacyLevel: 'standard',
      amount: '10',
      token: 'ETH',
      nativeSymbol: 'ETH',
    });

    expect(view.isNativeSend).toBe(true);
    expect(view.nativeTotal).toBe('10.0008');
  });
});

describe('derivePaymentFeeView — ceiling labelling (D2)', () => {
  it('marks a Soroban ceiling so the UI can say "up to"', () => {
    const view = derivePaymentFeeView({
      gasEstimate: estimate({ estimatedCostEth: '0.02', isCeiling: true }),
      privacyLevel: 'private',
      amount: '1',
      token: 'XLM',
      nativeSymbol: 'XLM',
    });

    expect(view.isFeeCeiling).toBe(true);
    expect(view.networkFee).toBe('0.02');
    // A shield is a native send, so the ceiling must reach the gate.
    expect(view.isNativeSend).toBe(true);
    expect(view.requiredNative).toBeCloseTo(1.02, 10);
  });

  it('does not mark a live EVM estimate as a ceiling', () => {
    const view = derivePaymentFeeView({
      gasEstimate: estimate(),
      privacyLevel: 'standard',
      amount: '1',
      token: 'ETH',
      nativeSymbol: 'ETH',
    });

    expect(view.isFeeCeiling).toBe(false);
  });
});

describe('derivePaymentFeeView — missing native symbol', () => {
  it('never claims a native send when the network symbol is unknown', () => {
    const view = derivePaymentFeeView({
      gasEstimate: estimate(),
      privacyLevel: 'standard',
      amount: '1',
      token: 'ETH',
      nativeSymbol: undefined,
    });

    expect(view.isNativeSend).toBe(false);
    expect(view.feeSymbol).toBe('');
  });
});
