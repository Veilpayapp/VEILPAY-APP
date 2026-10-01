/**
 * FeeBreakdownCard — collapsed/expanded lane tests.
 *
 * The card is the confirm-screen fee disclosure. Covers both summary rows
 * (native send TOTAL vs token send YOU SEND), every expanded detail row
 * (estimated vs max fee, fee-unavailable note, per-sppOp Soroban note with
 * singular/plural tx counts, privacy-level fee rows, token-send separate fee
 * row), and the expand/collapse toggle.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { FeeBreakdownCard } from '../spp/FeeBreakdownCard';

type Props = React.ComponentProps<typeof FeeBreakdownCard>;

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    networkFee: '0.01',
    feeSymbol: 'XLM',
    sppTxCount: 2,
    sppOp: 'shield',
    privacyLevel: 'standard',
    hasFee: true,
    isFeeCeiling: false,
    totalFee: '0.02',
    isNativeSend: true,
    nativeTotal: '0.51',
    amount: '0.5',
    token: 'XLM',
    ...overrides,
  };
}

function expand(utils: ReturnType<typeof render>) {
  fireEvent.press(utils.getByLabelText('Fee breakdown'));
  return utils;
}

describe('FeeBreakdownCard', () => {
  it('collapsed native send with fee: shows TOTAL + nativeTotal', () => {
    const { getByText, queryByText } = render(<FeeBreakdownCard {...baseProps()} />);
    expect(getByText('TOTAL')).toBeTruthy();
    expect(getByText('0.51 XLM')).toBeTruthy();
    expect(queryByText('Network fee (estimated)')).toBeNull();
  });

  it('collapsed native send without fee: shows amount + "+ fee"', () => {
    const { getByText } = render(
      <FeeBreakdownCard {...baseProps({ hasFee: false, nativeTotal: null })} />
    );
    expect(getByText('0.5 XLM + fee')).toBeTruthy();
  });

  it('collapsed native send without fee and empty amount: shows 0 + "+ fee"', () => {
    const { getByText } = render(
      <FeeBreakdownCard {...baseProps({ hasFee: false, nativeTotal: null, amount: '' })} />
    );
    expect(getByText('0 XLM + fee')).toBeTruthy();
  });

  it('token send: shows YOU SEND + amount/token instead of TOTAL', () => {
    const { getByText, queryByText } = render(
      <FeeBreakdownCard {...baseProps({ isNativeSend: false, token: 'USDC' })} />
    );
    expect(getByText('YOU SEND')).toBeTruthy();
    expect(getByText('0.5 USDC')).toBeTruthy();
    expect(queryByText('TOTAL')).toBeNull();
  });

  it('toggle expands and collapses via accessibility hint', () => {
    const utils = render(<FeeBreakdownCard {...baseProps()} />);
    expect(utils.getByLabelText('Fee breakdown').props.accessibilityHint).toBe(
      'Expands the fee breakdown'
    );
    fireEvent.press(utils.getByLabelText('Fee breakdown'));
    expect(utils.getByLabelText('Fee breakdown').props.accessibilityHint).toBe(
      'Collapses the fee breakdown'
    );
  });

  it('expanded, estimated fee with hasFee: shows plain network fee row', () => {
    const { getByText, queryByText } = expand(render(<FeeBreakdownCard {...baseProps()} />));
    expect(getByText('Network fee (estimated)')).toBeTruthy();
    expect(getByText('0.01 XLM')).toBeTruthy();
    expect(queryByText('Network fee (max)')).toBeNull();
    expect(queryByText(/Fee unavailable/)).toBeNull();
  });

  it('expanded, fee ceiling: shows max label and "up to ~" value', () => {
    const { getByText } = expand(
      render(<FeeBreakdownCard {...baseProps({ isFeeCeiling: true })} />)
    );
    expect(getByText('Network fee (max)')).toBeTruthy();
    expect(getByText('up to ~0.01 XLM')).toBeTruthy();
  });

  it('expanded without fee: dash value + unavailable note, no Soroban note', () => {
    const { getByText, queryByText } = expand(
      render(<FeeBreakdownCard {...baseProps({ hasFee: false })} />)
    );
    expect(getByText('—')).toBeTruthy();
    expect(getByText(/Fee unavailable right now/)).toBeTruthy();
    expect(queryByText(/Soroban fee for/)).toBeNull();
  });

  it.each([
    ['shield', 2, /Charged from your public XLM\. Exact amount/],
    ['shield', 1, /pool transaction\. Charged/],
    ['unshield', 2, /the amount you receive is not reduced/],
    ['transfer', 2, /not your private balance/],
  ])('expanded fee ceiling with sppOp=%s, txCount=%d: Soroban note variant', (sppOp, count, re) => {
    const { getByText } = expand(
      render(
        <FeeBreakdownCard
          {...baseProps({
            isFeeCeiling: true,
            sppOp: sppOp as Props['sppOp'],
            sppTxCount: count,
          })}
        />
      )
    );
    expect(getByText(re)).toBeTruthy();
    if (count === 1) {
      expect(getByText(/pool transaction\./)).toBeTruthy();
    }
  });

  it('privacyLevel=max: shows the privacy pool fee row', () => {
    const { getByText } = expand(
      render(<FeeBreakdownCard {...baseProps({ privacyLevel: 'max', privacyFee: '0.003' })} />)
    );
    expect(getByText('Privacy Pool Fee')).toBeTruthy();
    expect(getByText('0.003 XLM')).toBeTruthy();
  });

  it('privacyLevel=private: shows the local ZK prove row', () => {
    const { getByText } = expand(
      render(<FeeBreakdownCard {...baseProps({ privacyLevel: 'private' })} />)
    );
    expect(getByText('ZK prove (est.)')).toBeTruthy();
    expect(getByText('~10s · local')).toBeTruthy();
  });

  it('token send expanded: shows the separate native fee row; hides it for native sends', () => {
    const token = expand(render(<FeeBreakdownCard {...baseProps({ isNativeSend: false })} />));
    expect(token.getByText('Network fee, paid separately')).toBeTruthy();
    expect(token.getByText('0.02 XLM')).toBeTruthy();

    const native = expand(render(<FeeBreakdownCard {...baseProps()} />));
    expect(native.queryByText('Network fee, paid separately')).toBeNull();
  });

  it('token send expanded without fee: separate fee row shows a dash', () => {
    const { getByText } = expand(
      render(<FeeBreakdownCard {...baseProps({ isNativeSend: false, hasFee: false })} />)
    );
    expect(getByText('— XLM')).toBeTruthy();
  });
});
