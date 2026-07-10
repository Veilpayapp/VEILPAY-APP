import {
  getSppNote,
  listSppNotes,
  markSppNoteSpent,
  saveSppNote,
  sumSppNoteAmounts,
  type SppNoteRecord,
} from '../sppNoteStore';

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

function note(partial: Partial<SppNoteRecord> & Pick<SppNoteRecord, 'id' | 'amount'>): SppNoteRecord {
  return {
    chainKey: 'stellar-testnet',
    poolId: 'CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH',
    ownerAddress: 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME',
    createdAt: Date.now(),
    spent: false,
    ...partial,
  };
}

describe('sppNoteStore', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('round-trips a note through SecureStore', async () => {
    const n = note({ id: 'note-1', amount: '1.5' });
    await saveSppNote(n);
    const loaded = await getSppNote('note-1');
    expect(loaded).toEqual(n);
  });

  it('lists unspent notes for an owner and sums amounts', async () => {
    await saveSppNote(note({ id: 'a', amount: '1.0', createdAt: 1 }));
    await saveSppNote(note({ id: 'b', amount: '0.5', createdAt: 2 }));
    await saveSppNote(
      note({
        id: 'c',
        amount: '9',
        spent: true,
        createdAt: 3,
      })
    );

    const list = await listSppNotes({
      ownerAddress: 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME',
      unspentOnly: true,
    });
    expect(list.map((x) => x.id)).toEqual(['b', 'a']);
    expect(sumSppNoteAmounts(list)).toBe('1.5');
  });

  it('marks notes spent', async () => {
    await saveSppNote(note({ id: 's', amount: '2' }));
    await markSppNoteSpent('s', 'txhash');
    const loaded = await getSppNote('s');
    expect(loaded?.spent).toBe(true);
    expect(loaded?.lastTxHash).toBe('txhash');
  });
});
