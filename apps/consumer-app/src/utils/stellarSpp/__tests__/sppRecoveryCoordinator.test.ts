import {
  hasRecoveredThisSession,
  recoverSppNotesCoordinated,
  refreshPrivateBalanceSmart,
  resetSppRecoverySession,
  getLastKnownPrivateAmount,
} from '../sppRecoveryCoordinator';
import * as sppClient from '../sppClient';

jest.mock('../sppClient', () => ({
  getLocalPrivateBalance: jest.fn(),
  recoverSppNotesFromChain: jest.fn(),
}));

const getLocal = sppClient.getLocalPrivateBalance as jest.Mock;
const recover = sppClient.recoverSppNotesFromChain as jest.Mock;

describe('sppRecoveryCoordinator', () => {
  beforeEach(() => {
    resetSppRecoverySession();
    jest.clearAllMocks();
    getLocal.mockResolvedValue({ amount: '0', notes: [] });
  });

  it('de-dupes concurrent full recovers into one native call', async () => {
    let resolveRecover!: (v: unknown) => void;
    recover.mockReturnValue(
      new Promise((r) => {
        resolveRecover = r;
      })
    );

    const a = recoverSppNotesCoordinated('stellar-testnet', 'GTEST');
    const b = recoverSppNotesCoordinated('stellar-testnet', 'GTEST');
    expect(recover).toHaveBeenCalledTimes(1);

    resolveRecover({
      recovered: true,
      amount: '10',
      notes: [],
      message: 'ok',
    });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.amount).toBe('10');
    expect(rb.amount).toBe('10');
    expect(hasRecoveredThisSession('stellar-testnet', 'GTEST')).toBe(true);
    expect(getLastKnownPrivateAmount('stellar-testnet', 'GTEST')).toBe('10');
  });

  it('skips native recover after session success unless force', async () => {
    recover.mockResolvedValue({
      recovered: true,
      amount: '5',
      notes: [],
      message: 'first',
    });
    await recoverSppNotesCoordinated('stellar-testnet', 'GTEST');
    expect(recover).toHaveBeenCalledTimes(1);

    getLocal.mockResolvedValue({ amount: '5', notes: [{ id: 'n1' }] });
    const second = await recoverSppNotesCoordinated('stellar-testnet', 'GTEST');
    expect(recover).toHaveBeenCalledTimes(1);
    expect(second.message).toMatch(/session-cached/i);
    expect(second.amount).toBe('5');

    recover.mockResolvedValue({
      recovered: true,
      amount: '7',
      notes: [],
      message: 'forced',
    });
    const forced = await recoverSppNotesCoordinated('stellar-testnet', 'GTEST', {
      force: true,
    });
    expect(recover).toHaveBeenCalledTimes(2);
    expect(forced.amount).toBe('7');
  });

  it('does not re-full-sync when local is 0 after a session attempt', async () => {
    recover.mockResolvedValue({
      recovered: true,
      amount: '0',
      notes: [],
      message: 'empty',
    });
    await refreshPrivateBalanceSmart('stellar-testnet', 'GTEST');
    expect(recover).toHaveBeenCalledTimes(1);

    getLocal.mockResolvedValue({ amount: '0', notes: [] });
    const again = await refreshPrivateBalanceSmart('stellar-testnet', 'GTEST');
    expect(recover).toHaveBeenCalledTimes(1);
    expect(again.message).toMatch(/Local private notes/i);
  });

  it('refreshPrivateBalanceSmart uses local notes without native when amount > 0', async () => {
    getLocal.mockResolvedValue({ amount: '12', notes: [] });

    const first = await refreshPrivateBalanceSmart('stellar-testnet', 'GTEST');
    // Local notes are enough for display — do not open pool.
    expect(recover).toHaveBeenCalledTimes(0);
    expect(first.amount).toBe('12');
    expect(hasRecoveredThisSession('stellar-testnet', 'GTEST')).toBe(true);

    const light = await refreshPrivateBalanceSmart('stellar-testnet', 'GTEST');
    expect(recover).toHaveBeenCalledTimes(0);
    expect(light.amount).toBe('12');
  });
});
