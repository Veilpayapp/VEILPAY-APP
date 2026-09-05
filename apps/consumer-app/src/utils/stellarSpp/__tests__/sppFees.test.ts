/**
 * Stellar/Soroban fee helper tests.
 *
 * These lock the numbers the confirm screen quotes for SPP operations. The
 * ceiling itself is an unmeasured bound (see sppFees.ts), so the assertions
 * here pin the *shape* of the math — op-awareness, the planner's 10-tx cap,
 * and stroop formatting — not a calibrated fee.
 */

import {
  SPP_TRANSACT_FEE_CEILING_STROOPS,
  STELLAR_CLASSIC_FEE_STROOPS,
  sppFeeCeilingStroops,
  sppPlannedTxCount,
  stroopsToXlm,
  XLM_STROOPS,
} from '../sppFees';

describe('stroopsToXlm', () => {
  it('formats the Soroban ceiling and the classic base fee', () => {
    // Calibrated from on-chain register/insert_leaf fees; see sppFees.ts.
    expect(stroopsToXlm(SPP_TRANSACT_FEE_CEILING_STROOPS)).toBe('0.12');
    expect(stroopsToXlm(STELLAR_CLASSIC_FEE_STROOPS)).toBe('0.00001');
  });

  it('trims trailing zeros without losing 7-dp precision', () => {
    expect(stroopsToXlm(XLM_STROOPS)).toBe('1');
    expect(stroopsToXlm(1n)).toBe('0.0000001');
    expect(stroopsToXlm(12_345_678n)).toBe('1.2345678');
    expect(stroopsToXlm(0n)).toBe('0');
  });

  it('clamps negatives rather than emitting a bogus negative fee', () => {
    expect(stroopsToXlm(-500n)).toBe('0');
  });
});

describe('sppPlannedTxCount', () => {
  it('always plans exactly one transaction for a shield', () => {
    for (const notes of [0, 1, 5, 50]) {
      expect(sppPlannedTxCount('shield', notes)).toBe(1);
    }
  });

  it('consolidates roughly notes-1 times for a spend', () => {
    expect(sppPlannedTxCount('transfer', 4)).toBe(3);
    expect(sppPlannedTxCount('unshield', 4)).toBe(3);
  });

  it('never plans fewer than one transaction', () => {
    expect(sppPlannedTxCount('transfer', 0)).toBe(1);
    expect(sppPlannedTxCount('transfer', 1)).toBe(1);
  });

  it("clamps to the vendor planner's TRANSACTION_LIMIT of 10", () => {
    expect(sppPlannedTxCount('transfer', 100)).toBe(10);
  });

  it('tolerates a non-finite note count', () => {
    expect(sppPlannedTxCount('transfer', Number.NaN)).toBe(1);
  });
});

describe('sppFeeCeilingStroops', () => {
  it('scales the per-transact ceiling by the planned transaction count', () => {
    expect(sppFeeCeilingStroops('shield', 0)).toBe(
      SPP_TRANSACT_FEE_CEILING_STROOPS
    );
    expect(sppFeeCeilingStroops('transfer', 4)).toBe(
      SPP_TRANSACT_FEE_CEILING_STROOPS * 3n
    );
  });

  it('quotes a Soroban op far above the classic base fee', () => {
    // The defect this guards: the confirm screen used to quote 100 stroops
    // for an SPP shield, understating it by ~1000x and letting it clear the
    // pre-send funds gate.
    expect(sppFeeCeilingStroops('shield', 0)).toBeGreaterThan(
      STELLAR_CLASSIC_FEE_STROOPS * 1000n
    );
  });
});
