/**
 * Small-surface component tests: TransactionItem, NetworkStatusBanner,
 * EmptyState, SecurityWarningModal, CommitmentSaveBanner, WalletIcons.
 *
 * These components sat at 0% branches; each file below drives its visible
 * states: sent/received/private/pending rows and time buckets (TransactionItem),
 * offline banner visibility (NetworkStatusBanner), action-button presence
 * (EmptyState), confirm/cancel wiring (SecurityWarningModal), pending-commitment
 * copy variants (CommitmentSaveBanner), and default-size rendering (WalletIcons).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Swipeable: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children),
  };
});

const mockNetStatus = { isConnected: true as boolean | null };
jest.mock('../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockNetStatus,
}));

import { TransactionItem } from '../TransactionItem';
import { NetworkStatusBanner } from '../NetworkStatusBanner';
import { EmptyState } from '../EmptyState';
import { SecurityWarningModal } from '../SecurityWarningModal';
import { CommitmentSaveBanner } from '../CommitmentSaveBanner';
import {
  MetaMaskIcon,
  WalletConnectIcon,
  TrustWalletIcon,
  PhantomIcon,
  LobstrIcon,
  LedgerIcon,
} from '../WalletIcons';

import { usePendingCommitmentQueue } from '../../stores/pendingCommitmentQueue';
import type { TransactionRecord } from '../../types/transactions';

type Tx = TransactionRecord;

function baseTx(overrides: Partial<Tx> = {}): Tx {
  return {
    id: 'tx-1',
    type: 'sent',
    amount: '1.5',
    token: 'ETH',
    tokenSymbol: 'ETH',
    from: '0x' + '1'.repeat(40),
    to: '0x' + '2'.repeat(40),
    timestamp: Date.now() - 5 * 60 * 1000, // 5m ago
    status: 'completed',
    hash: '0xabc',
    ...overrides,
  };
}

describe('TransactionItem', () => {
  it('renders a sent row with red amount, counterparty title, and 5m-ago subtitle', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(
      <TransactionItem item={baseTx()} onPress={onPress} />
    );
    expect(getByText('0x2222...2222')).toBeTruthy(); // to address formatted
    expect(getByText('5m ago')).toBeTruthy();
    expect(getByText('-1.5 ETH')).toBeTruthy();

    fireEvent.press(getByLabelText(/Sent 1.5 ETH, completed/i));
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-1' }));
  });

  it('renders a received row with plus prefix and receive icon lane', () => {
    const { getByText } = render(
      <TransactionItem item={baseTx({ type: 'received' })} onPress={jest.fn()} />
    );
    expect(getByText('+1.5 ETH')).toBeTruthy();
    expect(getByText('0x1111...1111')).toBeTruthy(); // from address
  });

  it('falls back to SENT/RECEIVED titles when no counterparty exists', () => {
    const { getByText } = render(
      <TransactionItem item={baseTx({ from: '', to: '' })} onPress={jest.fn()} />
    );
    expect(getByText('SENT')).toBeTruthy();
    const received = render(
      <TransactionItem
        item={baseTx({ type: 'received', from: '', to: '' })}
        onPress={jest.fn()}
      />
    );
    expect(received.getByText('RECEIVED')).toBeTruthy();
  });

  it('time buckets: hours, days, and date fallback', () => {
    const now = Date.now();
    const hours = render(
      <TransactionItem item={baseTx({ timestamp: now - 3 * 3600 * 1000 })} onPress={jest.fn()} />
    );
    expect(hours.getByText('3h ago')).toBeTruthy();

    const days = render(
      <TransactionItem item={baseTx({ timestamp: now - 2 * 24 * 3600 * 1000 })} onPress={jest.fn()} />
    );
    expect(days.getByText('2d ago')).toBeTruthy();

    const old = render(
      <TransactionItem item={baseTx({ timestamp: now - 30 * 24 * 3600 * 1000 })} onPress={jest.fn()} />
    );
    // Beyond 7 days → localized date string instead of a relative label.
    expect(old.queryByText(/ago$/)).toBeNull();
    expect(old.getByText(/\/|20\d\d/)).toBeTruthy();
  });

  it('pending status shows the Pending badge; private rows show the Private badge', () => {
    const pending = render(
      <TransactionItem item={baseTx({ status: 'pending' })} onPress={jest.fn()} />
    );
    expect(pending.getByText('Pending')).toBeTruthy();

    const priv = render(
      <TransactionItem item={baseTx({ privacyLevel: 'private' })} onPress={jest.fn()} />
    );
    expect(priv.getByText('Private')).toBeTruthy();

    const max = render(
      <TransactionItem item={baseTx({ privacyLevel: 'max' })} onPress={jest.fn()} />
    );
    expect(max.getByText('Private')).toBeTruthy();
  });

  it('SPP pool transactions use the private-lock icon lane and display overrides', () => {
    const { getByText, queryByText } = render(
      <TransactionItem
        item={baseTx({
          isPrivatePoolTx: true,
          displayTitle: 'Private transfer',
          displaySubtitle: 'SPP pool transfer',
        })}
        onPress={jest.fn()}
      />
    );
    expect(getByText('Private transfer')).toBeTruthy();
    expect(getByText('SPP pool transfer')).toBeTruthy();
    expect(queryByText(/ago$/)).toBeNull();
  });
});

describe('NetworkStatusBanner', () => {
  it('renders nothing while connected', () => {
    mockNetStatus.isConnected = true;
    const { queryByLabelText } = render(<NetworkStatusBanner />);
    expect(queryByLabelText('No internet connection warning')).toBeNull();
  });

  it('renders nothing while connectivity is unknown', () => {
    mockNetStatus.isConnected = null;
    const { queryByLabelText } = render(<NetworkStatusBanner />);
    expect(queryByLabelText('No internet connection warning')).toBeNull();
  });

  it('shows the offline warning when disconnected', () => {
    mockNetStatus.isConnected = false;
    const { getByText, getByLabelText } = render(<NetworkStatusBanner />);
    expect(getByText('No internet connection')).toBeTruthy();
    expect(getByLabelText('No internet connection warning')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('renders title + description and fires the action when provided', () => {
    const onAction = jest.fn();
    const { getByText, getByLabelText, queryByLabelText } = render(
      <EmptyState
        icon={<React.Fragment />}
        title="No transactions"
        description="Your history will appear here"
        actionLabel="Refresh"
        onAction={onAction}
      />
    );
    expect(getByText('No transactions')).toBeTruthy();
    expect(getByText('Your history will appear here')).toBeTruthy();
    fireEvent.press(getByLabelText('Refresh'));
    expect(onAction).toHaveBeenCalledTimes(1);

    // Without an action label there is no button.
    const plain = render(
      <EmptyState icon={<React.Fragment />} title="Empty" description="Nothing here" />
    );
    expect(plain.queryByLabelText('Refresh')).toBeNull();
  });
});

describe('SecurityWarningModal', () => {
  const props = {
    visible: true,
    title: 'Sensitive data',
    message: 'Anyone with this key can steal your funds.',
    onCancel: jest.fn(),
    onConfirm: jest.fn(),
  };

  it('cancel and confirm buttons fire their callbacks', () => {
    const { getByText } = render(<SecurityWarningModal {...props} />);
    expect(getByText('Sensitive data')).toBeTruthy();

    fireEvent.press(getByText('CANCEL'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    fireEvent.press(getByText('COPY ANYWAY'));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('confirm text is customizable', () => {
    const { getByText } = render(
      <SecurityWarningModal {...props} confirmText="I UNDERSTAND" />
    );
    expect(getByText('I UNDERSTAND')).toBeTruthy();
  });
});

describe('CommitmentSaveBanner', () => {
  afterEach(() => {
    usePendingCommitmentQueue.setState({ pending: [] });
  });

  it('renders nothing when the queue is empty', () => {
    usePendingCommitmentQueue.setState({ pending: [] });
    const { queryByTestId } = render(<CommitmentSaveBanner />);
    expect(queryByTestId('commitment-save-banner')).toBeNull();
  });

  it('single pending commitment: title + body, no count row', () => {
    usePendingCommitmentQueue.setState({
      pending: [
        {
          id: 'c1',
          chainKey: 'stellar',
          txHash: 'h',
          amount: '1',
          asset: 'XLM',
          nullifier: 'n',
          commitment: 'c',
          secret: 's',
          createdAt: 1,
        } as never,
      ],
    });
    const { getByTestId, queryByTestId, getByText } = render(<CommitmentSaveBanner />);
    expect(getByTestId('commitment-save-banner')).toBeTruthy();
    expect(getByText('Funds at risk — commitment not saved')).toBeTruthy();
    expect(queryByTestId('commitment-save-banner-count')).toBeNull();
  });

  it('multiple pending commitments: count row and plural copy', () => {
    function pendingRecord(id: string) {
      return {
        id,
        chainKey: 'stellar',
        txHash: 'h',
        amount: '1',
        asset: 'XLM',
        nullifier: 'n',
        commitment: 'c',
        secret: 's',
        createdAt: 1,
      } as never;
    }
    usePendingCommitmentQueue.setState({ pending: [pendingRecord('c1'), pendingRecord('c2')] });
    const { getByTestId, getByText } = render(<CommitmentSaveBanner />);
    expect(getByTestId('commitment-save-banner-count')).toBeTruthy();
    expect(getByText('2 commitments queued')).toBeTruthy();
  });
});

describe('WalletIcons', () => {
  it.each([
    ['MetaMaskIcon', MetaMaskIcon],
    ['WalletConnectIcon', WalletConnectIcon],
    ['TrustWalletIcon', TrustWalletIcon],
    ['PhantomIcon', PhantomIcon],
    ['LobstrIcon', LobstrIcon],
    ['LedgerIcon', LedgerIcon],
  ])('%s renders with default and explicit sizes', (_name, Icon) => {
    const { toJSON } = render(<Icon />);
    expect(toJSON()).toBeTruthy();
    const sized = render(<Icon width={48} height={48} />);
    expect(sized.toJSON()).toBeTruthy();
  });
});
