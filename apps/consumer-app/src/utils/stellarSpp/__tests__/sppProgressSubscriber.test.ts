import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  recordSppProgressDiagnostic,
  resetSppProgress,
  subscribeSppProgress,
  type SppProgressState,
} from '../sppProgressSubscriber';

function stateByStage(
  states: SppProgressState[],
  stage: SppProgressState['stage']
): SppProgressState | undefined {
  return states.find((s) => s.stage === stage);
}

describe('SPP progress subscriber', () => {
  let stored: string | null;

  beforeEach(() => {
    stored = null;
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async () => stored);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(
      async (_key: string, value: string) => {
        stored = value;
      }
    );
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async () => {
      stored = null;
    });
    resetSppProgress();
  });

  it('maps derive_keys and pool_sync records to their stages', async () => {
    const snapshots: SppProgressState[][] = [];
    const unsubscribe = subscribeSppProgress((s) => snapshots.push(s));

    await recordSppProgressDiagnostic({ status: 'success', step: 'derive_keys' });
    await recordSppProgressDiagnostic({ status: 'success', step: 'pool_sync' });

    unsubscribe();

    const latest = snapshots[snapshots.length - 1];
    expect(stateByStage(latest, 'derive_keys')?.status).toBe('success');
    expect(stateByStage(latest, 'sync_pool')?.status).toBe('success');
    expect(stateByStage(latest, 'generate_proof')?.status).toBe('pending');
  });

  it('maps native-prefixed step names to the same stages', async () => {
    const snapshots: SppProgressState[][] = [];
    const unsubscribe = subscribeSppProgress((s) => snapshots.push(s));

    await recordSppProgressDiagnostic({ status: 'start', step: 'native:derive_keys' });
    await recordSppProgressDiagnostic({ status: 'success', step: 'native:derive_keys' });

    unsubscribe();

    const latest = snapshots[snapshots.length - 1];
    expect(stateByStage(latest, 'derive_keys')?.status).toBe('success');
  });

  it('keeps a later stage pending until the previous stage succeeds', async () => {
    const snapshots: SppProgressState[][] = [];
    const unsubscribe = subscribeSppProgress((s) => snapshots.push(s));

    // generate_proof active without derive_keys/sync_pool success is gated.
    await recordSppProgressDiagnostic({ status: 'start', step: 'prove' });

    unsubscribe();

    const latest = snapshots[snapshots.length - 1];
    expect(stateByStage(latest, 'generate_proof')?.status).toBe('pending');

    // Unlock sequentially and it activates.
    await recordSppProgressDiagnostic({ status: 'success', step: 'derive_keys' });
    await recordSppProgressDiagnostic({ status: 'success', step: 'pool_sync' });

    const snapshots2: SppProgressState[][] = [];
    const unsubscribe2 = subscribeSppProgress((s) => snapshots2.push(s));
    await recordSppProgressDiagnostic({ status: 'start', step: 'prove' });
    unsubscribe2();

    const latest2 = snapshots2[snapshots2.length - 1];
    expect(stateByStage(latest2, 'generate_proof')?.status).toBe('active');
  });

  it('cascades earlier stages to success when a later stage completes', async () => {
    const snapshots: SppProgressState[][] = [];
    const unsubscribe = subscribeSppProgress((s) => snapshots.push(s));

    await recordSppProgressDiagnostic({ status: 'success', step: 'submit_tx' });

    unsubscribe();

    const latest = snapshots[snapshots.length - 1];
    expect(stateByStage(latest, 'derive_keys')?.status).toBe('success');
    expect(stateByStage(latest, 'sync_pool')?.status).toBe('success');
    expect(stateByStage(latest, 'generate_proof')?.status).toBe('success');
    expect(stateByStage(latest, 'submit_tx')?.status).toBe('success');
  });

  it('records error status and message on failure', async () => {
    const snapshots: SppProgressState[][] = [];
    const unsubscribe = subscribeSppProgress((s) => snapshots.push(s));

    await recordSppProgressDiagnostic({ status: 'success', step: 'derive_keys' });
    await recordSppProgressDiagnostic({ status: 'success', step: 'pool_sync' });
    await recordSppProgressDiagnostic({
      status: 'error',
      step: 'prove',
      message: 'Network temporarily unavailable',
    });

    unsubscribe();

    const latest = snapshots[snapshots.length - 1];
    const proof = stateByStage(latest, 'generate_proof');
    expect(proof?.status).toBe('error');
    expect(proof?.message).toBe('Network temporarily unavailable');
  });

  it('subscriber receives the current snapshot immediately on subscribe', () => {
    let first: SppProgressState[] | undefined;
    const unsubscribe = subscribeSppProgress((s) => {
      first = first ?? s;
    });
    unsubscribe();

    expect(first).toHaveLength(5);
    expect(first?.every((s) => s.status === 'pending')).toBe(true);
  });

  it('resetSppProgress notifies subscribers with a fresh pending snapshot', async () => {
    const snapshots: SppProgressState[][] = [];
    const unsubscribe = subscribeSppProgress((s) => snapshots.push(s));
    await recordSppProgressDiagnostic({ status: 'success', step: 'derive_keys' });
    expect(stateByStage(snapshots[snapshots.length - 1], 'derive_keys')?.status).toBe(
      'success'
    );

    resetSppProgress();
    unsubscribe();

    const latest = snapshots[snapshots.length - 1];
    expect(latest.every((s) => s.status === 'pending')).toBe(true);
  });

  it('unsubscribe stops future notifications', async () => {
    let count = 0;
    const unsubscribe = subscribeSppProgress(() => {
      count += 1;
    });
    unsubscribe();

    await recordSppProgressDiagnostic({ status: 'success', step: 'derive_keys' });
    // count includes only the initial snapshot from subscribe.
    expect(count).toBe(1);
  });
});
