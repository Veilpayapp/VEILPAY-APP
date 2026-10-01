/**
 * ShieldProgressModal — staged progress tests.
 *
 * The modal renders the five sequential SPP stages from the progress
 * subscriber. These tests drive the subscriber listener directly: pending,
 * active (spinner + description + proof timing hint), success, and error
 * (message + Try Again) lanes, plus the 1.2s auto-dismiss after all stages
 * succeed and subscription lifecycle (subscribe on visible, unsubscribe on
 * hide/unmount).
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

type Listener = (states: {
  stage: string;
  status: 'pending' | 'active' | 'success' | 'error';
  message?: string;
}[]) => void;

let listener: Listener | null = null;
let unsubscribed = 0;

jest.mock('../../utils/stellarSpp/sppProgressSubscriber', () => ({
  subscribeSppProgress: jest.fn((cb: Listener) => {
    listener = cb;
    return () => {
      unsubscribed += 1;
    };
  }),
}));

import { ShieldProgressModal } from '../spp/ShieldProgressModal';
import { subscribeSppProgress } from '../../utils/stellarSpp/sppProgressSubscriber';

const STAGE_LABELS = [
  'Deriving keys',
  'Syncing pool',
  'Generating proof',
  'Submitting',
  'Confirmed',
];

function pushStates(states: Parameters<Listener>[0]) {
  act(() => {
    listener?.(states);
  });
}

function renderModal(overrides: Partial<React.ComponentProps<typeof ShieldProgressModal>> = {}) {
  const onRetry = jest.fn();
  const onDismiss = jest.fn();
  const utils = render(
    <ShieldProgressModal visible onRetry={onRetry} onDismiss={onDismiss} {...overrides} />
  );
  return { ...utils, onRetry, onDismiss };
}

describe('ShieldProgressModal', () => {
  beforeEach(() => {
    // jest.setup.ts fakes timers once per FILE; restore per test so the
    // auto-dismiss timer assertions below run on fake timers.
    jest.useFakeTimers();
    listener = null;
    unsubscribed = 0;
    (subscribeSppProgress as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders all five stage labels when visible and subscribes once', () => {
    const { getByText } = renderModal();
    for (const label of STAGE_LABELS) {
      expect(getByText(label)).toBeTruthy();
    }
    expect(subscribeSppProgress).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe when not visible', () => {
    const { queryByText } = renderModal({ visible: false });
    expect(subscribeSppProgress).not.toHaveBeenCalled();
    expect(queryByText('Shielding')).toBeNull();
  });

  it('unsubscribes when hidden; the hidden effect registers no cleanup, so unmount adds none', () => {
    const { rerender, unmount } = renderModal();
    expect(unsubscribed).toBe(0);
    rerender(
      <ShieldProgressModal visible={false} onRetry={jest.fn()} onDismiss={jest.fn()} />
    );
    // Cleanup of the visible-effect run fires here…
    expect(unsubscribed).toBe(1);
    // …and the !visible effect body returns undefined (no cleanup), so
    // unmounting does not unsubscribe a second time.
    unmount();
    expect(unsubscribed).toBe(1);
  });

  it('active stage: spinner stage shows description; pending stages show none', () => {
    const { getByText, queryByText } = renderModal();
    pushStates([{ stage: 'derive_keys', status: 'active' }]);
    expect(getByText('Preparing your private keys.')).toBeTruthy();
    expect(queryByText('Fetching the latest shielded pool state from the network.')).toBeNull();
    // Proof-stage timing hint only while generate_proof is active.
    expect(queryByText('This usually takes 15–20 seconds')).toBeNull();
  });

  it('generate_proof active: shows the 15–20s timing hint', () => {
    const { getByText } = renderModal();
    pushStates([
      { stage: 'derive_keys', status: 'success' },
      { stage: 'sync_pool', status: 'success' },
      { stage: 'generate_proof', status: 'active' },
    ]);
    expect(getByText('This usually takes 15–20 seconds')).toBeTruthy();
    expect(getByText('Computing your zero-knowledge proof. This usually takes 15–20 seconds.')).toBeTruthy();
  });

  it('error stage: shows the stage error message and Try Again fires onRetry', () => {
    const { getByText, queryByText, onRetry } = renderModal();
    pushStates([
      { stage: 'derive_keys', status: 'success' },
      { stage: 'sync_pool', status: 'success' },
      { stage: 'generate_proof', status: 'error', message: 'pool sync failed' },
    ]);
    expect(getByText('pool sync failed')).toBeTruthy();
    expect(queryByText('Try Again')).toBeTruthy();
    fireEvent.press(getByText('Try Again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // No auto-dismiss while an error is present.
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('error stage without message: no error text rendered, retry still offered', () => {
    const { getByText, queryByText } = renderModal();
    pushStates([{ stage: 'derive_keys', status: 'error' }]);
    expect(queryByText(/pool sync failed/)).toBeNull();
    expect(getByText('Try Again')).toBeTruthy();
  });

  it('all stages succeed: auto-dismisses after 1.2s, not before', () => {
    const { onDismiss } = renderModal();
    pushStates([
      { stage: 'derive_keys', status: 'success' },
      { stage: 'sync_pool', status: 'success' },
      { stage: 'generate_proof', status: 'success' },
      { stage: 'submit_tx', status: 'success' },
      { stage: 'confirmed', status: 'success' },
    ]);
    act(() => {
      jest.advanceTimersByTime(1199);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('empty success list (no stages yet) does not auto-dismiss', () => {
    const { onDismiss } = renderModal();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('uses the latest onDismiss after re-render (ref freshness)', () => {
    const { rerender, onDismiss } = renderModal();
    const lateDismiss = jest.fn();
    rerender(<ShieldProgressModal visible onRetry={jest.fn()} onDismiss={lateDismiss} />);
    pushStates([
      { stage: 'derive_keys', status: 'success' },
      { stage: 'confirmed', status: 'success' },
    ]);
    act(() => {
      jest.advanceTimersByTime(1200);
    });
    expect(lateDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
