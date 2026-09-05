/**
 * MAX-amount reserve tests.
 *
 * The defect these lock: `handleQuickAmount('MAX')` reserved literally 0 on
 * every non-EVM chain, so MAX on Stellar proposed the entire gross balance and
 * `stellarSigner` rejected it — a dead-end button. The opposite mistake is just
 * as bad and is also covered: subtracting a reserve from pXLM notes would
 * strand private funds.
 */

import {
  amountDecimalsForChain,
  computeMaxSendableAmount,
  floorToDecimals,
  reserveForMaxSend,
} from '../maxSendable';
import { computeStellarMinReserveXlm } from '../stellarSigner';

describe('floorToDecimals', () => {
  it('floors rather than rounding half-up', () => {
    // toFixed(6) on 1.2345678 yields "1.234568" — ABOVE the balance, which
    // tripped the send screen's own exceedsBalance check.
    expect(floorToDecimals(1.2345678, 6)).toBe('1.234567');
    expect(floorToDecimals(1.2345678, 7)).toBe('1.2345678');
  });

  it('clamps non-positive and non-finite input', () => {
    expect(floorToDecimals(0, 7)).toBe('0.0000000');
    expect(floorToDecimals(-5, 6)).toBe('0.000000');
    expect(floorToDecimals(Number.NaN, 6)).toBe('0.000000');
  });
});

describe('amountDecimalsForChain', () => {
  it('uses 7 dp for Stellar and 6 elsewhere', () => {
    expect(amountDecimalsForChain('xlm')).toBe(7);
    expect(amountDecimalsForChain('evm')).toBe(6);
    expect(amountDecimalsForChain('svm')).toBe(6);
    expect(amountDecimalsForChain(undefined)).toBe(6);
  });
});

describe('reserveForMaxSend — Stellar', () => {
  it('reserves the protocol minimum balance plus the classic fee', () => {
    const reserve = reserveForMaxSend({
      chainType: 'xlm',
      subentryCount: 3,
    });

    // (2 + 3) * 0.5 = 2.5 XLM, plus 100 stroops.
    expect(reserve).toBeCloseTo(computeStellarMinReserveXlm(3) + 0.00001, 9);
    expect(reserve).toBeGreaterThan(2.5);
  });

  it('falls back to the bare-account floor when subentries are unknown', () => {
    const reserve = reserveForMaxSend({ chainType: 'xlm' });
    // 2 base reserves = 1 XLM.
    expect(reserve).toBeGreaterThanOrEqual(1);
    expect(reserve).toBeLessThan(1.01);
  });

  it('reserves the Soroban ceiling, not the classic fee, when shielding', () => {
    const classic = reserveForMaxSend({ chainType: 'xlm', subentryCount: 0 });
    const shielding = reserveForMaxSend({
      chainType: 'xlm',
      subentryCount: 0,
      isPrivacyMode: true,
    });

    expect(shielding).toBeGreaterThan(classic);
    // 0.12 XLM calibrated ceiling vs 0.00001 classic (see sppFees.ts).
    expect(shielding - classic).toBeCloseTo(0.12 - 0.00001, 9);
  });

  it('never reserves anything from pXLM notes', () => {
    expect(
      reserveForMaxSend({
        chainType: 'xlm',
        isPrivacyAsset: true,
        isPrivacyMode: true,
        subentryCount: 5,
      })
    ).toBe(0);
  });
});

describe('reserveForMaxSend — other chains', () => {
  it('keeps the per-chain EVM gas reserves', () => {
    expect(reserveForMaxSend({ chainType: 'evm', chainKey: 'ethereum' })).toBe(0.01);
    expect(reserveForMaxSend({ chainType: 'evm', chainKey: 'polygon' })).toBe(0.005);
    expect(reserveForMaxSend({ chainType: 'evm', chainKey: 'arbitrum' })).toBe(0.002);
    expect(reserveForMaxSend({ chainType: 'evm', chainKey: 'sepolia' })).toBe(0.001);
  });

  it('defaults an unknown EVM chain rather than reserving nothing', () => {
    expect(reserveForMaxSend({ chainType: 'evm', chainKey: 'unknown-l2' })).toBe(0.005);
    expect(reserveForMaxSend({ chainType: 'evm' })).toBe(0.005);
  });

  it('reserves rent headroom on Solana', () => {
    expect(reserveForMaxSend({ chainType: 'svm' })).toBe(0.001);
  });
});

describe('computeMaxSendableAmount', () => {
  it('leaves the signer enough headroom on a native XLM send', () => {
    const balance = 10;
    const subentryCount = 3;
    const max = Number(
      computeMaxSendableAmount({ balance, chainType: 'xlm', subentryCount })
    );

    // The signer demands amount + fee + reserve <= balance.
    const reserve = computeStellarMinReserveXlm(subentryCount);
    expect(max + 0.00001 + reserve).toBeLessThanOrEqual(balance);
  });

  it('never proposes more than the balance at 7-dp precision', () => {
    const balance = 1.2345678;
    const max = Number(
      computeMaxSendableAmount({
        balance,
        chainType: 'xlm',
        isPrivacyAsset: true,
      })
    );

    expect(max).toBeLessThanOrEqual(balance);
  });

  it('spends 100% of pXLM notes', () => {
    expect(
      computeMaxSendableAmount({
        balance: 5,
        chainType: 'xlm',
        isPrivacyAsset: true,
      })
    ).toBe('5.0000000');
  });

  it('floors to zero rather than going negative on a dust balance', () => {
    expect(
      computeMaxSendableAmount({ balance: 0.5, chainType: 'xlm' })
    ).toBe('0.0000000');
  });

  it('subtracts the gas reserve on EVM as before', () => {
    expect(
      computeMaxSendableAmount({
        balance: 1,
        chainType: 'evm',
        chainKey: 'ethereum',
      })
    ).toBe('0.990000');
  });
});
