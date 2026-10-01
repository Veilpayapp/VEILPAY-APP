/**
 * TransactionResultModal — outcome-lane tests.
 *
 * The modal is the terminal state of the payment flow. Covers: hidden state,
 * confirmed vs failed icon/title/subtitle, custom errorMessage, and the
 * optional VIEW ON EXPLORER button (present only when the callback is).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { TransactionResultModal } from '../payment/TransactionResultModal';

function baseProps(overrides: Partial<React.ComponentProps<typeof TransactionResultModal>> = {}) {
  return {
    visible: true,
    status: 'confirmed' as const,
    onGoHome: jest.fn(),
    ...overrides,
  };
}

describe('TransactionResultModal', () => {
  it('renders nothing when not visible', () => {
    const { queryByText } = render(<TransactionResultModal {...baseProps({ visible: false })} />);
    expect(queryByText('PAYMENT SENT')).toBeNull();
    expect(queryByText('TRANSACTION FAILED')).toBeNull();
  });

  it('confirmed: success copy and RETURN TO HOME fires onGoHome', () => {
    const onGoHome = jest.fn();
    const { getByText, queryByText } = render(
      <TransactionResultModal {...baseProps({ onGoHome })} />
    );
    expect(getByText('PAYMENT SENT')).toBeTruthy();
    expect(
      getByText('Your transaction has been successfully confirmed on the blockchain.')
    ).toBeTruthy();
    expect(queryByText('VIEW ON EXPLORER')).toBeNull();

    fireEvent.press(getByText('RETURN TO HOME'));
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  it('failed: default error copy when no errorMessage given', () => {
    const { getByText, queryByText } = render(
      <TransactionResultModal {...baseProps({ status: 'failed' })} />
    );
    expect(getByText('TRANSACTION FAILED')).toBeTruthy();
    expect(getByText('There was an issue processing your transaction.')).toBeTruthy();
    expect(queryByText('PAYMENT SENT')).toBeNull();
  });

  it('failed: surfaces the caller-provided errorMessage', () => {
    const { getByText } = render(
      <TransactionResultModal
        {...baseProps({ status: 'failed', errorMessage: 'Insufficient balance for fee' })}
      />
    );
    expect(getByText('Insufficient balance for fee')).toBeTruthy();
  });

  it('shows VIEW ON EXPLORER only when the callback is provided and fires it', () => {
    const onViewExplorer = jest.fn();
    const { getByText, rerender, queryByText } = render(
      <TransactionResultModal {...baseProps({ onViewExplorer })} />
    );
    fireEvent.press(getByText('VIEW ON EXPLORER'));
    expect(onViewExplorer).toHaveBeenCalledTimes(1);

    rerender(<TransactionResultModal {...baseProps()} />);
    expect(queryByText('VIEW ON EXPLORER')).toBeNull();
  });
});
